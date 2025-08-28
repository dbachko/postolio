/**
 * Zod validation schemas for API endpoints
 */

import { z } from 'zod'

/**
 * Common pagination query parameters
 */
export const PaginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().min(1).max(1000)),
  limit: z
    .string()
    .optional()
    .transform(val => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(100))
})

/**
 * Post detail params
 */
export const PostDetailParamsSchema = z.object({
  postId: z.string().cuid('Invalid post ID format')
})

/**
 * Brand params
 */
export const BrandParamsSchema = z.object({
  brandId: z.string().cuid('Invalid brand ID format')
})

/**
 * Campaign params
 */
export const CampaignParamsSchema = z.object({
  campaignId: z.string().cuid('Invalid campaign ID format')
})

/**
 * Content params
 */
export const ContentParamsSchema = z.object({
  contentId: z.string().cuid('Invalid content ID format')
})

/**
 * Date range query parameters
 */
export const DateRangeSchema = z.object({
  startDate: z
    .string()
    .optional()
    .refine(
      val => !val || !isNaN(Date.parse(val)),
      'Invalid start date format'
    ),
  endDate: z
    .string()
    .optional()
    .refine(
      val => !val || !isNaN(Date.parse(val)),
      'Invalid end date format'
    )
})

/**
 * Sort parameters
 */
export const SortSchema = z.object({
  sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'priority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
})

/**
 * Content generation request
 */
export const ContentGenerationSchema = z.object({
  brandId: z.string().cuid(),
  theme: z.string().min(1).max(100),
  count: z.number().int().min(1).max(10).default(1),
  style: z.string().optional(),
  additionalContext: z.string().max(1000).optional()
})

/**
 * Campaign creation request
 */
export const CampaignCreateSchema = z.object({
  name: z.string().min(1).max(100),
  brandId: z.string().cuid(),
  config: z.object({
    frequency: z.enum(['daily', 'every-other-day', 'weekly']),
    themes: z.array(z.string()).min(1).max(10),
    duration: z.number().int().min(1).max(365),
    priority: z.number().int().min(1).max(10).default(5),
    postingTime: z.string().optional()
  }),
  status: z.enum(['creating', 'preview', 'active', 'paused']).optional()
})

/**
 * Campaign update request
 */
export const CampaignUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.object({
    frequency: z.enum(['daily', 'every-other-day', 'weekly']).optional(),
    themes: z.array(z.string()).min(1).max(10).optional(),
    priority: z.number().int().min(1).max(10).optional()
  }).optional(),
  status: z.enum(['active', 'paused']).optional()
})

/**
 * Content approval request
 */
export const ContentApprovalSchema = z.object({
  approved: z.boolean(),
  edits: z.object({
    caption: z.string().max(2200).optional(),
    hashtags: z.array(z.string()).max(30).optional()
  }).optional(),
  reason: z.string().max(500).optional()
})

/**
 * Schedule content request
 */
export const ScheduleContentSchema = z.object({
  contentId: z.string().cuid(),
  scheduledAt: z.string().refine(
    val => !isNaN(Date.parse(val)) && new Date(val) > new Date(),
    'Scheduled time must be in the future'
  ),
  timezone: z.string().optional()
})

/**
 * Analytics request
 */
export const AnalyticsRequestSchema = z.object({
  brandId: z.string().cuid(),
  timeRange: z.enum(['7d', '30d', '90d']),
  metrics: z
    .array(z.enum(['impressions', 'reach', 'engagement', 'growth']))
    .optional()
}).merge(DateRangeSchema)

/**
 * Search query
 */
export const SearchSchema = z.object({
  q: z.string().min(1).max(200),
  type: z.enum(['content', 'campaign', 'brand']).optional()
}).merge(PaginationSchema)

/**
 * Helper function to validate request data
 */
export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data)
  
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  const errors = result.error.issues.map(issue => {
    const path = issue.path.join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
  
  return { success: false, errors }
}