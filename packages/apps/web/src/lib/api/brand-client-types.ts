import type { Platform } from '@/lib/platform-config';
import type { ImageProvider } from '@/types/image-providers';

export type BrandImageProviderPreference = {
  imageProvider: ImageProvider | null;
  defaultProvider: ImageProvider | null;
};

export type ImageAnalyticsResponse = {
  overall: {
    totalGenerated: number;
    totalCost: number;
    avgCostPerImage: number;
  };
  byProvider: Record<
    string,
    {
      count: number;
      totalCost: number;
      totalTime: number;
      avgCost: number;
      avgTime: number;
    }
  >;
  recentLogs: Array<{
    id: string;
    provider: string;
    cost: number;
    generationTime: number;
    status: string;
    createdAt: string;
  }>;
};

export type ContentSeriesSummary = {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  color: string | null;
  kind: 'batch' | 'rolling';
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
};

export type GetInboxItemsOptions = {
  socialAccountIds?: string[];
  channels?: Array<'comments' | 'dms'>;
  platforms?: string[];
  view?: 'to_review' | 'all';
  limit?: number;
};

export type GetInboxItemsResponse = {
  items: Array<
    | {
        type: 'comment_thread';
        platform: Platform;
        socialAccountId: string;
        publicationId: string;
        postId: string;
        caption: string | null;
        primaryAssetId: string | null;
        permalink: string | null;
        postedAt: string | null;
        totalComments: number;
        resolvedCount: number;
        newCount: number;
        lastActivityAt: string | null;
        previewText: string | null;
        previewAuthorUsername: string | null;
      }
    | {
        type: 'dm_conversation';
        platform: Platform;
        socialAccountId: string;
        conversationId: string;
        state: 'active' | 'archived' | 'spam';
        participantUsername: string;
        lastMessageAt: string;
        lastMessageText: string | null;
        lastMessageDirection: 'inbound' | 'outbound' | null;
        messageCount: number;
      }
  >;
};

export type IngestInboxCommentsOptions = {
  socialAccountIds?: string[];
  sync?: boolean;
  maxPosts?: number;
  perPostLimit?: number;
};

export type IngestInboxCommentsResponse =
  | {
      success: true;
      enqueued: true;
      jobId?: string | number | null;
      nextAllowed?: string | null;
    }
  | {
      success: true;
      enqueued: false;
      result: { postsProcessed: number; commentsUpserted: number };
    }
  | { success: false; error: string; nextAllowed?: string };

export type IngestInboxDMsOptions = {
  socialAccountIds?: string[];
  sync?: boolean;
  maxThreads?: number;
  perThreadLimit?: number;
};

export type IngestInboxDMsResponse =
  | {
      success: true;
      enqueued: true;
      jobId?: string | number | null;
      nextAllowed?: string | null;
    }
  | {
      success: true;
      enqueued: false;
      result: {
        accountsProcessed: number;
        threadsProcessed: number;
        conversationsUpserted: number;
        messagesInserted: number;
      };
    }
  | { success: false; error: string; nextAllowed?: string };
