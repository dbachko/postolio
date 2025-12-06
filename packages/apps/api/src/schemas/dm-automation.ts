/**
 * Zod Validation Schemas for DM Automation API
 */

import { z } from 'zod';

// Trigger configuration schema
export const dmTriggerConfigSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1, 'At least one keyword is required'),
  matchType: z.enum(['exact', 'contains']),
});

// Active hours configuration
export const activeHoursSchema = z.object({
  start: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  end: z.string().regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format (HH:MM)'),
  timezone: z.string().optional(),
});

// Create rule schema with conditional validation
export const createRuleSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
    triggerType: z.enum(['comment_keyword', 'dm_keyword', 'comment_any', 'dm_any']),
    triggerConfig: dmTriggerConfigSchema,
    actionType: z.enum(['send_dm', 'reply_comment', 'send_dm_and_reply']),
    messageTemplate: z
      .string()
      .max(2000, 'Message template must be 2000 characters or less')
      .optional(),
    commentReplyTemplate: z
      .string()
      .max(500, 'Comment reply must be 500 characters or less')
      .optional(),
    maxUsesPerUser: z.number().int().positive().optional(),
    cooldownMinutes: z.number().int().positive().optional(),
    activeHours: activeHoursSchema.optional(),
    activeDays: z.array(z.number().int().min(0).max(6)).optional(),
    priority: z.number().int().default(0),
  })
  .refine(
    (data) => {
      // If action type requires sending a DM, messageTemplate is required
      if (data.actionType === 'send_dm' || data.actionType === 'send_dm_and_reply') {
        return data.messageTemplate && data.messageTemplate.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Message template is required for DM actions',
      path: ['messageTemplate'],
    }
  )
  .refine(
    (data) => {
      // If action type requires comment reply, commentReplyTemplate is required
      if (data.actionType === 'reply_comment' || data.actionType === 'send_dm_and_reply') {
        return data.commentReplyTemplate && data.commentReplyTemplate.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Comment reply template is required for comment reply actions',
      path: ['commentReplyTemplate'],
    }
  )
  .refine(
    (data) => {
      // For keyword-based triggers, at least one keyword is required
      if (data.triggerType === 'comment_keyword' || data.triggerType === 'dm_keyword') {
        return data.triggerConfig.keywords.length > 0;
      }
      return true;
    },
    {
      message: 'At least one keyword is required for keyword-based triggers',
      path: ['triggerConfig', 'keywords'],
    }
  );

// Update rule schema (all fields optional)
export const updateRuleSchema = createRuleSchema.partial().extend({
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

// Rule response schema
export const ruleResponseSchema = z.object({
  id: z.string(),
  brandId: z.string(),
  name: z.string(),
  triggerType: z.string(),
  triggerConfig: z.any(),
  actionType: z.string(),
  messageTemplate: z.string(),
  commentReplyTemplate: z.string().nullable(),
  status: z.string(),
  priority: z.number(),
  maxUsesPerUser: z.number().nullable(),
  cooldownMinutes: z.number().nullable(),
  activeHours: z.any().nullable(),
  activeDays: z.array(z.number()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
});

// Analytics query schema
export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(90).default(30),
});

// Types
export type CreateRuleInput = z.infer<typeof createRuleSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;
export type RuleResponse = z.infer<typeof ruleResponseSchema>;
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
