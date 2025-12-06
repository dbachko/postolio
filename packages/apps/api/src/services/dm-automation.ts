/**
 * DM Automation Orchestrator Service
 * Coordinates rule matching, message sending, and event logging for Instagram DM automation
 */

import { prisma } from '../config/database.js';
import { dmRulesEngine } from './dm-rules-engine.js';
import { instagramService } from './instagram.js';
import { dmRateLimiter } from './dm-rate-limiter.js';
import { logger as baseLogger } from '@postolio/logger';
import type { DMTriggerType, DMActionType, DMAutomationRule } from '@postolio/database';

const logger = baseLogger.child({ module: 'dm-automation' });

// Types
export interface TriggerEvent {
  brandId: string;
  triggerType: DMTriggerType;
  triggerSource: 'comment' | 'dm';
  triggerText: string;
  triggeredBy: string; // Instagram username
  instagramUserId: string; // Instagram user ID (IGSID)
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

export const dmAutomation = {
  /**
   * Main orchestration method - processes a trigger event through the automation pipeline
   * Flow: Match rules → Evaluate conditions → Send messages → Log events
   */
  async processEvent(event: TriggerEvent): Promise<void> {
    const eventLogger = logger.child({ brandId: event.brandId });

    try {
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

      // 2. Evaluate conditions for each matched rule (rate limits, scheduling, etc.)
      const eligibleRules: DMAutomationRule[] = [];
      for (const rule of matchedRules) {
        const evaluation = await dmRulesEngine.evaluateConditions(rule, {
          userId: event.instagramUserId,
          username: event.triggeredBy,
          postUrl: event.postUrl,
        });

        if (evaluation.eligible) {
          eligibleRules.push(rule);
        } else {
          eventLogger.debug('Rule not eligible', {
            ruleId: rule.id,
            ruleName: rule.name,
            reason: evaluation.reason,
          });
        }
      }

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

      // 3. Process each eligible rule (send DM and/or reply to comment)
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
    // 1. Check DM rate limit (Instagram's 350 DMs/hour limit)
    const rateLimitCheck = await dmRateLimiter.checkLimit(context.brandId);
    if (!rateLimitCheck.allowed) {
      logger.warn('DM rate limit exceeded', {
        brandId: context.brandId,
        ruleId: rule.id,
        remaining: rateLimitCheck.remainingHour,
      });

      // Log rate-limited event
      await this.logEvent({
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

    // 2. Prepare template variables
    const variables: Record<string, string> = {
      name: context.triggeredBy,
      username: context.triggeredBy,
      post_url: context.postUrl || '',
    };

    // 3. Send DM and/or comment reply based on actionType
    let messageSent = false;
    let commentReplySent = false;
    let conversationId: string | undefined;

    // Send DM
    if (rule.actionType === 'send_dm' || rule.actionType === 'send_dm_and_reply') {
      if (!rule.messageTemplate) {
        throw new Error('Message template is required for DM actions');
      }

      const messageText = dmRulesEngine.renderTemplate(rule.messageTemplate, variables);
      const { messageId } = await instagramService.sendDirectMessage(
        context.brandId,
        context.instagramUserId,
        messageText
      );
      messageSent = true;

      // Increment rate limit counter
      await dmRateLimiter.incrementCount(context.brandId);

      // Create or update conversation record
      const conversation = await prisma.dMConversation.upsert({
        where: {
          brandId_instagramUserId: {
            brandId: context.brandId,
            instagramUserId: context.instagramUserId,
          },
        },
        create: {
          brandId: context.brandId,
          ruleId: rule.id,
          instagramUserId: context.instagramUserId,
          instagramUsername: context.triggeredBy,
          state: 'active',
        },
        update: {
          lastMessageAt: new Date(),
        },
      });
      conversationId = conversation.id;

      // Log outbound message
      await prisma.dMMessage.create({
        data: {
          conversationId: conversation.id,
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
    }

    // Reply to comment
    if (rule.actionType === 'reply_comment' || rule.actionType === 'send_dm_and_reply') {
      if (context.externalCommentId && rule.commentReplyTemplate) {
        const replyText = dmRulesEngine.renderTemplate(rule.commentReplyTemplate, variables);

        await instagramService.replyToCommentDirect(
          context.brandId,
          context.externalCommentId,
          replyText
        );
        commentReplySent = true;

        logger.info('Comment reply sent successfully', {
          brandId: context.brandId,
          commentId: context.externalCommentId,
        });
      }
    }

    // 4. Log successful automation event
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
