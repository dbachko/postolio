import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../../config/database.js';
import { logRouteError, type MetaDeletionCallback } from './shared.js';

type MetaDeletionData = {
  user_id?: string;
};

function parseSignedRequest(signedRequest: string): { encodedSig: string; payload: string } | null {
  const requestParts = signedRequest.split('.');
  if (requestParts.length !== 2) {
    return null;
  }
  return {
    encodedSig: requestParts[0] ?? '',
    payload: requestParts[1] ?? '',
  };
}

function buildExpectedSignature(payload: string, appSecret: string): string {
  return crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function verifyMetaSignature(encodedSig: string, expectedSig: string): boolean {
  const expectedSigBuffer = Buffer.from(expectedSig, 'utf8');
  const receivedSigBuffer = Buffer.from(encodedSig, 'utf8');
  if (expectedSigBuffer.length !== receivedSigBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedSigBuffer, receivedSigBuffer);
}

function decodeMetaPayload(payload: string): MetaDeletionData {
  return JSON.parse(Buffer.from(payload, 'base64').toString()) as MetaDeletionData;
}

async function findInstagramSocialAccount(metaUserId: string) {
  return prisma.socialAccount.findFirst({
    where: { platform: 'instagram', externalAccountId: metaUserId },
    include: { brand: { select: { userId: true } } },
  });
}

async function processMetaUserDeletion(metaUserId: string): Promise<void> {
  const socialAccount = await findInstagramSocialAccount(metaUserId);
  const userId = socialAccount?.brand?.userId;
  if (!socialAccount || !userId) {
    return;
  }

  const deletedAt = new Date();
  const scheduledDeletion = new Date(deletedAt.getTime());
  scheduledDeletion.setDate(scheduledDeletion.getDate() + 30);

  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt,
      deletionReason: 'Instagram data deletion request',
      scheduledDeletion,
    },
  });

  await prisma.socialAccount.delete({ where: { id: socialAccount.id } });
}

function buildConfirmationUrl(metaUserId: string): string {
  const appUrl = process.env.APP_URL || 'https://postolio.example';
  return `${appUrl}/legal/data-deletion-confirmation?id=${metaUserId}`;
}

export function registerMetaDeletionCallbackRoute(fastify: FastifyInstance): void {
  fastify.post('/meta-deletion-callback', async (request, reply) => {
    const body = request.body as MetaDeletionCallback;
    if (!body?.signed_request || typeof body.signed_request !== 'string') {
      return reply.code(400).send({ error: 'Invalid signed request format' });
    }

    try {
      const parsed = parseSignedRequest(body.signed_request);
      if (!parsed) {
        return reply.code(400).send({ error: 'Invalid signed request format' });
      }

      if (!process.env.FACEBOOK_APP_SECRET) {
        fastify.log.error('FACEBOOK_APP_SECRET not configured');
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const expectedSig = buildExpectedSignature(parsed.payload, process.env.FACEBOOK_APP_SECRET);
      if (!verifyMetaSignature(parsed.encodedSig, expectedSig)) {
        fastify.log.warn('Invalid Meta signature received');
        return reply.code(401).send({ error: 'Invalid signature' });
      }

      const data = decodeMetaPayload(parsed.payload);
      const metaUserId = typeof data.user_id === 'string' ? data.user_id : '';
      if (metaUserId) {
        await processMetaUserDeletion(metaUserId);
      }

      return reply.send({
        url: buildConfirmationUrl(metaUserId),
        confirmation_code: crypto.randomBytes(16).toString('hex'),
      });
    } catch (error: unknown) {
      logRouteError(fastify.log, error, 'Meta deletion callback error:');
      return reply.code(500).send({ error: 'Failed to process Meta deletion request' });
    }
  });
}
