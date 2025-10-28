import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';

export interface NotificationDTO {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  resource?: { type?: string | null; id?: string | null };
  createdAt: string;
  readAt?: string | null;
}

export class NotificationsBroadcaster {
  constructor(
    private fastify: FastifyInstance,
    private redis: Redis
  ) {}

  private streamKey(userId: string): string {
    return `events:notifications:${userId}`;
  }

  async broadcastNew(userId: string, notification: NotificationDTO): Promise<void> {
    const timestamp = Date.now();
    try {
      await this.redis.xadd(
        this.streamKey(userId),
        'MAXLEN',
        '~',
        '5000',
        '*',
        'type',
        'notification_created',
        'payload',
        JSON.stringify(notification),
        'timestamp',
        timestamp.toString()
      );
    } catch (error) {
      this.fastify.log.error({ error, userId }, 'Failed to store notification event');
    }

    try {
      this.fastify.broadcastToRoom(`user:${userId}`, {
        type: 'notification_created',
        data: notification,
      } as unknown as Record<string, unknown>);
    } catch (error) {
      this.fastify.log.error({ error, userId }, 'Failed to broadcast notification');
    }
  }

  async broadcastUnreadCount(userId: string, count: number): Promise<void> {
    try {
      this.fastify.broadcastToRoom(`user:${userId}`, {
        type: 'unread_count',
        data: { count },
      } as unknown as Record<string, unknown>);
    } catch (error) {
      this.fastify.log.error({ error, userId }, 'Failed to broadcast unread count');
    }
  }
}
