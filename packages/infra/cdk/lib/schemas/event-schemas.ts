/**
 * Event Schema Registry for Postolio Platform
 * Centralized event contract definitions for all services
 */

import { z } from 'zod';

// Base event metadata schema
export const EventMetadataSchema = z.object({
  userId: z.string(),
  brandId: z.string(),
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  version: z.string().default('1.0'),
});

// Base platform event schema
export const PlatformEventSchema = z.object({
  id: z.string().uuid(),
  source: z.enum([
    'postolio.content',
    'postolio.scheduler',
    'postolio.platform',
    'postolio.campaign',
    'postolio.analytics',
    'postolio.token',
  ]),
  type: z.string(),
  timestamp: z.string().datetime(),
  data: z.record(z.string(), z.any()),
  metadata: EventMetadataSchema,
});

// Content Events
export const ContentCreatedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.content'),
  type: z.literal('content.created'),
  data: z.object({
    contentId: z.string(),
    brandId: z.string(),
    caption: z.string(),
    mediaUrl: z.string().url().optional(),
    campaignId: z.string().optional(),
    status: z.enum(['draft', 'scheduled', 'published']),
  }),
});

export const ContentUpdatedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.content'),
  type: z.literal('content.updated'),
  data: z.object({
    contentId: z.string(),
    brandId: z.string(),
    updates: z.object({
      caption: z.string().optional(),
      mediaUrl: z.string().url().optional(),
      status: z.enum(['draft', 'scheduled', 'published']).optional(),
    }),
  }),
});

export const ContentDeletedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.content'),
  type: z.literal('content.deleted'),
  data: z.object({
    contentId: z.string(),
    brandId: z.string(),
  }),
});

// Schedule Events
export const ScheduleCreatedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.scheduler'),
  type: z.literal('schedule.created'),
  data: z.object({
    scheduleId: z.string(),
    contentId: z.string(),
    brandId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    scheduledAt: z.string().datetime(),
    timezone: z.string(),
  }),
});

export const ScheduleUpdatedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.scheduler'),
  type: z.literal('schedule.updated'),
  data: z.object({
    scheduleId: z.string(),
    updates: z.object({
      scheduledAt: z.string().datetime().optional(),
      content: z
        .object({
          caption: z.string().optional(),
          mediaUrl: z.string().url().optional(),
        })
        .optional(),
    }),
  }),
});

export const ScheduleCanceledEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.scheduler'),
  type: z.literal('schedule.canceled'),
  data: z.object({
    scheduleId: z.string(),
    contentId: z.string(),
    brandId: z.string(),
    reason: z.string().optional(),
  }),
});

export const ScheduleReadyEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.scheduler'),
  type: z.literal('schedule.ready'),
  data: z.object({
    scheduleId: z.string(),
    contentId: z.string(),
    brandId: z.string(),
    userId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    content: z.object({
      caption: z.string(),
      mediaUrl: z.string().url().optional(),
    }),
  }),
});

// Platform Publishing Events
export const PostPublishedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.platform'),
  type: z.literal('post.published'),
  data: z.object({
    scheduleId: z.string(),
    contentId: z.string(),
    brandId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    platformPostId: z.string(),
    permalink: z.string().url(),
    publishedAt: z.string().datetime(),
  }),
});

export const PostFailedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.platform'),
  type: z.literal('post.failed'),
  data: z.object({
    scheduleId: z.string(),
    contentId: z.string(),
    brandId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
    attemptNumber: z.number(),
    nextRetryAt: z.string().datetime().optional(),
  }),
});

// Campaign Events
export const CampaignCreatedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.campaign'),
  type: z.literal('campaign.created'),
  data: z.object({
    campaignId: z.string(),
    brandId: z.string(),
    name: z.string(),
    config: z.object({
      duration: z.number(),
      frequency: z.enum(['daily', 'weekly']),
      themes: z.array(z.string()),
      priority: z.number().min(1).max(10),
    }),
    scheduleCount: z.number(),
  }),
});

export const CampaignStartedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.campaign'),
  type: z.literal('campaign.started'),
  data: z.object({
    campaignId: z.string(),
    brandId: z.string(),
    startedAt: z.string().datetime(),
  }),
});

export const CampaignCompletedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.campaign'),
  type: z.literal('campaign.completed'),
  data: z.object({
    campaignId: z.string(),
    brandId: z.string(),
    completedAt: z.string().datetime(),
    stats: z.object({
      totalPosts: z.number(),
      publishedPosts: z.number(),
      failedPosts: z.number(),
    }),
  }),
});

// Token Events
export const TokenRefreshedEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.token'),
  type: z.literal('token.refreshed'),
  data: z.object({
    brandId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    expiresAt: z.string().datetime(),
  }),
});

export const TokenExpiredEventSchema = PlatformEventSchema.extend({
  source: z.literal('postolio.token'),
  type: z.literal('token.expired'),
  data: z.object({
    brandId: z.string(),
    platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
    expiredAt: z.string().datetime(),
  }),
});

// Event Registry Map
export const EventSchemaRegistry = {
  'content.created': ContentCreatedEventSchema,
  'content.updated': ContentUpdatedEventSchema,
  'content.deleted': ContentDeletedEventSchema,
  'schedule.created': ScheduleCreatedEventSchema,
  'schedule.updated': ScheduleUpdatedEventSchema,
  'schedule.canceled': ScheduleCanceledEventSchema,
  'schedule.ready': ScheduleReadyEventSchema,
  'post.published': PostPublishedEventSchema,
  'post.failed': PostFailedEventSchema,
  'campaign.created': CampaignCreatedEventSchema,
  'campaign.started': CampaignStartedEventSchema,
  'campaign.completed': CampaignCompletedEventSchema,
  'token.refreshed': TokenRefreshedEventSchema,
  'token.expired': TokenExpiredEventSchema,
} as const;

// Type exports
export type PlatformEvent = z.infer<typeof PlatformEventSchema>;
export type ContentCreatedEvent = z.infer<typeof ContentCreatedEventSchema>;
export type ContentUpdatedEvent = z.infer<typeof ContentUpdatedEventSchema>;
export type ContentDeletedEvent = z.infer<typeof ContentDeletedEventSchema>;
export type ScheduleCreatedEvent = z.infer<typeof ScheduleCreatedEventSchema>;
export type ScheduleUpdatedEvent = z.infer<typeof ScheduleUpdatedEventSchema>;
export type ScheduleCanceledEvent = z.infer<typeof ScheduleCanceledEventSchema>;
export type ScheduleReadyEvent = z.infer<typeof ScheduleReadyEventSchema>;
export type PostPublishedEvent = z.infer<typeof PostPublishedEventSchema>;
export type PostFailedEvent = z.infer<typeof PostFailedEventSchema>;
export type CampaignCreatedEvent = z.infer<typeof CampaignCreatedEventSchema>;
export type CampaignStartedEvent = z.infer<typeof CampaignStartedEventSchema>;
export type CampaignCompletedEvent = z.infer<typeof CampaignCompletedEventSchema>;
export type TokenRefreshedEvent = z.infer<typeof TokenRefreshedEventSchema>;
export type TokenExpiredEvent = z.infer<typeof TokenExpiredEventSchema>;

// Event validation helper
export function validateEvent(eventType: string, eventData: unknown): PlatformEvent {
  const schema = EventSchemaRegistry[eventType as keyof typeof EventSchemaRegistry];
  if (!schema) {
    throw new Error(`Unknown event type: ${eventType}`);
  }
  return schema.parse(eventData);
}

// Event builder helper
export class EventBuilder {
  static createEvent<T extends keyof typeof EventSchemaRegistry>(
    type: T,
    data: any,
    metadata: z.infer<typeof EventMetadataSchema>
  ): PlatformEvent {
    const event = {
      id: crypto.randomUUID(),
      source: this.getSourceFromType(type),
      type,
      timestamp: new Date().toISOString(),
      data,
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        correlationId: metadata.correlationId || crypto.randomUUID(),
      },
    };

    return validateEvent(type, event);
  }

  private static getSourceFromType(type: string): string {
    const [domain] = type.split('.');
    return `postolio.${domain}`;
  }
}
