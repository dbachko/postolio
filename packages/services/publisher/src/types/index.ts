import type { EventBridgeEvent as AwsEventBridgeEvent } from 'aws-lambda';

export { PLATFORM_LIMITS } from '../constants';

// Event from scheduler (minimal data)
export interface PublishEvent {
  scheduleId: string;
  brandId?: string;
  userId?: string;
}

export type ScheduleDueDetail = {
  scheduleId: string;
  brandId?: string;
  userId?: string;
  retryAttempt?: number;
};

export type PlatformName = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';

export interface Schedule {
  scheduleId?: string;
  contentId?: string;
  brandId?: string;
  userId?: string;
  caption?: string;
  hashtags?: string[];
  contentType?: 'post' | 'reel' | 'story' | string;
  mediaType?: 'image' | 'video' | 'reel' | 'carousel' | string;
  imageUrl?: string;
  mediaAssets?: MediaAsset[];
  videoUrl?: string;
  shareToFeed?: boolean;
  thumbOffset?: number;
  platform: PlatformName;
  firstComment?: string | unknown;
  [key: string]: unknown;
}

export interface ScheduleRecord extends Schedule {
  pk: string;
  sk: string;
}

export interface Credentials {
  accessToken: string;
  accountId?: string;
  pageId?: string;
  expiresAt?: string;
  apiKey?: string;
  apiSecret?: string;
  channelId?: string;
}

export interface PlatformAdapter {
  publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult>;
  validateCredentials(credentials: Credentials): boolean;
  formatContent(schedule: Schedule): unknown;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
  errorCode?: string;
  httpStatus?: number;
}

export type PublishedMedia = {
  postId: string;
  permalink: string;
};

export type ResolvedMedia = {
  kind: 'image' | 'video';
  url: string;
  duration?: number;
  thumbOffset?: number;
};

export interface MediaAsset {
  key: string;
  type: 'image' | 'video';
  order: number;
  width?: number;
  height?: number;
  assetId?: string;
  duration?: number;
}

export interface TokenServiceResponse {
  accessToken: string;
  expiresAt?: string;
  accountId?: string;
  pageId?: string;
}

export type PublishMarker = {
  platformPostId?: string;
  permalink?: string;
};

export interface IGErrorPayload {
  error?: {
    error_user_msg?: string;
    message?: string;
    error_user_title?: string;
  };
}

export function toPublishEvent(
  rawEvent: AwsEventBridgeEvent<'schedule.due', ScheduleDueDetail> | PublishEvent
): PublishEvent {
  if (typeof rawEvent === 'object' && rawEvent !== null && 'detail' in rawEvent) {
    const rawDetail = (rawEvent as AwsEventBridgeEvent<'schedule.due', unknown>).detail;
    let detail: Partial<ScheduleDueDetail> = {};
    if (typeof rawDetail === 'string') {
      try {
        detail = JSON.parse(rawDetail);
      } catch {
        detail = {};
      }
    } else if (typeof rawDetail === 'object' && rawDetail !== null) {
      detail = rawDetail as ScheduleDueDetail;
    }
    return {
      scheduleId: detail.scheduleId || '',
      brandId: detail.brandId,
      userId: detail.userId,
    };
  }
  return rawEvent as PublishEvent;
}
