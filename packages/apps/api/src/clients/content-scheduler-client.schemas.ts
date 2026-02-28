import { z } from 'zod';

const PlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin', 'youtube']);
const ScheduleStatusSchema = z.enum([
  'pending',
  'scheduled',
  'processing',
  'published',
  'failed',
  'cancelled',
  'canceled',
]);
const ContentTypeSchema = z.enum(['post', 'reel', 'story']);
const MediaTypeSchema = z.enum(['image', 'video']);

const MetadataSchema = z.record(z.string(), z.unknown());

const MediaAssetSchema = z.object({
  key: z.string(),
  type: MediaTypeSchema,
  order: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
});

const CreateScheduleInputSchema = z.object({
  contentId: z.string().uuid(),
  brandId: z.string().uuid(),
  userId: z.string().optional(),
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(),
  contentType: ContentTypeSchema,
  mediaType: MediaTypeSchema.optional(),
  caption: z.string().max(2200),
  hashtags: z.array(z.string()).optional(),
  mediaAssets: z.array(MediaAssetSchema).optional(),
  metadata: MetadataSchema.optional(),
  firstComment: z.string().optional(),
  shareToFeed: z.boolean().optional(),
  thumbOffset: z.number().optional(),
});

const PublishNowInputSchema = CreateScheduleInputSchema.omit({ scheduledAt: true }).extend({
  scheduledAt: z.string().datetime().optional(),
});

const UpdateScheduleInputSchema = z
  .object({
    scheduledAt: z.string().datetime().optional(),
    status: ScheduleStatusSchema.optional(),
    // Optional for partial update/cancel paths, required by service-level validators when needed.
    brandId: z.string().uuid().optional(),
    contentId: z.string().uuid().optional(),
    userId: z.string().min(1).optional(),
    platform: PlatformSchema.optional(),
    caption: z.string().max(2200).optional(),
    hashtags: z.array(z.string()).optional(),
    mediaAssets: z.array(MediaAssetSchema).optional(),
    metadata: MetadataSchema.optional(),
    firstComment: z.string().optional(),
    shareToFeed: z.boolean().optional(),
    thumbOffset: z.number().optional(),
  })
  .strict();

const ScheduleSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string().uuid(),
  brandId: z.string().uuid(),
  userId: z.string().optional(),
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(),
  status: ScheduleStatusSchema,
  contentType: ContentTypeSchema,
  mediaType: MediaTypeSchema.optional(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  mediaAssets: z.array(MediaAssetSchema).optional(),
  metadata: MetadataSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ScheduleListSchema = z.object({
  schedules: z.array(ScheduleSchema),
  total: z.number(),
  hasMore: z.boolean(),
});

const ListSchedulesParamsSchema = z.object({
  brandId: z.string().uuid().optional(),
  status: ScheduleStatusSchema.optional(),
  platform: PlatformSchema.optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type Platform = z.infer<typeof PlatformSchema>;
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleList = z.infer<typeof ScheduleListSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type PublishNowInput = z.infer<typeof PublishNowInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
export type ListSchedulesParams = z.input<typeof ListSchedulesParamsSchema>;

export type CacheValue =
  | Schedule
  | ScheduleList
  | {
      scheduled: number;
      published: number;
      failed: number;
      cancelled: number;
      processing: number;
    };

export interface RequestMeta {
  start: number;
  id: string;
  attempt: number;
}

export interface RequestWithMeta {
  __meta?: RequestMeta;
}

export interface ContentSchedulerConfig {
  baseURL: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerOptions?: Record<string, unknown>;
  userId?: string;
  debugLogging?: boolean;
}

export {
  PlatformSchema,
  ScheduleStatusSchema,
  ContentTypeSchema,
  MediaTypeSchema,
  MetadataSchema,
  MediaAssetSchema,
  CreateScheduleInputSchema,
  PublishNowInputSchema,
  UpdateScheduleInputSchema,
  ScheduleSchema,
  ScheduleListSchema,
  ListSchedulesParamsSchema,
};
