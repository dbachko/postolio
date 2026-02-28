import { logger as baseLogger } from '@postolio/logger';
import type { FastifyInstance } from 'fastify';
import type { Platform } from '@postolio/database';
import { prisma } from '../../config/database.js';
import { getStatusBroadcaster } from '../../services/broadcast-registry.js';
import { requireInboxFeature } from './shared.js';

const logger = baseLogger.child({ module: 'dm-automation-conversations-routes' });

type Conversation = {
  id: string;
  brandId: string;
  socialAccountId: string;
  participantExternalUserId: string;
  participantUsername: string | null;
  platform: Platform;
};

async function findConversation(
  brandId: string,
  conversationId: string,
  userId: string
): Promise<Conversation | null> {
  return prisma.dMConversation.findFirst({
    where: {
      id: conversationId,
      brandId,
      brand: { userId },
    },
    select: {
      id: true,
      brandId: true,
      socialAccountId: true,
      participantExternalUserId: true,
      participantUsername: true,
      platform: true,
    },
  });
}

function validateMessageText(value: string): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

async function sendInstagramMessage(conversation: Conversation, messageText: string) {
  const { instagramService } = await import('../../services/instagram.js');
  return instagramService.sendDirectMessageForSocialAccount(
    conversation.socialAccountId,
    conversation.participantExternalUserId,
    messageText
  );
}

async function createOutboundMessage(
  conversation: Conversation,
  messageText: string,
  messageId: string
) {
  return prisma.dMMessage.create({
    data: {
      conversationId: conversation.id,
      platform: conversation.platform,
      direction: 'outbound',
      messageText,
      externalMessageId: messageId,
      status: 'sent',
      sentAt: new Date(),
    },
  });
}

async function broadcastManualMessage(params: {
  conversation: Conversation;
  messageId: string;
  messageText: string;
}) {
  const statusBroadcaster = getStatusBroadcaster();
  if (!statusBroadcaster) {
    return;
  }

  await statusBroadcaster.broadcastDMMessage({
    conversationId: params.conversation.id,
    messageId: params.messageId,
    brandId: params.conversation.brandId,
    socialAccountId: params.conversation.socialAccountId,
    platform: params.conversation.platform,
    direction: 'outbound',
    messageText: params.messageText,
    participantUsername:
      params.conversation.participantUsername || params.conversation.participantExternalUserId,
  });
}

function registerGetConversationMessagesRoute(fastify: FastifyInstance): void {
  fastify.get<{ Params: { brandId: string; conversationId: string } }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId/messages',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const userId = request.user!.id;

      try {
        const conversation = await findConversation(brandId, conversationId, userId);
        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        const messages = await prisma.dMMessage.findMany({
          where: { conversationId },
          orderBy: { createdAt: 'asc' },
        });

        logger.info('Fetched conversation messages', {
          brandId,
          conversationId,
          messageCount: messages.length,
          userId,
        });

        return reply.send({ messages });
      } catch (error) {
        logger.error('Error fetching conversation messages', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }
    }
  );
}

function registerPostConversationMessageRoute(fastify: FastifyInstance): void {
  fastify.post<{
    Params: { brandId: string; conversationId: string };
    Body: { messageText: string };
  }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId/messages',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const userId = request.user!.id;

      try {
        const conversation = await findConversation(brandId, conversationId, userId);
        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        const messageText = validateMessageText(request.body.messageText);
        if (!messageText) {
          return reply.code(400).send({ error: 'Message text is required' });
        }
        if (conversation.platform !== 'instagram') {
          return reply.code(400).send({ error: 'Platform not supported for manual messages' });
        }

        const { messageId } = await sendInstagramMessage(conversation, messageText);
        const message = await createOutboundMessage(conversation, messageText, messageId);

        await prisma.dMConversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: new Date() },
        });

        logger.info('Sent manual DM reply', { brandId, conversationId, messageId, userId });
        await broadcastManualMessage({ conversation, messageId: message.id, messageText });

        return reply.code(201).send({ message });
      } catch (error) {
        logger.error('Error sending manual DM reply', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  );
}

function registerPatchConversationStateRoute(fastify: FastifyInstance): void {
  fastify.patch<{
    Params: { brandId: string; conversationId: string };
    Body: { state: 'active' | 'archived' | 'spam' };
  }>(
    '/brands/:brandId/dm-automation/conversations/:conversationId',
    { preHandler: [fastify.authenticate, requireInboxFeature] },
    async (request, reply) => {
      const { brandId, conversationId } = request.params;
      const { state } = request.body;
      const userId = request.user!.id;

      try {
        const conversation = await findConversation(brandId, conversationId, userId);
        if (!conversation) {
          return reply.code(404).send({ error: 'Conversation not found' });
        }

        const updated = await prisma.dMConversation.update({
          where: { id: conversationId },
          data: { state },
        });

        logger.info('Updated conversation state', {
          brandId,
          conversationId,
          newState: state,
          userId,
        });

        const statusBroadcaster = getStatusBroadcaster();
        if (statusBroadcaster) {
          await statusBroadcaster.broadcastDMConversationUpdate(
            conversationId,
            brandId,
            state,
            updated.lastMessageAt
          );
        }

        return reply.send({ conversation: updated });
      } catch (error) {
        logger.error('Error updating conversation state', {
          brandId,
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return reply.code(500).send({ error: 'Failed to update conversation' });
      }
    }
  );
}

export function registerDmAutomationConversationRoutes(fastify: FastifyInstance): void {
  registerGetConversationMessagesRoute(fastify);
  registerPostConversationMessageRoute(fastify);
  registerPatchConversationStateRoute(fastify);
}
