import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20).optional(),
  filter: z.enum(['unread', 'all', 'archived']).optional(),
  category: z.string().optional(),
  type: z.string().optional(),
  since: z.string().datetime().optional(),
  brandId: z.string().optional(),
});

export const patchNotificationSchema = z.object({
  read: z.boolean().optional(),
  archived: z.boolean().optional(),
  seen: z.boolean().optional(),
});

export const updatePreferencesSchema = z.object({
  updates: z
    .array(
      z.object({
        category: z.string(),
        type: z.string(),
        brandId: z.string().optional(),
        channel: z.enum(['in_app', 'email', 'digest', 'push', 'slack']),
        enabled: z.boolean(),
        frequency: z.enum(['instant', 'daily', 'weekly']).optional(),
        digestTime: z.string().optional(), // 'HH:mm'
      })
    )
    .min(1),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type PatchNotificationInput = z.infer<typeof patchNotificationSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
