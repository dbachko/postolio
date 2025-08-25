/**
 * Shared Validation Schemas
 * Type-safe input validation for all Lambda functions
 */

import { z } from 'zod'

// ========================================
// Common Schemas
// ========================================

export const PlatformSchema = z.enum(['instagram', 'facebook', 'linkedin', 'tiktok'])

export const ContentSchema = z.object({
  caption: z.string().min(1).max(10000),
  hashtags: z.array(z.string().regex(/^#?[\w]+$/)).max(100),
  mediaUrl: z.string().url().optional(),
  mediaType: z.enum(['image', 'video', 'carousel']).optional(),
})

export const MetadataSchema = z.record(z.string(), z.any()).optional()

// ========================================
// Publisher Request Schemas
// ========================================

export const PublishRequestSchema = z.object({
  scheduleId: z.string().min(1).max(100),
  contentId: z.string().min(1).max(100),
  brandId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  platform: PlatformSchema,
  content: ContentSchema,
  metadata: MetadataSchema,
})

export type PublishRequest = z.infer<typeof PublishRequestSchema>

// ========================================
// Token Service Schemas
// ========================================

export const StoreTokenRequestSchema = z.object({
  userId: z.string().min(1).max(100),
  brandId: z.string().min(1).max(100),
  platform: PlatformSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().positive(),
  metadata: MetadataSchema,
})

export type StoreTokenRequest = z.infer<typeof StoreTokenRequestSchema>

// ========================================
// Scheduler Service Schemas
// ========================================

export const ScheduleSchema = z.object({
  scheduleId: z.string().optional(),
  contentId: z.string().min(1).max(100),
  brandId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(),
  timezone: z.string().default('UTC'),
  content: ContentSchema,
  status: z.enum(['pending', 'scheduled', 'published', 'failed']).default('pending'),
  metadata: MetadataSchema,
})

export type Schedule = z.infer<typeof ScheduleSchema>

export const ContentUpdatedEventSchema = z.object({
  contentId: z.string().min(1).max(100),
  brandId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  updates: z.object({
    caption: z.string().optional(),
    hashtags: z.array(z.string()).optional(),
    mediaUrl: z.string().url().optional(),
  }),
  timestamp: z.string().datetime(),
})

export type ContentUpdatedEvent = z.infer<typeof ContentUpdatedEventSchema>

// ========================================
// Event Schemas
// ========================================

export const PostPublishedEventSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  postId: z.string(),
  permalink: z.string().url().optional(),
  publishedAt: z.string().datetime(),
})

export type PostPublishedEvent = z.infer<typeof PostPublishedEventSchema>

export const PostFailedEventSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  error: z.string(),
  failedAt: z.string().datetime(),
})

export type PostFailedEvent = z.infer<typeof PostFailedEventSchema>

// ========================================
// Validation Helpers
// ========================================

export class ValidationError extends Error {
  constructor(
    message: string,
    public errors: z.ZodError
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function validateInput<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  errorMessage = 'Invalid input'
): T {
  try {
    return schema.parse(data)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(errorMessage, error)
    }
    throw error
  }
}

// ========================================
// Platform-Specific Validation
// ========================================

export const InstagramMetadataSchema = z.object({
  instagramAccountId: z.string().min(1),
  pageId: z.string().optional(),
})

export const FacebookMetadataSchema = z.object({
  pageId: z.string().min(1),
  pageAccessToken: z.string().optional(),
})

export const LinkedInMetadataSchema = z.object({
  personUrn: z.string().regex(/^urn:li:person:.+$/),
  organizationId: z.string().optional(),
})

export const TikTokMetadataSchema = z.object({
  openId: z.string().min(1),
  clientKey: z.string().min(1),
  clientSecret: z.string().optional(),
})

export function validatePlatformMetadata(
  platform: string,
  metadata: unknown
): Record<string, any> {
  switch (platform) {
    case 'instagram':
      return InstagramMetadataSchema.parse(metadata)
    case 'facebook':
      return FacebookMetadataSchema.parse(metadata)
    case 'linkedin':
      return LinkedInMetadataSchema.parse(metadata)
    case 'tiktok':
      return TikTokMetadataSchema.parse(metadata)
    default:
      return z.record(z.any()).parse(metadata || {})
  }
}