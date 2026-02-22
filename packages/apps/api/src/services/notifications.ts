import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../config/database.js';
import type { Prisma } from '@postolio/database';
import type { NotificationsBroadcaster } from './notifications-broadcaster.js';
import { getNotificationsBroadcaster } from './broadcast-registry.js';
import { maybeSendImmediateEmail } from './notification-email.js';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export interface EmitEventInput {
  userId: string;
  brandId?: string | null;
  type: string; // e.g., 'publishing.post_failed'
  category: 'publishing' | 'accounts' | 'collaboration' | 'system' | 'billing' | string;
  severity: NotificationSeverity | string;
  title: string;
  body?: string;
  linkUrl?: string;
  actorId?: string;
  resource?: { type?: string; id?: string };
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
  groupKey?: string;
  expiresAt?: Date;
}

export interface ListFilters {
  userId: string;
  brandId?: string;
  cursor?: string;
  limit?: number;
  filter?: 'unread' | 'all' | 'archived';
  category?: string;
  type?: string;
  since?: Date;
}

class NotificationsServiceImpl {
  private broadcaster: NotificationsBroadcaster | null = null;
  private logger: FastifyBaseLogger | Console = console;

  setLogger(logger: FastifyBaseLogger | Console) {
    this.logger = logger;
  }

  private isFastifyLogger(logger: FastifyBaseLogger | Console): logger is FastifyBaseLogger {
    return typeof (logger as FastifyBaseLogger).child === 'function';
  }

  private logError(meta: unknown, message: string) {
    if (this.isFastifyLogger(this.logger)) {
      this.logger.error(meta, message);
    } else {
      console.error(message, meta);
    }
  }

  private getBroadcaster(): NotificationsBroadcaster | null {
    if (!this.broadcaster) {
      this.broadcaster = getNotificationsBroadcaster();
    }
    return this.broadcaster;
  }

  async emitEvent(input: EmitEventInput) {
    // Check master preference (category/type-wide disable) before creating anything
    try {
      const master = await prisma.notificationPreference.findFirst({
        where: {
          userId: input.userId,
          category: input.category,
          type: 'all',
          channel: 'all',
          OR: [{ brandId: input.brandId || null }, { brandId: null }],
        },
        orderBy: { brandId: 'desc' },
      });
      if (master?.enabled === false) {
        // Suppressed by master preference: do not create/broadcast/email
        return null;
      }
    } catch (err) {
      this.logError({ err }, 'Failed to check master notification preference');
    }
    const notification = await prisma.notification
      .upsert({
        where: input.dedupeKey ? { dedupeKey: input.dedupeKey } : { id: '___noop___' },
        update: {
          // If deduped, we might update createdAt/body etc.
          createdAt: new Date(),
          groupKey: input.groupKey || undefined,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
        },
        create: {
          userId: input.userId,
          brandId: input.brandId || null,
          type: input.type,
          category: input.category,
          severity: input.severity,
          title: input.title,
          body: input.body || null,
          linkUrl: input.linkUrl || null,
          actorId: input.actorId || null,
          resourceType: input.resource?.type || null,
          resourceId: input.resource?.id || null,
          metadata: input.metadata as Prisma.InputJsonValue | undefined,
          dedupeKey: input.dedupeKey || null,
          groupKey: input.groupKey || null,
          expiresAt: input.expiresAt || null,
        },
      })
      .catch(async (err) => {
        // If upsert fails because dedupeKey not provided, create directly
        if (!input.dedupeKey) {
          return prisma.notification.create({
            data: {
              userId: input.userId,
              brandId: input.brandId || null,
              type: input.type,
              category: input.category,
              severity: input.severity,
              title: input.title,
              body: input.body || null,
              linkUrl: input.linkUrl || null,
              actorId: input.actorId || null,
              resourceType: input.resource?.type || null,
              resourceId: input.resource?.id || null,
              metadata: input.metadata as Prisma.InputJsonValue | undefined,
              groupKey: input.groupKey || null,
              expiresAt: input.expiresAt || null,
            },
          });
        }
        throw err;
      });

    // Bump unread count cache
    await this.recomputeUnreadCount(input.userId);

    // Broadcast
    try {
      const b = this.getBroadcaster();
      if (b) {
        await b.broadcastNew(input.userId, {
          id: notification.id,
          type: notification.type,
          category: notification.category,
          severity: notification.severity,
          title: notification.title,
          body: notification.body,
          linkUrl: notification.linkUrl,
          resource: { type: notification.resourceType, id: notification.resourceId },
          createdAt: notification.createdAt.toISOString(),
          readAt: notification.readAt ? notification.readAt.toISOString() : null,
        });
      }
    } catch (error) {
      this.logError({ error }, 'Failed to broadcast notification');
    }

    // Attempt immediate email for critical/default-enabled types
    try {
      await maybeSendImmediateEmail({
        userId: notification.userId,
        brandId: notification.brandId,
        type: notification.type,
        category: notification.category,
        severity: notification.severity,
        title: notification.title,
        body: notification.body || undefined,
        linkUrl: notification.linkUrl || undefined,
      });
    } catch (error) {
      this.logError({ error }, 'Failed to queue notification email');
    }

    return notification;
  }

  async list(filters: ListFilters) {
    const take = Math.min(Math.max(filters.limit || 20, 1), 100);

    const where: Prisma.NotificationWhereInput = { userId: filters.userId };
    if (filters.brandId) {
      where.brandId = filters.brandId;
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.since) {
      where.createdAt = { gte: filters.since };
    }

    if (filters.filter === 'unread') {
      where.readAt = null;
      where.archivedAt = null;
    } else if (filters.filter === 'archived') {
      where.archivedAt = { not: null };
    } else if (filters.filter === 'all') {
      // show everything, no additional constraint
    }

    const cursor = filters.cursor ? { id: filters.cursor } : undefined;

    const items = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor } : {}),
      select: {
        id: true,
        type: true,
        category: true,
        severity: true,
        title: true,
        body: true,
        linkUrl: true,
        resourceType: true,
        resourceId: true,
        createdAt: true,
        readAt: true,
      },
    });

    const nextCursor = items.length === take ? items[items.length - 1]?.id : undefined;
    const unreadCount = await this.getUnreadCount(filters.userId);

    return { items, nextCursor, unreadCount };
  }

  async mark(
    id: string,
    userId: string,
    patch: { read?: boolean; archived?: boolean; seen?: boolean }
  ) {
    const data: Prisma.NotificationUpdateInput = {};
    if (patch.read !== undefined) {
      data.readAt = patch.read ? new Date() : null;
    }
    if (patch.seen) {
      data.seenAt = new Date();
    }
    if (patch.archived !== undefined) {
      data.archivedAt = patch.archived ? new Date() : null;
    }

    await prisma.notification.update({ where: { id }, data });

    const count = await this.recomputeUnreadCount(userId);
    const b = this.getBroadcaster();
    if (b) {
      await b.broadcastUnreadCount(userId, count);
    }
    return { success: true };
  }

  async markAllRead(userId: string, before?: Date) {
    const where: Prisma.NotificationWhereInput = { userId, readAt: null };
    if (before) {
      where.createdAt = { lte: before };
    }
    const res = await prisma.notification.updateMany({ where, data: { readAt: new Date() } });
    const count = await this.recomputeUnreadCount(userId);
    const b = this.getBroadcaster();
    if (b) {
      await b.broadcastUnreadCount(userId, count);
    }
    return { success: true, marked: res.count };
  }

  async purgeOld(maxAgeDays: number) {
    const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);
    const res = await prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoff },
      },
    });
    return { deleted: res.count, cutoff };
  }

  async getPreferences(userId: string, brandId?: string) {
    const prefs = await prisma.notificationPreference.findMany({
      where: { userId, brandId: brandId || null },
    });
    return { items: prefs, defaults: this.defaultPreferences() };
  }

  async updatePreferences(
    userId: string,
    updates: Array<{
      category: string;
      type: string;
      brandId?: string;
      // 'all' represents a master toggle across channels for the category/type
      channel: 'in_app' | 'email' | 'digest' | 'push' | 'slack' | 'all';
      enabled: boolean;
      frequency?: 'instant' | 'daily' | 'weekly';
      digestTime?: string;
    }>
  ) {
    for (const u of updates) {
      if (u.brandId) {
        // Brand-scoped preference: use composite unique upsert
        await prisma.notificationPreference.upsert({
          where: {
            userId_brandId_category_type_channel: {
              userId,
              brandId: u.brandId,
              category: u.category,
              type: u.type,
              channel: u.channel,
            },
          },
          update: {
            enabled: u.enabled,
            frequency: u.frequency ?? null,
            digestTime: u.digestTime ?? null,
          },
          create: {
            userId,
            brandId: u.brandId,
            category: u.category,
            type: u.type,
            channel: u.channel,
            enabled: u.enabled,
            frequency: u.frequency ?? null,
            digestTime: u.digestTime ?? null,
          },
        });
      } else {
        // Account-level (no brand): emulate upsert using findFirst/update/create
        const existing = await prisma.notificationPreference.findFirst({
          where: {
            userId,
            brandId: null,
            category: u.category,
            type: u.type,
            channel: u.channel,
          },
          select: { id: true },
        });
        if (existing?.id) {
          await prisma.notificationPreference.update({
            where: { id: existing.id },
            data: {
              enabled: u.enabled,
              frequency: u.frequency ?? null,
              digestTime: u.digestTime ?? null,
            },
          });
        } else {
          await prisma.notificationPreference.create({
            data: {
              userId,
              brandId: null,
              category: u.category,
              type: u.type,
              channel: u.channel,
              enabled: u.enabled,
              frequency: u.frequency ?? null,
              digestTime: u.digestTime ?? null,
            },
          });
        }
      }
    }
    return { success: true };
  }

  private async getUnreadCount(userId: string): Promise<number> {
    const state = await prisma.userNotificationState.findUnique({ where: { userId } });
    return state?.unreadCount ?? 0;
  }

  private async recomputeUnreadCount(userId: string): Promise<number> {
    const unread = await prisma.notification.count({
      where: { userId, readAt: null, archivedAt: null },
    });
    await prisma.userNotificationState.upsert({
      where: { userId },
      update: { unreadCount: unread, lastSeenAt: new Date() },
      create: { userId, unreadCount: unread },
    });
    return unread;
  }

  private defaultPreferences() {
    // Baseline defaults for UI; server still enforces critical via logic when needed
    return [
      { category: 'publishing', type: 'publishing.post_failed', channel: 'email', enabled: true },
      { category: 'publishing', type: 'publishing.post_failed', channel: 'in_app', enabled: true },
      {
        category: 'accounts',
        type: 'accounts.account_disconnected',
        channel: 'email',
        enabled: true,
      },
      { category: 'accounts', type: 'accounts.token_expiring', channel: 'email', enabled: true },
      { category: 'billing', type: 'billing.payment_failed', channel: 'email', enabled: true },
    ];
  }
}

export const notificationsService = new NotificationsServiceImpl();
