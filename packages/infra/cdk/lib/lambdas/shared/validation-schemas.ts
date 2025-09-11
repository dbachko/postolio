import { z } from 'zod';

// Request schemas
export const PublishRequestSchema = z.object({
  userId: z.string().min(1),
  brandId: z.string().min(1),
  platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
  contentId: z.string().min(1),
  scheduleId: z.string().optional(), // Added for schedule tracking
  content: z.object({
    caption: z.string().max(2200), // Instagram caption limit
    mediaUrl: z.string().url().optional(),
    mediaType: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL']).optional(),
    hashtags: z.array(z.string()).max(30).optional(),
    mentions: z.array(z.string()).optional(),
    location: z
      .object({
        latitude: z.number(),
        longitude: z.number(),
        name: z.string().optional(),
      })
      .optional(),
  }),
  scheduledAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.any()).optional(), // Added for additional data
  idempotencyKey: z.string().min(1),
});

export type PublishRequest = z.infer<typeof PublishRequestSchema>;

// Event schemas
export const PostPublishedEventSchema = z.object({
  userId: z.string(),
  brandId: z.string(),
  contentId: z.string(),
  platform: z.string(),
  postId: z.string(),
  permalink: z.string().url(),
  publishedAt: z.string().datetime(),
});

export const PostFailedEventSchema = z.object({
  userId: z.string(),
  brandId: z.string(),
  contentId: z.string(),
  platform: z.string(),
  error: z.string(),
  errorCode: z.string().optional(),
  retryable: z.boolean(),
  failedAt: z.string().datetime(),
});

// Validation utilities
export class ValidationError extends Error {
  constructor(public errors: z.ZodError) {
    super('Validation failed');
    this.name = 'ValidationError';
  }
}

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}

// Token schemas
export const TokenRecordSchema = z.object({
  pk: z.string(), // userId#platform
  sk: z.string(), // brandId
  platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
  encryptedAccessToken: z.string(),
  encryptedRefreshToken: z.string().optional(),
  expiresAt: z.number(),
  lastRefreshed: z.string().datetime(),
  metadata: z.record(z.string(), z.any()).optional(),
  ttl: z.number().optional(),
});

export type TokenRecord = z.infer<typeof TokenRecordSchema>;

// Schedule schemas
export const ScheduleRequestSchema = z.object({
  userId: z.string().min(1),
  brandId: z.string().min(1),
  contentId: z.string().min(1),
  platform: z.enum(['instagram', 'facebook', 'linkedin', 'tiktok']),
  scheduledAt: z.string().datetime(),
  content: z.object({
    caption: z.string(),
    mediaUrl: z.string().url().optional(),
    hashtags: z.array(z.string()).optional(),
  }),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;

// Response schemas
export const ApiResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z
      .object({
        message: z.string(),
        code: z.string().optional(),
        details: z.any().optional(),
      })
      .optional(),
  });

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
};
