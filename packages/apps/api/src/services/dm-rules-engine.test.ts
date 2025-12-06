/**
 * Unit tests for DM Rules Engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dmRulesEngine } from './dm-rules-engine.js';
import type { DMAutomationRule } from '@postolio/database';
import { prisma } from '../config/database.js';

// Mock Prisma
vi.mock('../config/database.js', () => ({
  prisma: {
    dMAutomationRule: {
      findMany: vi.fn(),
    },
    dMAutomationEvent: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('DMRulesEngine', () => {
  describe('matchKeywords', () => {
    it('matches exact keywords case-insensitively', () => {
      const config = {
        keywords: ['DISCOUNT', 'PROMO'],
        matchType: 'exact' as const,
      };

      expect(dmRulesEngine.matchKeywords('DISCOUNT', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('discount', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('Discount', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('I want a DISCOUNT', config)).toBe(false);
      expect(dmRulesEngine.matchKeywords('SALE', config)).toBe(false);
    });

    it('matches contains keywords', () => {
      const config = {
        keywords: ['ship', 'deliver'],
        matchType: 'contains' as const,
      };

      expect(dmRulesEngine.matchKeywords('Do you ship internationally?', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('SHIPPING info please', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('delivery time?', config)).toBe(true);
      expect(dmRulesEngine.matchKeywords('What are your hours?', config)).toBe(false);
    });
  });

  describe('renderTemplate', () => {
    it('renders templates with variables', () => {
      const template = 'Hello {{name}}, your code is: {{code}}';
      const variables = { name: 'John', code: 'SAVE10' };

      expect(dmRulesEngine.renderTemplate(template, variables)).toBe(
        'Hello John, your code is: SAVE10'
      );
    });

    it('handles missing variables by leaving empty string', () => {
      const template = 'Hi {{name}}, visit {{url}}';
      const variables = { name: 'Alice' };

      expect(dmRulesEngine.renderTemplate(template, variables)).toBe('Hi Alice, visit ');
    });

    it('removes unmatched variable placeholders', () => {
      const template = 'Message {{var1}} and {{var2}} here';
      const variables = {};

      expect(dmRulesEngine.renderTemplate(template, variables)).toBe('Message  and  here');
    });

    it('handles multiple occurrences of same variable', () => {
      const template = 'Hi {{name}}! Welcome, {{name}}.';
      const variables = { name: 'Bob' };

      expect(dmRulesEngine.renderTemplate(template, variables)).toBe('Hi Bob! Welcome, Bob.');
    });

    it('handles empty template', () => {
      expect(dmRulesEngine.renderTemplate('', { name: 'test' })).toBe('');
    });

    it('handles template with no variables', () => {
      const template = 'This is a static message';
      expect(dmRulesEngine.renderTemplate(template, {})).toBe('This is a static message');
    });
  });

  describe('checkSchedule', () => {
    it('returns eligible when no schedule restrictions', () => {
      const rule = {
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const result = dmRulesEngine.checkSchedule(rule);
      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('checks active days correctly', () => {
      // Use vitest's setSystemTime for proper time mocking
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-08T10:00:00Z')); // Monday

      const rule = {
        activeHours: null,
        activeDays: [1, 2, 3, 4, 5], // Mon-Fri
      } as DMAutomationRule;

      const result = dmRulesEngine.checkSchedule(rule);
      expect(result.eligible).toBe(true);

      vi.useRealTimers();
    });

    it('blocks on inactive days', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-07T10:00:00Z')); // Sunday

      const rule = {
        activeHours: null,
        activeDays: [1, 2, 3, 4, 5], // Mon-Fri
      } as DMAutomationRule;

      const result = dmRulesEngine.checkSchedule(rule);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('not an active day');

      vi.useRealTimers();
    });

    it('checks active hours correctly', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-08T12:00:00Z')); // 12:00 UTC

      const rule = {
        activeHours: { start: '09:00', end: '17:00' },
        activeDays: null,
      } as DMAutomationRule;

      const result = dmRulesEngine.checkSchedule(rule);
      expect(result.eligible).toBe(true);

      vi.useRealTimers();
    });

    it('blocks outside active hours', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-08T20:00:00Z')); // 20:00 UTC

      const rule = {
        activeHours: { start: '09:00', end: '17:00' },
        activeDays: null,
      } as DMAutomationRule;

      const result = dmRulesEngine.checkSchedule(rule);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('outside active hours');

      vi.useRealTimers();
    });
  });

  describe('evaluateConditions', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('allows rule when no rate limits', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: null,
        cooldownMinutes: null,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(true);
    });

    it('blocks when max uses per user exceeded', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: 1,
        cooldownMinutes: null,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      // Mock: user already triggered this rule once today
      (prisma.dMAutomationEvent.count as any).mockResolvedValue(1);

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('exceeded max uses');
    });

    it('allows when max uses not exceeded', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: 3,
        cooldownMinutes: null,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      // Mock: user triggered this rule twice today (< 3)
      (prisma.dMAutomationEvent.count as any).mockResolvedValue(2);

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(true);
    });

    it('blocks when cooldown period not elapsed', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: null,
        cooldownMinutes: 60,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      // Mock: user triggered this rule 30 minutes ago
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      (prisma.dMAutomationEvent.findFirst as any).mockResolvedValue({
        timestamp: thirtyMinutesAgo,
      });

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('Cooldown period');
    });

    it('allows when cooldown period elapsed', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: null,
        cooldownMinutes: 60,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      // Mock: user triggered this rule 90 minutes ago
      const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000);
      (prisma.dMAutomationEvent.findFirst as any).mockResolvedValue({
        timestamp: ninetyMinutesAgo,
      });

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(true);
    });

    it('allows when no previous events found', async () => {
      const rule = {
        id: 'rule-1',
        maxUsesPerUser: 1,
        cooldownMinutes: 60,
        activeHours: null,
        activeDays: null,
      } as DMAutomationRule;

      const context = { userId: 'user123', username: 'testuser' };

      // Mock: no events found
      (prisma.dMAutomationEvent.count as any).mockResolvedValue(0);
      (prisma.dMAutomationEvent.findFirst as any).mockResolvedValue(null);

      const result = await dmRulesEngine.evaluateConditions(rule, context);
      expect(result.eligible).toBe(true);
    });
  });

  describe('matchRules', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns matching rules in priority order', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          priority: 5,
          triggerConfig: { keywords: ['help'], matchType: 'contains' },
        },
        {
          id: 'rule-2',
          priority: 10,
          triggerConfig: { keywords: ['urgent'], matchType: 'contains' },
        },
        {
          id: 'rule-3',
          priority: 3,
          triggerConfig: { keywords: ['help'], matchType: 'contains' },
        },
      ];

      (prisma.dMAutomationRule.findMany as any).mockResolvedValue(mockRules);

      const result = await dmRulesEngine.matchRules('brand-1', {
        type: 'dm_keyword',
        text: 'I need help',
      });

      // Should return rules that match "help" (rule-1 and rule-3)
      // Already sorted by priority from DB query
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('rule-1'); // priority 5
      expect(result[1].id).toBe('rule-3'); // priority 3
    });

    it('returns empty array when no rules match', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          priority: 5,
          triggerConfig: { keywords: ['discount'], matchType: 'exact' },
        },
      ];

      (prisma.dMAutomationRule.findMany as any).mockResolvedValue(mockRules);

      const result = await dmRulesEngine.matchRules('brand-1', {
        type: 'comment_keyword',
        text: 'hello there',
      });

      expect(result).toHaveLength(0);
    });

    it('filters by brand and trigger type', async () => {
      await dmRulesEngine.matchRules('brand-123', {
        type: 'comment_keyword',
        text: 'test',
      });

      expect(prisma.dMAutomationRule.findMany).toHaveBeenCalledWith({
        where: {
          brandId: 'brand-123',
          triggerType: 'comment_keyword',
          status: 'active',
        },
        orderBy: { priority: 'desc' },
      });
    });
  });
});
