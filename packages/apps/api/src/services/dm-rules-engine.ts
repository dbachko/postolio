/**
 * DM Automation Rules Engine
 * Handles rule matching, template rendering, and condition evaluation
 */

import { prisma } from '../config/database.js';
import type { DMTriggerType, DMAutomationRule } from '@postolio/database';
import { logger as baseLogger } from '@postolio/logger';

const logger = baseLogger.child({ module: 'dm-rules-engine' });

// Types
export interface TriggerEvent {
  type: DMTriggerType;
  text: string;
}

export interface TriggerContext {
  userId: string; // Instagram user ID
  username?: string;
  postUrl?: string;
}

export interface RuleMatchResult {
  rule: DMAutomationRule;
  eligible: boolean;
  reason?: string;
}

// Service implementation
export const dmRulesEngine = {
  /**
   * Match automation rules for a given trigger event
   * @returns Array of matching rules, sorted by priority (highest first)
   */
  async matchRules(brandId: string, trigger: TriggerEvent): Promise<DMAutomationRule[]> {
    // 1. Fetch active rules for brand + trigger type
    const rules = await prisma.dMAutomationRule.findMany({
      where: {
        brandId,
        triggerType: trigger.type,
        status: 'active',
      },
      orderBy: { priority: 'desc' },
    });

    logger.debug('Fetched active rules', {
      brandId,
      triggerType: trigger.type,
      rulesFound: rules.length,
    });

    // 2. Match each rule's keywords
    const matched = rules.filter((rule) => {
      const triggerConfig = rule.triggerConfig as {
        keywords: string[];
        matchType: 'exact' | 'contains';
      };

      return this.matchKeywords(trigger.text, triggerConfig);
    });

    logger.info('Matched automation rules', {
      brandId,
      triggerType: trigger.type,
      totalRules: rules.length,
      matchedRules: matched.length,
    });

    return matched;
  },

  /**
   * Check if text matches keywords based on match type
   */
  matchKeywords(
    text: string,
    config: { keywords: string[]; matchType: 'exact' | 'contains' }
  ): boolean {
    const { keywords, matchType } = config;
    const normalizedText = text.trim();

    return keywords.some((keyword) => {
      try {
        switch (matchType) {
          case 'exact':
            // Case-insensitive exact match of whole text
            return normalizedText.toLowerCase() === keyword.toLowerCase();

          case 'contains':
            // Case-insensitive substring match
            return normalizedText.toLowerCase().includes(keyword.toLowerCase());

          default:
            logger.warn('Unknown match type, defaulting to contains', { matchType });
            return normalizedText.toLowerCase().includes(keyword.toLowerCase());
        }
      } catch (error) {
        logger.error('Error matching keyword, skipping', { error, keyword, matchType });
        return false;
      }
    });
  },

  /**
   * Render message template with variable substitution
   * Replaces {{variable}} with values from context
   */
  renderTemplate(template: string, variables: Record<string, string>): string {
    let rendered = template;

    // Replace each variable {{key}} with its value
    Object.entries(variables).forEach(([key, value]) => {
      const pattern = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      rendered = rendered.replace(pattern, value || '');
    });

    // Remove any unmatched variables ({{key}} where key is not in variables)
    rendered = rendered.replace(/\{\{[^}]+\}\}/g, '');

    return rendered;
  },

  /**
   * Evaluate all conditions for a rule to determine if it should fire
   * Checks: rate limits, cooldown periods, active hours/days
   */
  async evaluateConditions(
    rule: DMAutomationRule,
    context: TriggerContext
  ): Promise<{ eligible: boolean; reason?: string }> {
    // Check maxUsesPerUser rate limit (24-hour window)
    if (rule.maxUsesPerUser) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentEvents = await prisma.dMAutomationEvent.count({
        where: {
          ruleId: rule.id,
          triggeredBy: context.username,
          timestamp: { gte: since },
        },
      });

      if (recentEvents >= rule.maxUsesPerUser) {
        logger.debug('Rule blocked: max uses per user exceeded', {
          ruleId: rule.id,
          username: context.username,
          recentEvents,
          limit: rule.maxUsesPerUser,
        });

        return {
          eligible: false,
          reason: `User ${context.username} exceeded max uses (${rule.maxUsesPerUser} per 24h)`,
        };
      }
    }

    // Check cooldown period
    if (rule.cooldownMinutes) {
      const since = new Date(Date.now() - rule.cooldownMinutes * 60 * 1000);
      const recentEvent = await prisma.dMAutomationEvent.findFirst({
        where: {
          ruleId: rule.id,
          triggeredBy: context.username,
          timestamp: { gte: since },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (recentEvent) {
        const minutesAgo = Math.round((Date.now() - recentEvent.timestamp.getTime()) / 1000 / 60);

        // Only block if the event is within the cooldown period
        if (minutesAgo < rule.cooldownMinutes) {
          logger.debug('Rule blocked: cooldown period not elapsed', {
            ruleId: rule.id,
            username: context.username,
            minutesAgo,
            cooldown: rule.cooldownMinutes,
          });

          return {
            eligible: false,
            reason: `Cooldown period (${rule.cooldownMinutes}min) not elapsed for ${context.username}`,
          };
        }
      }
    }

    // Check active hours and days
    const scheduleCheck = this.checkSchedule(rule);
    if (!scheduleCheck.eligible) {
      return scheduleCheck;
    }

    return { eligible: true };
  },

  /**
   * Check if current time falls within rule's active schedule
   */
  checkSchedule(rule: DMAutomationRule): { eligible: boolean; reason?: string } {
    // No schedule restrictions = always eligible
    if (!rule.activeHours && !rule.activeDays) {
      return { eligible: true };
    }

    const now = new Date();

    // Check active days (0=Sunday, 6=Saturday)
    if (rule.activeDays && rule.activeDays.length > 0) {
      const currentDay = now.getDay();

      if (!rule.activeDays.includes(currentDay)) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        logger.debug('Rule blocked: not an active day', {
          ruleId: rule.id,
          currentDay: dayNames[currentDay],
          activeDays: rule.activeDays.map((d) => dayNames[d]),
        });

        return {
          eligible: false,
          reason: `Today (${dayNames[currentDay]}) is not an active day for this rule`,
        };
      }
    }

    // Check active hours
    if (rule.activeHours) {
      const config = rule.activeHours as {
        start: string;
        end: string;
        timezone?: string;
      };

      // Time restrictions use UTC.
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const currentTime = currentHour * 60 + currentMinute; // Minutes since midnight

      const [startHour, startMin] = config.start.split(':').map(Number);
      const [endHour, endMin] = config.end.split(':').map(Number);
      const startTime = startHour * 60 + startMin;
      const endTime = endHour * 60 + endMin;

      if (currentTime < startTime || currentTime >= endTime) {
        logger.debug('Rule blocked: outside active hours', {
          ruleId: rule.id,
          currentTime: `${currentHour}:${currentMinute}`,
          activeHours: `${config.start}-${config.end}`,
        });

        return {
          eligible: false,
          reason: `Current time is outside active hours (${config.start}-${config.end} UTC)`,
        };
      }
    }

    return { eligible: true };
  },
};
