import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { Platform } from '@postolio/database';

export type ContentStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'skipped'
  | 'unavailable';

export interface StatusChangeEvent {
  type: 'status_change';
  contentId: string;
  oldStatus: ContentStatus;
  newStatus: ContentStatus;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface DMMessageEvent {
  type: 'dm_message';
  conversationId: string;
  messageId: string;
  brandId: string;
  socialAccountId: string;
  platform: Platform;
  direction: 'inbound' | 'outbound';
  messageText: string;
  participantUsername: string;
  timestamp: string;
}

export interface DMConversationUpdateEvent {
  type: 'dm_conversation_update';
  conversationId: string;
  brandId: string;
  state: 'active' | 'archived' | 'spam';
  lastMessageAt: string;
  timestamp: string;
}

export class StatusBroadcaster {
  constructor(
    private fastify: FastifyInstance,
    private redis: Redis
  ) {}

  /**
   * Broadcast a status change to all connected clients in the brand room
   * and store the event in Redis Stream for persistence
   */
  async broadcastStatusChange(
    contentId: string,
    brandId: string,
    oldStatus: ContentStatus,
    newStatus: ContentStatus,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const timestamp = Date.now();

    // Store in Redis Stream for event retention (7 days)
    try {
      await this.redis.xadd(
        `events:${brandId}`,
        'MAXLEN',
        '~',
        '10000', // Keep approximately 10k events max
        '*', // Auto-generate ID
        'type',
        'status_change',
        'contentId',
        contentId,
        'oldStatus',
        oldStatus,
        'newStatus',
        newStatus,
        'metadata',
        JSON.stringify(metadata || {}),
        'timestamp',
        timestamp.toString()
      );
    } catch (error) {
      this.fastify.log.error({ error, brandId, contentId }, 'Failed to store event in Redis');
    }

    // Broadcast to connected WebSocket clients
    try {
      this.fastify.broadcastToRoom(`brand:${brandId}`, {
        type: 'status_update',
        data: {
          contentId,
          oldStatus,
          newStatus,
          metadata,
          timestamp: new Date(timestamp).toISOString(),
        },
      });
    } catch (error) {
      this.fastify.log.error({ error, brandId }, 'Failed to broadcast to WebSocket clients');
    }
  }

  /**
   * Get recent events for a brand (for catch-up on reconnection)
   */
  async getRecentEvents(brandId: string, limit: number = 100): Promise<StatusChangeEvent[]> {
    try {
      // Get events from Redis Stream in reverse order (newest first)
      const events = await this.redis.xrevrange(
        `events:${brandId}`,
        '+', // End (newest)
        '-', // Start (oldest)
        'COUNT',
        limit.toString()
      );

      return events
        .map(([, fields]) => {
          const data = this.parseStreamFields(fields);
          return {
            type: 'status_change' as const,
            contentId: data.contentId || '',
            oldStatus: (data.oldStatus || 'draft') as ContentStatus,
            newStatus: (data.newStatus || 'draft') as ContentStatus,
            metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
            timestamp: new Date(parseInt(data.timestamp || '0')).toISOString(),
          };
        })
        .filter((event) => event.contentId !== '');
    } catch (error) {
      this.fastify.log.error({ error, brandId }, 'Failed to get recent events');
      return [];
    }
  }

  /**
   * Clean up events older than 7 days
   */
  async cleanupOldEvents(brandId: string): Promise<void> {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    try {
      // Get all events
      const events = await this.redis.xrange(`events:${brandId}`, '-', '+');

      // Find events to delete
      const toDelete: string[] = [];
      for (const [id, fields] of events) {
        const data = this.parseStreamFields(fields);
        const timestamp = parseInt(data.timestamp || '0');
        if (timestamp < sevenDaysAgo) {
          toDelete.push(id);
        }
      }

      // Delete old events
      if (toDelete.length > 0) {
        await this.redis.xdel(`events:${brandId}`, ...toDelete);
      }
    } catch (error) {
      this.fastify.log.error({ error, brandId }, 'Failed to cleanup old events');
    }
  }

  /**
   * Broadcast a batch of status changes (for bulk operations)
   */
  async broadcastBatchStatusChanges(
    changes: Array<{
      contentId: string;
      brandId: string;
      oldStatus: ContentStatus;
      newStatus: ContentStatus;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<void> {
    // Group by brand for efficient broadcasting
    const changesByBrand = new Map<string, typeof changes>();

    for (const change of changes) {
      if (!changesByBrand.has(change.brandId)) {
        changesByBrand.set(change.brandId, []);
      }
      changesByBrand.get(change.brandId)!.push(change);
    }

    // Process each brand's changes
    for (const [brandId, brandChanges] of Array.from(changesByBrand.entries())) {
      const timestamp = Date.now();

      // Store all events for this brand in a pipeline
      const pipeline = this.redis.pipeline();

      for (const change of brandChanges) {
        pipeline.xadd(
          `events:${brandId}`,
          'MAXLEN',
          '~',
          '10000',
          '*',
          'type',
          'status_change',
          'contentId',
          change.contentId,
          'oldStatus',
          change.oldStatus,
          'newStatus',
          change.newStatus,
          'metadata',
          JSON.stringify(change.metadata || {}),
          'timestamp',
          timestamp.toString()
        );
      }

      try {
        await pipeline.exec();
      } catch (_error: unknown) {
        const message = _error instanceof Error ? _error.message : 'An unknown error occurred';
        this.fastify.log.error({ error: message, brandId }, 'Failed to store batch events');
      }

      // Broadcast batch update to WebSocket clients
      try {
        this.fastify.broadcastToRoom(`brand:${brandId}`, {
          type: 'batch_status_update',
          data: brandChanges.map((change) => ({
            contentId: change.contentId,
            oldStatus: change.oldStatus,
            newStatus: change.newStatus,
            metadata: change.metadata,
            timestamp: new Date(timestamp).toISOString(),
          })),
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        this.fastify.log.error({ error: message, brandId }, 'Failed to broadcast batch update');
      }
    }
  }

  /**
   * Get event statistics for monitoring
   */
  async getEventStats(brandId: string): Promise<{
    totalEvents: number;
    oldestEvent: string | null;
    newestEvent: string | null;
  }> {
    try {
      const info = (await this.redis.xinfo('STREAM', `events:${brandId}`)) as unknown[];

      return {
        totalEvents: (info[1] as number) || 0, // length field
        oldestEvent:
          info[3] && typeof info[3] === 'string'
            ? (() => {
                const parts = info[3].split('-');
                return parts[0] ? new Date(parseInt(parts[0])).toISOString() : null;
              })()
            : null,
        newestEvent:
          info[5] && typeof info[5] === 'string'
            ? (() => {
                const parts = info[5].split('-');
                return parts[0] ? new Date(parseInt(parts[0])).toISOString() : null;
              })()
            : null,
      };
    } catch {
      // Stream doesn't exist yet
      return {
        totalEvents: 0,
        oldestEvent: null,
        newestEvent: null,
      };
    }
  }

  /**
   * Parse Redis Stream fields into an object
   */
  private parseStreamFields(fields: string[]): Record<string, string> {
    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      if (key && value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * Broadcast new DM message to connected clients
   */
  async broadcastDMMessage(params: {
    conversationId: string;
    messageId: string;
    brandId: string;
    socialAccountId: string;
    platform: Platform;
    direction: 'inbound' | 'outbound';
    messageText: string;
    participantUsername: string;
  }): Promise<void> {
    const {
      conversationId,
      messageId,
      brandId,
      socialAccountId,
      platform,
      direction,
      messageText,
      participantUsername,
    } = params;
    const timestamp = Date.now();
    const event: DMMessageEvent = {
      type: 'dm_message',
      conversationId,
      messageId,
      brandId,
      socialAccountId,
      platform,
      direction,
      messageText,
      participantUsername,
      timestamp: new Date(timestamp).toISOString(),
    };

    // Store in Redis Stream for DM events
    try {
      await this.redis.xadd(
        `dm_events:${brandId}`,
        'MAXLEN',
        '~',
        '5000', // Keep approximately 5k DM events max
        '*',
        'type',
        'dm_message',
        'conversationId',
        conversationId,
        'messageId',
        messageId,
        'direction',
        direction,
        'messageText',
        messageText,
        'socialAccountId',
        socialAccountId,
        'platform',
        platform,
        'participantUsername',
        participantUsername,
        'timestamp',
        timestamp.toString()
      );
    } catch (error) {
      this.fastify.log.error(
        { error, brandId, conversationId },
        'Failed to store DM event in Redis'
      );
    }

    // Broadcast to brand room
    try {
      this.fastify.broadcastToRoom(`brand:${brandId}`, event as unknown as Record<string, unknown>);
    } catch (error) {
      this.fastify.log.error({ error, brandId, conversationId }, 'Failed to broadcast DM message');
    }
  }

  /**
   * Broadcast conversation state update to connected clients
   */
  async broadcastDMConversationUpdate(
    conversationId: string,
    brandId: string,
    state: 'active' | 'archived' | 'spam',
    lastMessageAt: Date
  ): Promise<void> {
    const timestamp = Date.now();
    const event: DMConversationUpdateEvent = {
      type: 'dm_conversation_update',
      conversationId,
      brandId,
      state,
      lastMessageAt: lastMessageAt.toISOString(),
      timestamp: new Date(timestamp).toISOString(),
    };

    // Store in Redis Stream for conversation events
    try {
      await this.redis.xadd(
        `dm_conversation_events:${brandId}`,
        'MAXLEN',
        '~',
        '1000', // Keep approximately 1k conversation events max
        '*',
        'type',
        'dm_conversation_update',
        'conversationId',
        conversationId,
        'state',
        state,
        'lastMessageAt',
        lastMessageAt.toISOString(),
        'timestamp',
        timestamp.toString()
      );
    } catch (error) {
      this.fastify.log.error(
        { error, brandId, conversationId },
        'Failed to store conversation event in Redis'
      );
    }

    // Broadcast to brand room
    try {
      this.fastify.broadcastToRoom(`brand:${brandId}`, event as unknown as Record<string, unknown>);
    } catch (error) {
      this.fastify.log.error(
        { error, brandId, conversationId },
        'Failed to broadcast conversation update'
      );
    }
  }
}
