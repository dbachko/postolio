export interface MediaAsset {
  key: string;
  type: 'image' | 'video';
  order: number;
  width?: number;
  height?: number;
  assetId?: string;
  duration?: number;
}

export interface ScheduleRequest {
  contentId: string;
  brandId: string;
  userId: string;
  platform: string;
  scheduledAt: string;
  contentType?: string;
  mediaType?: string;
  videoUrl?: string;
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  mediaAssets?: MediaAsset[];
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
  thumbOffset?: number;
  idempotencyToken?: string;
}

export interface PublishNowScheduleRequest extends Omit<ScheduleRequest, 'scheduledAt'> {
  scheduledAt?: string;
}

export interface Schedule {
  pk: string;
  sk: string;
  scheduleId: string;
  contentId: string;
  brandId: string;
  userId: string;
  status: string;
  scheduledAt: string;
  gsi1pk?: string;
  gsi1sk?: string;
  platform: string;
  contentType?: string;
  mediaType?: string;
  videoUrl?: string;
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  mediaAssets?: MediaAsset[];
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
  thumbOffset?: number;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
  eventBridgeScheduleArn?: string;
  eventBridgeScheduleCreated?: boolean;
  idempotencyToken?: string;
}

export interface ScheduleResult {
  success: boolean;
  schedule?: Schedule;
  error?: string;
}

export interface ListSchedulesResult {
  success: boolean;
  schedules?: Schedule[];
  pagination?: {
    nextToken?: string;
    hasMore: boolean;
  };
  error?: string;
}

export interface ScheduleFailureContext {
  contentId?: string;
  brandId?: string;
  platform?: string;
}

export type ScheduleOperation = 'create' | 'update' | 'delete';
