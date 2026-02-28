/**
 * DM Automation Orchestrator Service
 * Coordinates rule matching, message sending, and event logging for DM automation
 */

import { prisma } from '../config/database.js';
import { dmRulesEngine } from './dm-rules-engine.js';
import { instagramService } from './instagram.js';
import { dmRateLimiter } from './dm-rate-limiter.js';
import { logger as baseLogger } from '@postolio/logger';
import type { DMTriggerType, DMActionType, DMAutomationRule, Platform } from '@postolio/database';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { StatusBroadcaster } from './status-broadcaster.js';

const logger = baseLogger.child({ module: 'dm-automation' });

// Will be initialized by init() method
let statusBroadcaster: StatusBroadcaster | null = null;

// Types
export interface TriggerEvent {
  brandId: string;
  socialAccountId: string;
  platform: Platform;
  triggerType: DMTriggerType;
  triggerSource: 'comment' | 'dm';
  triggerText: string;
  triggeredBy: string; // Username/handle
  participantExternalUserId: string; // External user ID (platform-specific)
  externalCommentId?: string; // Comment ID if trigger is from comment
  postUrl?: string; // Optional post URL for template variables
}

export interface EventLogData {
  brandId: string;
  ruleId: string;
  conversationId?: string;
  triggerType: DMTriggerType;
  triggerSource: string;
  triggerText?: string;
  triggeredBy: string;
  actionType: DMActionType;
  messageSent?: boolean;
  commentReplySent?: boolean;
  rateLimited?: boolean;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

type LogEventFn = (data: EventLogData) => Promise<void>;

async function evaluateEligibleRules(
  matchedRules: DMAutomationRule[],
  event: TriggerEvent,
  eventLogger: ReturnType<typeof logger.child>
): Promise<DMAutomationRule[]> {
  const eligibleRules: DMAutomationRule[] = [];
  for (const rule of matchedRules) {
    const evaluation = await dmRulesEngine.evaluateConditions(rule, {
      userId: event.participantExternalUserId,
      username: event.triggeredBy,
      postUrl: event.postUrl,
    });
    if (evaluation.eligible) {
      eligibleRules.push(rule);
      continue;
    }

    eventLogger.debug('Rule not eligible', {
      ruleId: rule.id,
      ruleName: rule.name,
      reason: evaluation.reason,
    });
  }
  return eligibleRules;
}

async function ensureRateLimitOrThrow(
  rule: DMAutomationRule,
  context: TriggerEvent,
  logEvent: LogEventFn
): Promise<void> {
  const rateLimitCheck = await dmRateLimiter.checkLimit(context.socialAccountId);
  if (rateLimitCheck.allowed) {
    return;
  }

  logger.warn('DM rate limit exceeded', {
    brandId: context.brandId,
    socialAccountId: context.socialAccountId,
    ruleId: rule.id,
    remaining: rateLimitCheck.remainingHour,
  });

  await logEvent({
    brandId: context.brandId,
    ruleId: rule.id,
    triggerType: context.triggerType,
    triggerSource: context.triggerSource,
    triggerText: context.triggerText,
    triggeredBy: context.triggeredBy,
    actionType: rule.actionType,
    rateLimited: true,
    errorMessage: 'Rate limit exceeded',
  });
  throw new Error('DM rate limit exceeded');
}

async function sendDirectMessageForRule(params: {
  rule: DMAutomationRule;
  context: TriggerEvent;
  variables: Record<string, string>;
}): Promise<{ conversationId: string; messageSent: boolean }> {
  const { rule, context, variables } = params;
  if (rule.actionType !== 'send_dm' && rule.actionType !== 'send_dm_and_reply') {
    throw new Error('sendDirectMessageForRule called for non-DM rule');
  }
  if (!rule.messageTemplate) {
    throw new Error('Message template is required for DM actions');
  }

  const messageText = dmRulesEngine.renderTemplate(rule.messageTemplate, variables);
  const { messageId } = await instagramService.sendDirectMessageForSocialAccount(
    context.socialAccountId,
    context.participantExternalUserId,
    messageText
  );
  await dmRateLimiter.incrementCount(context.socialAccountId);

  const conversation = await prisma.dMConversation.upsert({
    where: {
      brandId_socialAccountId_platform_participantExternalUserId: {
        brandId: context.brandId,
        socialAccountId: context.socialAccountId,
        platform: context.platform,
        participantExternalUserId: context.participantExternalUserId,
      },
    },
    create: {
      brandId: context.brandId,
      socialAccountId: context.socialAccountId,
      platform: context.platform,
      ruleId: rule.id,
      participantExternalUserId: context.participantExternalUserId,
      participantUsername: context.triggeredBy,
      state: 'active',
    },
    update: {
      participantUsername: context.triggeredBy,
      lastMessageAt: new Date(),
    },
  });

  const dmMessage = await prisma.dMMessage.create({
    data: {
      conversationId: conversation.id,
      platform: context.platform,
      direction: 'outbound',
      messageText,
      externalMessageId: messageId,
      externalCommentId: context.externalCommentId,
      status: 'sent',
      sentAt: new Date(),
    },
  });

  logger.info('DM sent successfully', {
    brandId: context.brandId,
    conversationId: conversation.id,
    messageId,
  });

  if (statusBroadcaster) {
    await statusBroadcaster.broadcastDMMessage({
      conversationId: conversation.id,
      messageId: dmMessage.id,
      brandId: context.brandId,
      socialAccountId: context.socialAccountId,
      platform: context.platform,
      direction: 'outbound',
      messageText,
      participantUsername: context.triggeredBy,
    });
  }
  return { conversationId: conversation.id, messageSent: true };
}

async function maybeSendCommentReply(params: {
  rule: DMAutomationRule;
  context: TriggerEvent;
  variables: Record<string, string>;
}): Promise<boolean> {
  const { rule, context, variables } = params;
  if (
    (rule.actionType !== 'reply_comment' && rule.actionType !== 'send_dm_and_reply') ||
    !context.externalCommentId ||
    !rule.commentReplyTemplate
  ) {
    return false;
  }

  const replyText = dmRulesEngine.renderTemplate(rule.commentReplyTemplate, variables);
  await instagramService.replyToCommentDirectForSocialAccount(
    context.socialAccountId,
    context.externalCommentId,
    replyText
  );
  logger.info('Comment reply sent successfully', {
    brandId: context.brandId,
    socialAccountId: context.socialAccountId,
    commentId: context.externalCommentId,
  });
  return true;
}

export const dmAutomation = {
  /**
   * Initialize the DM automation service with WebSocket broadcaster
   */
  init(fastify: FastifyInstance, redis: Redis): void {
    statusBroadcaster = new StatusBroadcaster(fastify, redis);
    logger.info('DM automation service initialized with WebSocket broadcaster');
  },

  /**
   * Main orchestration method - processes a trigger event through the automation pipeline
   * Flow: Match rules → Evaluate conditions → Send messages → Log events
   */
  async processEvent(event: TriggerEvent): Promise<void> {
    const eventLogger = logger.child({ brandId: event.brandId });

    try {
      if (event.platform !== 'instagram') {
        eventLogger.warn('DM automation platform not implemented', {
          brandId: event.brandId,
          socialAccountId: event.socialAccountId,
          platform: event.platform,
        });
        return;
      }

      eventLogger.info('Processing DM automation event', {
        triggerType: event.triggerType,
        triggerSource: event.triggerSource,
        triggeredBy: event.triggeredBy,
      });

      // 1. Match rules for this trigger
      const matchedRules = await dmRulesEngine.matchRules(event.brandId, {
        type: event.triggerType,
        text: event.triggerText,
      });

      if (matchedRules.length === 0) {
        eventLogger.debug('No rules matched for event', {
          triggerText: event.triggerText,
          triggerType: event.triggerType,
        });
        return;
      }

      eventLogger.info('Matched automation rules', {
        ruleCount: matchedRules.length,
        ruleIds: matchedRules.map((r) => r.id),
      });

      const eligibleRules = await evaluateEligibleRules(matchedRules, event, eventLogger);

      if (eligibleRules.length === 0) {
        eventLogger.info('No eligible rules after evaluation', {
          matchedCount: matchedRules.length,
        });
        return;
      }

      eventLogger.info('Processing eligible rules', {
        eligibleCount: eligibleRules.length,
        ruleIds: eligibleRules.map((r) => r.id),
      });

      for (const rule of eligibleRules) {
        try {
          await this.sendAutomatedDM(rule, event);
          eventLogger.info('Successfully processed rule', {
            ruleId: rule.id,
            ruleName: rule.name,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          eventLogger.error('Failed to process rule', {
            ruleId: rule.id,
            ruleName: rule.name,
            error: errorMessage,
          });

          // Log failed event
          await this.logEvent({
            brandId: event.brandId,
            ruleId: rule.id,
            triggerType: event.triggerType,
            triggerSource: event.triggerSource,
            triggerText: event.triggerText,
            triggeredBy: event.triggeredBy,
            actionType: rule.actionType,
            messageSent: false,
            commentReplySent: false,
            errorMessage,
          });
        }
      }
    } catch (error) {
      eventLogger.error('Error processing DM automation event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event,
      });
      throw error;
    }
  },

  /**
   * Send automated DM and/or comment reply based on rule configuration
   * Handles: Rate limiting, template rendering, message sending, conversation tracking
   */
  async sendAutomatedDM(rule: DMAutomationRule, context: TriggerEvent): Promise<void> {
    await ensureRateLimitOrThrow(rule, context, this.logEvent.bind(this));

    const variables: Record<string, string> = {
      name: context.triggeredBy,
      username: context.triggeredBy,
      post_url: context.postUrl || '',
    };

    let messageSent = false;
    let commentReplySent = false;
    let conversationId: string | undefined;

    if (rule.actionType === 'send_dm' || rule.actionType === 'send_dm_and_reply') {
      const dmResult = await sendDirectMessageForRule({ rule, context, variables });
      conversationId = dmResult.conversationId;
      messageSent = dmResult.messageSent;
    }

    commentReplySent = await maybeSendCommentReply({ rule, context, variables });
    await this.logEvent({
      brandId: context.brandId,
      ruleId: rule.id,
      conversationId,
      triggerType: context.triggerType,
      triggerSource: context.triggerSource,
      triggerText: context.triggerText,
      triggeredBy: context.triggeredBy,
      actionType: rule.actionType,
      messageSent,
      commentReplySent,
      rateLimited: false,
    });
  },

  /**
   * Log automation event to database for analytics and debugging
   */
  async logEvent(data: EventLogData): Promise<void> {
    try {
      await prisma.dMAutomationEvent.create({
        data: {
          brandId: data.brandId,
          ruleId: data.ruleId,
          conversationId: data.conversationId,
          triggerType: data.triggerType,
          triggerSource: data.triggerSource,
          triggerText: data.triggerText,
          triggeredBy: data.triggeredBy,
          actionType: data.actionType,
          messageSent: data.messageSent || false,
          commentReplySent: data.commentReplySent || false,
          rateLimited: data.rateLimited || false,
          errorMessage: data.errorMessage,
          timestamp: new Date(),
          metadata: data.metadata ? (data.metadata as any) : undefined,
        },
      });

      logger.debug('Automation event logged', {
        brandId: data.brandId,
        ruleId: data.ruleId,
        actionType: data.actionType,
        messageSent: data.messageSent,
        commentReplySent: data.commentReplySent,
      });
    } catch (error) {
      logger.error('Failed to log automation event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        brandId: data.brandId,
        ruleId: data.ruleId,
      });
      // Don't throw - logging failures shouldn't break automation flow
    }
  },
};
