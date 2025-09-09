import { z } from "zod";

export const PostPublishedEventSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  platform: z.string(),
  platformPostId: z.string(),
  permalink: z.string(),
  publishedAt: z.string(),
});

export const PostFailedEventSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string().optional(),
  brandId: z.string().optional(),
  platform: z.string().optional(),
  error: z.string(),
  attemptNumber: z.number(),
});
