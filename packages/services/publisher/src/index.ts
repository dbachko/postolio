import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { signRequest } from '@postolio/aws';
import { API_VERSIONS, API_BASE_URLS } from '@postolio/aws';
import {
  getCampaignByContentId,
  getCampaignById,
  isCampaignActive,
  getCampaignBlockReason,
  getServiceUrl,
} from '@postolio/aws';
import { EventBridge } from '@aws-sdk/client-eventbridge';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import type { EventBridgeEvent as AwsEventBridgeEvent } from 'aws-lambda';

// Platform-specific character limits
const PLATFORM_LIMITS = {
  INSTAGRAM_CAPTION: 2200,
  FACEBOOK_POST: 63206,
  TWITTER_TWEET: 280,
  LINKEDIN_POST: 3000,
  YOUTUBE_TITLE: 100,
  YOUTUBE_DESCRIPTION: 5000,
} as const;

// Initialize Powertools
const logger = new Logger({ serviceName: 'publisher' });
const tracer = new Tracer({ serviceName: 'publisher' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'publisher',
});

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const eventBridge = new EventBridge({});
const sqsClient = tracer.captureAWSv3Client(new SQSClient({}));
const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));

// Event from scheduler (minimal data)
interface PublishEvent {
  scheduleId: string;
  brandId?: string;
  userId?: string;
}

type ScheduleDueDetail = {
  scheduleId: string;
  brandId?: string;
  userId?: string;
  retryAttempt?: number;
};

type PlatformName = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';

interface Schedule {
  scheduleId?: string;
  contentId?: string;
  brandId?: string;
  userId?: string;
  caption?: string;
  hashtags?: string[];
  contentType?: 'post' | 'reel' | 'story' | string; // User-facing type
  mediaType?: 'image' | 'video' | 'reel' | 'carousel' | string; // Media format
  imageUrl?: string;
  mediaAssets?: MediaAsset[];
  videoUrl?: string;
  shareToFeed?: boolean;
  thumbOffset?: number; // Video thumbnail offset in milliseconds
  platform: PlatformName;
  [key: string]: unknown; // allow additional persisted attributes
}

interface Credentials {
  accessToken: string;
  accountId?: string;
  pageId?: string;
  expiresAt?: string;
  apiKey?: string;
  apiSecret?: string;
  channelId?: string;
}

interface PlatformAdapter {
  publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult>;
  validateCredentials(credentials: Credentials): boolean;
  formatContent(schedule: Schedule): unknown;
}

interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
  // Structured error metadata for downstream retry logic
  errorCode?: string;
  httpStatus?: number;
}

type PublishedMedia = {
  postId: string;
  permalink: string;
};

type ResolvedMedia = {
  kind: 'image' | 'video';
  url: string;
  duration?: number; // Video duration in seconds
  thumbOffset?: number; // Thumbnail offset in milliseconds (for Instagram API)
};

/**
 * Structured media asset information
 * Eliminates need for file extension parsing
 */
interface MediaAsset {
  key: string;
  type: 'image' | 'video';
  order: number;
  width?: number;
  height?: number;
  assetId?: string;
  duration?: number;
}

// Platform adapter factory
class PlatformAdapterFactory {
  static getAdapter(platform: string): PlatformAdapter {
    switch (platform) {
      case 'instagram':
        return new InstagramAdapter();
      case 'facebook':
        return new FacebookAdapter();
      case 'twitter':
        return new TwitterAdapter();
      case 'linkedin':
        return new LinkedInAdapter();
      case 'youtube':
        return new YouTubeAdapter();
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
}

// Instagram adapter implementation
class InstagramAdapter implements PlatformAdapter {
  private async waitForMediaReady(
    creationId: string,
    accessToken: string,
    isVideo: boolean,
    opts?: { throwOnTimeout?: boolean; maxWaitMs?: number; pollIntervalMs?: number }
  ): Promise<boolean> {
    // Tests should not wait for real media processing; allow skip via env or NODE_ENV.
    if (process.env.IG_SKIP_MEDIA_WAIT === 'true' || process.env.NODE_ENV === 'test') {
      return true;
    }

    const statusUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${creationId}`;
    // Videos can take 10-15 minutes to process, images are much faster
    const defaultMaxWait = isVideo ? 900_000 : 300_000; // 15 min for video, 5 min for images
    const maxWaitMs = opts?.maxWaitMs ?? defaultMaxWait;
    const pollIntervalMs = opts?.pollIntervalMs ?? 60_000; // Check every 60s
    const throwOnTimeout = opts?.throwOnTimeout ?? true;
    const started = Date.now();
    let attempt = 0;
    let lastStatus: string | undefined;

    while (Date.now() - started < maxWaitMs) {
      try {
        const params = new URLSearchParams({
          fields: 'status_code',
          access_token: accessToken,
        });
        const resp = await fetch(`${statusUrl}?${params}`);
        let body: unknown;
        try {
          body = await resp.json();
        } catch {
          body = undefined;
        }
        const statusCodeValue =
          body && typeof body === 'object' && 'status_code' in body
            ? String(
                (body as { status_code?: string | number | null | undefined }).status_code ?? ''
              )
            : '';
        const code = statusCodeValue.toUpperCase();
        lastStatus = code || lastStatus;

        if (attempt === 0 || attempt % 5 === 0) {
          logger.info('Instagram media status check', {
            creationId,
            attempt,
            status_code: code || 'UNKNOWN',
            httpStatus: resp.status,
          });
        }

        if (!resp.ok) {
          const errorPayload =
            body && typeof body === 'object' && 'error' in body
              ? (
                  body as {
                    error?: { error_user_msg?: string; message?: string };
                  }
                ).error
              : undefined;
          const message =
            errorPayload?.error_user_msg || errorPayload?.message || `HTTP ${resp.status}`;
          logger.warn('Instagram media status check returned HTTP error', {
            creationId,
            attempt,
            httpStatus: resp.status,
            error: message,
          });
          if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
            throw new Error(`Instagram status endpoint returned ${resp.status}`);
          }
        }

        if (!code) {
          const logPayload = {
            creationId,
            attempt,
            raw_body: body,
            httpStatus: resp.status,
          };
          if (attempt === 0) {
            logger.warn('Instagram media status response had no status code', logPayload);
          } else {
            logger.debug('Instagram media status response had no status code', logPayload);
          }
        }

        if (code === 'FINISHED' || code === 'PUBLISHED' || code === 'READY') return true; // Ready
        if (code === 'ERROR' || code === 'EXPIRED') {
          logger.error('Instagram media processing error reported by API', {
            creationId,
            attempt,
            status_code: code || 'UNKNOWN',
            raw_body: body,
          });
          // Non-retryable: Instagram explicitly reported a processing error
          throw new Error('Instagram media processing error');
        }
      } catch (e) {
        // Treat explicit processing errors as terminal and bubble them up
        if ((e as Error)?.message === 'Instagram media processing error') {
          throw e;
        }
        // Log and continue until timeout; transient errors are common
        logger.warn('Failed to check Instagram media status', {
          creationId,
          attempt,
          error: (e as Error).message,
        });
      }

      attempt += 1;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    logger.warn('Timed out waiting for Instagram media readiness', {
      creationId,
      isVideo,
      waitedMs: Date.now() - started,
      lastStatus: lastStatus || 'UNKNOWN',
    });

    if (throwOnTimeout) {
      throw new Error('Media is not ready for publishing after waiting');
    }
    return false;
  }
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _mediaUrl: string | null
  ): Promise<PublishResult> {
    try {
      const formattedCaption = this.formatCaption(schedule.caption, schedule.hashtags);
      // Derive media/product type semantics from schedule.
      const contentType = (schedule.contentType || '').toLowerCase();
      const isReel = contentType === 'reel';
      const isStory = contentType === 'story';

      // Resolve media assets from structured mediaAssets
      const resolvedMedia: ResolvedMedia[] = [];

      if (!schedule.mediaAssets || schedule.mediaAssets.length === 0) {
        throw new Error('Media assets are required for Instagram publishing');
      }

      logger.info('Resolving structured mediaAssets for publishing', {
        assetCount: schedule.mediaAssets.length,
        types: schedule.mediaAssets.map((a) => a.type).join(','),
      });

      for (const asset of schedule.mediaAssets) {
        const signedUrl =
          asset.type === 'video'
            ? await getSignedVideoUrl(asset.key)
            : await getSignedImageUrlFromKey(asset.key);

        if (signedUrl) {
          resolvedMedia.push({
            kind: asset.type,
            url: signedUrl,
          });
        }
      }

      if (!resolvedMedia.length) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      // Story flow: publish each asset as its own story frame (videos publish alone)
      if (isStory) {
        const storyMedia = hasVideoAsset
          ? resolvedMedia.filter((m) => m.kind === 'video')
          : resolvedMedia.filter((m) => m.kind === 'image');

        if (!storyMedia.length) {
          throw new Error('Media URL is required for Instagram publishing');
        }

        const published: PublishedMedia[] = [];
        for (const asset of storyMedia.slice(0, 10)) {
          const single = await this.createAndPublishMedia({
            schedule,
            credentials,
            formattedCaption,
            mediaUrl: asset.url,
            isVideo: asset.kind === 'video',
            isReel,
            isStory,
            thumbOffset: asset.kind === 'video' ? schedule.thumbOffset : undefined,
          });
          published.push(single);
        }
        const first = published[0];
        return {
          success: true,
          platformPostId: first?.postId,
          platformUrl: first?.permalink,
        };
      }

      // Feed/Reel flow
      const isCarousel = !isReel && resolvedMedia.length > 1 && resolvedMedia.length <= 10;
      const hasVideoMedia = resolvedMedia.some((m) => m.kind === 'video');

      if (isCarousel) {
        const carousel = await this.createCarouselAndPublish({
          schedule,
          credentials,
          formattedCaption,
          media: resolvedMedia.slice(0, 10),
          hasVideoMedia,
        });
        return {
          success: true,
          platformPostId: carousel.postId,
          platformUrl: carousel.permalink,
        };
      }

      // Single media (feed or reel)
      const primary = resolvedMedia[0];
      const single = await this.createAndPublishMedia({
        schedule,
        credentials,
        formattedCaption,
        mediaUrl: primary.url,
        isVideo: primary.kind === 'video',
        isReel,
        isStory,
        thumbOffset: schedule.thumbOffset,
      });

      return {
        success: true,
        platformPostId: single.postId,
        platformUrl: single.permalink,
      };
    } catch (error) {
      const err = error as Error;
      const meta = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
      logger.error('Instagram publishing failed', {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
        meta,
      });
      return {
        success: false,
        error: err.message,
        errorCode: (meta as { errorCode?: string }).errorCode || 'IG_PUBLISH_RUNTIME_ERROR',
        httpStatus: (meta as { httpStatus?: number }).httpStatus,
      };
    }
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && credentials?.accountId);
  }

  formatContent(schedule: Schedule): unknown {
    const mediaTypeRaw = (schedule.mediaType || schedule.contentType || '').toLowerCase();
    const effectiveMediaType =
      mediaTypeRaw === 'video' || mediaTypeRaw === 'reel' ? 'REELS' : 'IMAGE';
    return {
      caption: this.formatCaption(schedule.caption, schedule.hashtags),
      mediaType: effectiveMediaType,
    };
  }

  private formatCaption(
    caption: string | undefined | null,
    hashtags: string[] | undefined
  ): string {
    const safeCaption = caption ?? '';
    const hashtagString = hashtags?.length
      ? '\n\n' + hashtags.map((tag) => `#${tag}`).join(' ')
      : '';
    return `${safeCaption}${hashtagString}`.slice(0, PLATFORM_LIMITS.INSTAGRAM_CAPTION);
  }

  private async createAndPublishMedia(params: {
    schedule: Schedule;
    credentials: Credentials;
    formattedCaption: string;
    mediaUrl: string;
    isVideo: boolean;
    isReel: boolean;
    isStory: boolean;
    thumbOffset?: number;
  }): Promise<PublishedMedia> {
    const {
      schedule,
      credentials,
      formattedCaption,
      mediaUrl,
      isVideo,
      isReel,
      isStory,
      thumbOffset,
    } = params;

    // Step 1: Create media container
    const createMediaUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media`;
    const createMediaParams = new URLSearchParams({
      caption: formattedCaption,
      access_token: credentials.accessToken,
    });
    if (isVideo) {
      createMediaParams.set('video_url', mediaUrl);
      // For video containers, media_type controls whether this is a feed video,
      // reel, or story per Meta docs.
      if (isReel) {
        createMediaParams.set('media_type', 'REELS');
        const shareToFeed =
          schedule.contentType === 'reel'
            ? typeof schedule.shareToFeed === 'boolean'
              ? schedule.shareToFeed
              : true
            : true;
        // Control whether the reel should also appear in the feed grid.
        createMediaParams.set('share_to_feed', shareToFeed ? 'true' : 'false');

        // Set video thumbnail offset if provided (milliseconds from start)
        if (thumbOffset !== undefined && thumbOffset >= 0) {
          createMediaParams.set('thumb_offset', thumbOffset.toString());
        }
      } else if (isStory) {
        createMediaParams.set('media_type', 'STORIES');
      } else {
        // Meta deprecated VIDEO for feed publishing; use REELS with share_to_feed
        // to emulate classic feed videos.
        const shareToFeed = typeof schedule.shareToFeed === 'boolean' ? schedule.shareToFeed : true;
        createMediaParams.set('media_type', 'REELS');
        createMediaParams.set('share_to_feed', shareToFeed ? 'true' : 'false');

        // Set video thumbnail offset if provided
        if (thumbOffset !== undefined && thumbOffset >= 0) {
          createMediaParams.set('thumb_offset', thumbOffset.toString());
        }
      }
    } else {
      createMediaParams.set('image_url', mediaUrl);
      // For image stories, Instagram supports media_type=STORIES as well.
      if (isStory) {
        createMediaParams.set('media_type', 'STORIES');
      }
    }

    logger.info('Creating Instagram media container', {
      accountId: credentials.accountId,
      hasMediaUrl: !!mediaUrl,
      mediaKind: isReel
        ? 'reel'
        : isStory
          ? isVideo
            ? 'story_video'
            : 'story_image'
          : isVideo
            ? 'video'
            : 'image',
      contentType: schedule.contentType,
    });

    const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
      method: 'POST',
    });

    if (!createResponse.ok) {
      const raw = await createResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to create Instagram media container', {
        status: createResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create media: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: createResponse.status,
      };
      throw err;
    }

    const createResult = await createResponse.json();
    const creationId = createResult.id;

    if (!creationId) {
      const err = new Error('No creation ID returned from Instagram');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    if (isVideo) {
      await this.waitForMediaReady(creationId, credentials.accessToken, true, {
        throwOnTimeout: true,
      });
    }

    // Step 3: Publish the media (with a readiness-aware retry for images)
    const publishUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media_publish`;
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: credentials.accessToken,
    });

    const tryPublish = async () => {
      logger.info('Publishing Instagram media', { creationId });
      const resp = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });
      if (resp.ok) {
        return { resp };
      }
      const raw = await resp.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      return { resp, raw, igMsg, igTitle };
    };

    let publishAttempt = await tryPublish();

    const notReady =
      publishAttempt.igMsg &&
      /not ready|not\s+ready\s+for\s+publishing|finish processing|processing|cannot\s+be\s+found/i.test(
        publishAttempt.igMsg
      );
    if (!publishAttempt.resp.ok && notReady) {
      logger.warn('Instagram reported media not ready; waiting before retry', {
        creationId,
        isVideo,
        message: publishAttempt.igMsg,
      });
      if (isVideo) {
        await this.waitForMediaReady(creationId, credentials.accessToken, true, {
          throwOnTimeout: true,
        });
      } else {
        await new Promise((r) => setTimeout(r, 60_000));
      }
      publishAttempt = await tryPublish();
    }

    if (!publishAttempt.resp.ok) {
      const igMsg =
        publishAttempt.igMsg ||
        publishAttempt.raw ||
        `HTTP ${publishAttempt.resp.status} from Instagram`;
      const igTitle = publishAttempt.igTitle;
      logger.error('Failed to publish Instagram media', {
        status: publishAttempt.resp.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to publish: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_PUBLISH_FAILED',
        httpStatus: publishAttempt.resp.status,
        title: igTitle,
      };
      throw err;
    }

    const publishResult = await publishAttempt.resp.json();
    const postId = publishResult.id;

    // Step 4: Get the permalink
    const permalinkUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${postId}`;
    const permalinkParams = new URLSearchParams({
      fields: 'permalink',
      access_token: credentials.accessToken,
    });

    const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
    let permalink = '';

    if (permalinkResponse.ok) {
      const permalinkResult = await permalinkResponse.json();
      permalink = permalinkResult.permalink || '';
    }

    logger.info('Instagram content published successfully', {
      postId,
      permalink,
    });

    return { postId, permalink };
  }

  private async createCarouselAndPublish(params: {
    credentials: Credentials;
    formattedCaption: string;
    media: ResolvedMedia[];
    hasVideoMedia: boolean;
  }): Promise<PublishedMedia> {
    const { credentials, formattedCaption, media, hasVideoMedia } = params;

    const childIds: string[] = [];
    for (const asset of media) {
      const creationId = await this.createChildContainer({
        credentials,
        mediaUrl: asset.url,
        isVideo: asset.kind === 'video',
      });
      childIds.push(creationId);
    }

    if (!childIds.length) {
      const err = new Error('No carousel children were created');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    // Step 2: Create carousel container
    const createMediaUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media`;
    const createMediaParams = new URLSearchParams({
      caption: formattedCaption,
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      access_token: credentials.accessToken,
    });

    logger.info('Creating Instagram carousel container', {
      accountId: credentials.accountId,
      childCount: childIds.length,
    });

    const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
      method: 'POST',
    });

    if (!createResponse.ok) {
      const raw = await createResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to create Instagram carousel container', {
        status: createResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create carousel: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: createResponse.status,
      };
      throw err;
    }

    const createResult = await createResponse.json();
    const creationId = createResult.id;

    if (!creationId) {
      const err = new Error('No creation ID returned from Instagram for carousel');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    if (hasVideoMedia) {
      await this.waitForMediaReady(creationId, credentials.accessToken, true, {
        throwOnTimeout: true,
      });
    }

    // Step 4: Publish carousel
    const publishUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media_publish`;
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: credentials.accessToken,
    });

    const tryPublish = async () => {
      logger.info('Publishing Instagram carousel', { creationId });
      const resp = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });
      if (resp.ok) {
        return { resp };
      }
      const raw = await resp.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      return { resp, raw, igMsg, igTitle };
    };

    let publishAttempt = await tryPublish();
    const notReady =
      publishAttempt.igMsg &&
      /not ready|not\s+ready\s+for\s+publishing|finish processing|processing|cannot\s+be\s+found/i.test(
        publishAttempt.igMsg
      );

    if (!publishAttempt.resp.ok && notReady) {
      logger.warn('Carousel not ready; waiting before retry', {
        creationId,
        message: publishAttempt.igMsg,
      });
      if (hasVideoMedia) {
        await this.waitForMediaReady(creationId, credentials.accessToken, true, {
          throwOnTimeout: true,
        });
      } else {
        await new Promise((r) => setTimeout(r, 60_000));
      }
      publishAttempt = await tryPublish();
    }

    if (!publishAttempt.resp.ok) {
      const igMsg =
        publishAttempt.igMsg ||
        publishAttempt.raw ||
        `HTTP ${publishAttempt.resp.status} from Instagram`;
      const igTitle = publishAttempt.igTitle;
      logger.error('Failed to publish Instagram carousel', {
        status: publishAttempt.resp.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to publish carousel: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_PUBLISH_FAILED',
        httpStatus: publishAttempt.resp.status,
        title: igTitle,
      };
      throw err;
    }

    const publishResult = await publishAttempt.resp.json();
    const postId = publishResult.id;

    // Step 5: Get permalink
    const permalinkUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${postId}`;
    const permalinkParams = new URLSearchParams({
      fields: 'permalink',
      access_token: credentials.accessToken,
    });

    const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
    let permalink = '';

    if (permalinkResponse.ok) {
      const permalinkResult = await permalinkResponse.json();
      permalink = permalinkResult.permalink || '';
    }

    logger.info('Instagram carousel published successfully', {
      postId,
      permalink,
    });

    return { postId, permalink };
  }

  private async createChildContainer(params: {
    credentials: Credentials;
    mediaUrl: string;
    isVideo: boolean;
  }): Promise<string> {
    const { credentials, mediaUrl, isVideo } = params;
    const graphBase = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}`;

    // Image children still use standard image_url + is_carousel_item flow.
    if (!isVideo) {
      const createMediaUrl = `${graphBase}/${credentials.accountId}/media`;
      const createMediaParams = new URLSearchParams({
        access_token: credentials.accessToken,
        is_carousel_item: 'true',
        image_url: mediaUrl,
      });

      const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
        method: 'POST',
      });

      if (!createResponse.ok) {
        const raw = await createResponse.text();
        const parsed = asIGErrorPayload(safeParseJson(raw));
        const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
        const igTitle = parsed?.error?.error_user_title;
        logger.error('Failed to create Instagram carousel child', {
          status: createResponse.status,
          error: igMsg,
          title: igTitle,
        });
        const err = new Error(`Failed to create carousel child: ${igMsg}`);
        (err as unknown as { meta?: Record<string, unknown> }).meta = {
          errorCode: 'IG_MEDIA_CREATE_FAILED',
          httpStatus: createResponse.status,
        };
        throw err;
      }

      const createResult = await createResponse.json();
      const creationId = createResult.id;

      if (!creationId) {
        const err = new Error('No creation ID returned for carousel child');
        (err as unknown as { meta?: Record<string, unknown> }).meta = {
          errorCode: 'IG_MEDIA_CREATE_FAILED',
        };
        throw err;
      }

      return creationId;
    }

    // Video carousel children use the documented resumable upload flow.
    // Step 1: Start a resumable upload session for a VIDEO carousel item.
    const sessionParams = new URLSearchParams({
      media_type: 'VIDEO',
      is_carousel_item: 'true',
      upload_type: 'resumable',
      access_token: credentials.accessToken,
    });
    const sessionUrl = `${graphBase}/${credentials.accountId}/media?${sessionParams.toString()}`;

    const sessionResponse = await fetch(sessionUrl, { method: 'POST' });
    if (!sessionResponse.ok) {
      const raw = await sessionResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to start resumable upload session for carousel video child', {
        status: sessionResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create carousel child: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: sessionResponse.status,
      };
      throw err;
    }

    const sessionResult: { id?: string; upload_url?: string; uri?: string } =
      await sessionResponse.json();
    const creationId = sessionResult.id;
    if (!creationId) {
      const err = new Error('No creation ID returned for carousel child resumable session');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    // Prefer upload_url/uri from the response; fall back to documented rupload path.
    const uploadUrl =
      sessionResult.upload_url ||
      sessionResult.uri ||
      `https://rupload.facebook.com/ig-api-upload/${API_VERSIONS.FACEBOOK_GRAPH}/${creationId}`;

    // Step 2: Ask rupload service to fetch video from our hosted URL.
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${credentials.accessToken}`,
        // Meta docs: upload via hosted URL
        // curl -X POST https://rupload.facebook.com/ig-api-upload/v24.0/<IG_CONTAINER_ID> \
        //   -H "Authorization: OAuth <USER_ACCESS_TOKEN>" \
        //   -H "file_url: <VIDEO_URL>"
        file_url: mediaUrl,
      },
    });

    if (!uploadResponse.ok) {
      const raw = await uploadResponse.text();
      // Rupload responses are not always Graph-style errors, so fall back to raw text when needed.
      const parsed = safeParseJson(raw);
      const igMsg =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error?: { message?: string } }).error?.message || raw)
          : raw;
      logger.error('Failed to upload carousel video to Instagram via resumable endpoint', {
        status: uploadResponse.status,
        error: igMsg,
      });
      const err = new Error(`Failed to create carousel child: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: uploadResponse.status,
      };
      throw err;
    }

    return creationId;
  }

  /**
   * Post a comment on an Instagram media object
   */
  async postComment(
    mediaId: string,
    commentText: string,
    credentials: Credentials,
    account: { externalAccountId: string }
  ): Promise<{ success: boolean; commentId?: string; error?: string }> {
    void account; // Not used in this implementation
    try {
      // Validate comment text
      if (!commentText || commentText.trim().length === 0) {
        return { success: false, error: 'Comment text is required' };
      }

      // Truncate if too long
      let validatedText = commentText;
      if (commentText.length > 2200) {
        validatedText = commentText.slice(0, 2200);
      }

      // Check hashtag count (Instagram limit: 4 hashtags per comment)
      const hashtagCount = (validatedText.match(/#/g) || []).length;
      if (hashtagCount > 4) {
        return { success: false, error: 'Comments cannot contain more than 4 hashtags' };
      }

      // Check URL count (Instagram limit: 1 URL per comment)
      const urlPattern = /https?:\/\//gi;
      const urlMatches = validatedText.match(urlPattern) || [];
      if (urlMatches.length > 1) {
        return { success: false, error: 'Comments cannot contain more than 1 URL' };
      }

      // Post comment using Graph API
      const commentUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${mediaId}/comments`;
      const params = new URLSearchParams({
        message: validatedText,
        access_token: credentials.accessToken,
      });

      const response = await fetch(commentUrl, {
        method: 'POST',
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Instagram comment API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const commentId = data?.id;

      if (!commentId || typeof commentId !== 'string') {
        throw new Error('Failed to post Instagram comment - no comment ID returned');
      }

      return { success: true, commentId };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || 'Failed to post comment',
      };
    }
  }
}

// Facebook adapter (placeholder)
class FacebookAdapter implements PlatformAdapter {
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult> {
    void schedule;
    void credentials;
    void mediaUrl; // placeholder usage
    return { success: false, error: 'Facebook publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && credentials?.pageId);
  }

  formatContent(schedule: Schedule): unknown {
    return { message: schedule.caption };
  }
}

// Twitter adapter (placeholder)
class TwitterAdapter implements PlatformAdapter {
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult> {
    void schedule;
    void credentials;
    void mediaUrl; // placeholder usage
    return { success: false, error: 'Twitter publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.apiKey && credentials?.apiSecret);
  }

  formatContent(schedule: Schedule): unknown {
    return { text: schedule.caption?.slice(0, PLATFORM_LIMITS.TWITTER_TWEET) };
  }
}

// LinkedIn adapter (placeholder)
class LinkedInAdapter implements PlatformAdapter {
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult> {
    void schedule;
    void credentials;
    void mediaUrl; // placeholder usage
    return { success: false, error: 'LinkedIn publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!credentials?.accessToken;
  }

  formatContent(schedule: Schedule): unknown {
    return { text: schedule.caption };
  }
}

// YouTube adapter (placeholder)
class YouTubeAdapter implements PlatformAdapter {
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult> {
    void schedule;
    void credentials;
    void mediaUrl; // placeholder usage
    return { success: false, error: 'YouTube publishing not yet implemented' };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.apiKey && credentials?.channelId);
  }

  formatContent(schedule: Schedule): unknown {
    return {
      title: schedule.caption?.split('\n')[0]?.slice(0, PLATFORM_LIMITS.YOUTUBE_TITLE),
      description: schedule.caption?.slice(0, PLATFORM_LIMITS.YOUTUBE_DESCRIPTION),
    };
  }
}

function toPublishEvent(
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

export const handler = async (
  rawEvent: AwsEventBridgeEvent<'schedule.due', ScheduleDueDetail> | PublishEvent
): Promise<void> => {
  const event = toPublishEvent(rawEvent);
  logger.info('Publishing content', { scheduleId: event.scheduleId });

  try {
    // Get schedule details from DynamoDB (contains content)
    const schedule = await getSchedule(event.scheduleId);
    if (!schedule) {
      // Schedule doesn't exist - likely an orphaned retry
      logger.error('Schedule not found', {
        scheduleId: event.scheduleId,
        eventBrandId: event.brandId,
        eventUserId: event.userId,
      });

      // If we have brandId and userId from the event, create a failed status entry
      if (event.brandId && event.userId) {
        await createFailedScheduleEntry(
          event.scheduleId,
          event.brandId,
          event.userId,
          'Schedule not found'
        );
      }

      // Don't throw - just return to avoid endless retries
      metrics.addMetric('ScheduleNotFound', MetricUnit.Count, 1);
      metrics.publishStoredMetrics();
      return;
    }

    // 🔥 CRITICAL: Validate campaign status before publishing with consistency check
    const campaign = await getCampaignByContentId(schedule.contentId || event.scheduleId);

    // For critical publishing decisions, perform consistency validation if we have a campaign
    let validatedCampaign = campaign;
    if (campaign) {
      try {
        validatedCampaign = await getCampaignById(campaign.campaignId, true); // Enable consistency validation
        if (validatedCampaign && validatedCampaign.status !== campaign.status) {
          logger.warn('Campaign status changed after consistency validation', {
            scheduleId: event.scheduleId,
            campaignId: campaign.campaignId,
            originalStatus: campaign.status,
            validatedStatus: validatedCampaign.status,
          });
        }
      } catch (consistencyError) {
        logger.warn('Consistency validation failed, using original campaign data', {
          scheduleId: event.scheduleId,
          campaignId: campaign.campaignId,
          error: consistencyError,
        });
        // Continue with original campaign data
      }
    }

    if (!isCampaignActive(validatedCampaign)) {
      const blockReason = getCampaignBlockReason(validatedCampaign);
      logger.warn('Skipping publish - campaign not active', {
        scheduleId: event.scheduleId,
        contentId: schedule.contentId,
        campaignId: validatedCampaign?.campaignId,
        campaignStatus: validatedCampaign?.status,
        blockReason,
      });

      // Update schedule status to skipped (not failed - this is intentional)
      await updateScheduleStatus(event.scheduleId, 'skipped', blockReason || 'Campaign not active');

      // Delete EventBridge schedule to prevent re-triggering
      try {
        await schedulerClient.send(
          new DeleteScheduleCommand({
            Name: event.scheduleId,
            GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
          })
        );
        logger.info('Deleted EventBridge schedule for inactive campaign', {
          scheduleId: event.scheduleId,
          campaignId: validatedCampaign?.campaignId,
        });
      } catch (deleteError) {
        logger.warn('Failed to delete EventBridge schedule for inactive campaign', {
          scheduleId: event.scheduleId,
          error: deleteError,
        });
      }

      // Emit EventBridge post.skipped event for downstream sync
      try {
        await eventBridge.putEvents({
          Entries: [
            {
              Source: 'postolio.platform',
              DetailType: 'post.skipped',
              Time: new Date(),
              Detail: JSON.stringify({
                scheduleId: event.scheduleId,
                contentId: schedule.contentId,
                brandId: schedule.brandId,
                campaignId: validatedCampaign?.campaignId,
                campaignStatus: validatedCampaign?.status,
                reason: blockReason || 'Campaign not active',
                skippedAt: new Date().toISOString(),
              }),
              EventBusName: process.env.EVENT_BUS_NAME || 'default',
            },
          ],
        });
        logger.info('Emitted post.skipped event to EventBridge');
      } catch (emitErr) {
        logger.warn('Failed to emit post.skipped event', { error: emitErr });
      }

      metrics.addMetric('ContentSkipped', MetricUnit.Count, 1);
      metrics.addMetric('ContentSkipped_CampaignInactive', MetricUnit.Count, 1);
      metrics.publishStoredMetrics();
      return;
    }

    // Use content directly from schedule
    logger.info('Using content from schedule - campaign validation passed', {
      contentId: schedule.contentId,
      brandId: schedule.brandId,
      campaignId: campaign?.campaignId,
      campaignStatus: campaign?.status,
      hasCaption: !!schedule.caption,
      hasHashtags: !!schedule.hashtags,
    });

    // Prepare content with proper media URL
    const publishableSchedule: Schedule = {
      ...schedule,
    };

    // Get user and brand IDs for token retrieval - prefer schedule data over event
    const userId = schedule.userId || event.userId;
    const brandId = schedule.brandId || event.brandId;

    if (!brandId) {
      throw new Error('Brand ID not found in schedule or event');
    }

    if (!userId) {
      throw new Error('User ID not found in schedule or event - required for token retrieval');
    }

    // Get token from Token Service via Lambda invocation (improved)
    const tokenData = await getTokenFromTokenService(brandId, userId, schedule.platform);

    // Prepare credentials based on platform
    const credentials = {
      accessToken: tokenData.accessToken,
      accountId: tokenData.accountId,
      pageId: tokenData.pageId,
      expiresAt: tokenData.expiresAt,
    };

    logger.info('Fetched credentials', {
      brandId,
      hasToken: !!credentials.accessToken,
    });

    // Resolve media URL based on mediaType/contentType
    const mediaFormat = (
      publishableSchedule.mediaType ||
      publishableSchedule.contentType ||
      ''
    ).toLowerCase();
    const isVideoFormat = mediaFormat === 'video' || mediaFormat === 'reel';

    let mediaUrl = null;
    if (publishableSchedule.mediaAssets && publishableSchedule.mediaAssets.length > 0) {
      const primary = publishableSchedule.mediaAssets[0];
      mediaUrl =
        primary.type === 'video'
          ? await getSignedVideoUrl(primary.key)
          : await getSignedImageUrlFromKey(primary.key);
    }

    if (!mediaUrl && isVideoFormat && publishableSchedule.videoUrl) {
      mediaUrl = await getSignedVideoUrl(publishableSchedule.videoUrl);
    } else if (!mediaUrl && publishableSchedule.imageUrl) {
      // Backward compatibility: derive key from URL
      const key = extractS3Key(publishableSchedule.imageUrl);
      mediaUrl = key ? await getSignedImageUrlFromKey(key) : publishableSchedule.imageUrl;
    } else if (!mediaUrl && publishableSchedule.videoUrl) {
      // Fallback: if we have a video URL but mediaType was missing, still attempt to publish
      mediaUrl = await getSignedVideoUrl(publishableSchedule.videoUrl);
    }

    if (!mediaUrl) {
      logger.error('Missing media for publishing', {
        scheduleId: event.scheduleId,
        contentId: schedule.contentId,
        mediaType: publishableSchedule.mediaType,
        contentType: publishableSchedule.contentType,
        hasVideoUrl: !!publishableSchedule.videoUrl,
        mediaAssetsCount: publishableSchedule.mediaAssets?.length || 0,
        imageUrlPresent: !!publishableSchedule.imageUrl,
      });
      throw new Error('Media URL is required for Instagram publishing');
    }

    // Get platform adapter
    const adapter = PlatformAdapterFactory.getAdapter(schedule.platform);

    // Validate credentials
    if (!adapter.validateCredentials(credentials)) {
      throw new Error(`Invalid credentials for platform: ${schedule.platform}`);
    }

    // Idempotency check: skip if already published (marker in retry table)
    try {
      const existing = await getPublishMarker(event.scheduleId);
      if (existing && existing.platformPostId) {
        logger.warn('Idempotency marker found; skipping re-publish', {
          scheduleId: event.scheduleId,
          platformPostId: existing.platformPostId,
          permalink: existing.permalink,
        });
        // Ensure schedule marked as published
        await updateScheduleStatus(
          event.scheduleId,
          'published',
          undefined,
          existing.platformPostId,
          existing.permalink
        );

        // Attempt to delete EventBridge schedule to avoid further triggers
        try {
          await schedulerClient.send(
            new DeleteScheduleCommand({
              Name: event.scheduleId,
              GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
            })
          );
        } catch {
          // ignore
        }
        return;
      }
    } catch (idemErr) {
      logger.warn('Idempotency check failed; proceeding with publish', {
        scheduleId: event.scheduleId,
        error: (idemErr as Error).message,
      });
    }

    // Publish to platform using adapter
    const publishResult = await adapter.publish(publishableSchedule, credentials, mediaUrl);

    if (!publishResult.success) {
      const err = new Error(publishResult.error || 'Publishing failed');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: publishResult.errorCode,
        httpStatus: publishResult.httpStatus,
        platform: schedule.platform,
      };
      throw err;
    }

    // Write idempotency marker (best-effort)
    try {
      await writePublishMarker(
        event.scheduleId,
        publishResult.platformPostId,
        publishResult.platformUrl
      );
    } catch (markerErr) {
      logger.warn('Failed to write idempotency marker (ignored)', {
        scheduleId: event.scheduleId,
        error: (markerErr as Error).message,
      });
    }

    // Update schedule status with platform info
    await updateScheduleStatus(
      event.scheduleId,
      'published',
      undefined,
      publishResult.platformPostId,
      publishResult.platformUrl
    );

    // Post first comment if provided (Instagram only)
    if (
      publishableSchedule.firstComment &&
      publishResult.platformPostId &&
      schedule.platform === 'instagram'
    ) {
      await postFirstComment(
        publishResult.platformPostId,
        publishableSchedule.firstComment as string,
        credentials,
        { externalAccountId: credentials.accountId || '' },
        event.scheduleId
      );
    }

    // 🔥 CRITICAL: Delete EventBridge schedule after successful publishing
    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: event.scheduleId,
          GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
        })
      );
      logger.info('Deleted EventBridge schedule after successful publishing', {
        scheduleId: event.scheduleId,
      });
    } catch (deleteError) {
      logger.warn('Failed to delete EventBridge schedule after success', {
        scheduleId: event.scheduleId,
        error: deleteError,
      });
      // Don't fail the operation if schedule deletion fails
    }

    // Emit EventBridge post.published event for downstream sync
    try {
      await eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.platform',
            DetailType: 'post.published',
            Time: new Date(),
            Detail: JSON.stringify({
              scheduleId: event.scheduleId,
              contentId: schedule.contentId,
              brandId: schedule.brandId,
              platform: schedule.platform,
              platformPostId: publishResult.platformPostId,
              permalink: publishResult.platformUrl,
              publishedAt: new Date().toISOString(),
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });
      logger.info('Emitted post.published event to EventBridge');
    } catch (emitErr) {
      logger.warn('Failed to emit post.published event', { error: emitErr });
    }

    metrics.addMetric('ContentPublished', MetricUnit.Count, 1);
    metrics.addMetric(`ContentPublished_${schedule.platform}`, MetricUnit.Count, 1);

    logger.info('Content published successfully', {
      scheduleId: event.scheduleId,
      platform: schedule.platform,
    });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to publish content', {
      errorName: err.name,
      errorMessage: err.message,
      stack: err.stack,
    });
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);

    // Update schedule status to failed
    await updateScheduleStatus(event.scheduleId, 'failed', err.message);

    // Emit EventBridge post.failed event for downstream sync
    try {
      const schedule = await getSchedule(event.scheduleId).catch(
        () => null as unknown as Schedule | null
      );
      await eventBridge.putEvents({
        Entries: [
          {
            Source: 'postolio.platform',
            DetailType: 'post.failed',
            Time: new Date(),
            Detail: JSON.stringify({
              scheduleId: event.scheduleId,
              contentId: schedule?.contentId,
              brandId: schedule?.brandId,
              platform: schedule?.platform,
              error: (error as Error)?.message || 'Unknown error',
              attemptNumber: 1,
            }),
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
          },
        ],
      });
      logger.info('Emitted post.failed event to EventBridge');
    } catch (emitErr) {
      logger.warn('Failed to emit post.failed event', { error: emitErr });
    }

    // 🔥 CRITICAL FIX: Delete EventBridge schedule to prevent infinite re-triggering
    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: event.scheduleId,
          GroupName: process.env.SCHEDULER_GROUP_NAME || 'default',
        })
      );
      logger.info('Deleted EventBridge schedule to prevent re-triggering', {
        scheduleId: event.scheduleId,
      });
    } catch (deleteError) {
      logger.warn('Failed to delete EventBridge schedule - may cause re-triggering', {
        scheduleId: event.scheduleId,
        error: deleteError,
      });
      // Don't fail the whole operation if schedule deletion fails
    }

    // 🔥 CRITICAL FIX: Send structured error message to DLQ for intelligent retry handling
    // Instead of throwing error (which causes immediate AWS retry), manually send to DLQ
    try {
      const schedule = await getSchedule(event.scheduleId).catch(
        () => null as unknown as Schedule | null
      );
      const meta = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
      const errorMeta = {
        ...(meta as Record<string, unknown>),
        platform: schedule?.platform,
      } as { errorCode?: string; httpStatus?: number; retryable?: boolean; platform?: string };
      await sendToRetryQueue(event.scheduleId, error as Error, event, errorMeta);
      logger.info('Sent failed publishing request to retry queue for intelligent handling', {
        scheduleId: event.scheduleId,
        error: (error as Error).message,
      });
    } catch (dlqError) {
      logger.error('Failed to send message to retry queue', dlqError as Error);
      // If we can't send to DLQ, then throw the original error as last resort
      throw error;
    }

    // Return successfully to prevent AWS automatic retry (our DLQ message will handle retry logic)
    return;
  } finally {
    metrics.publishStoredMetrics();
  }
};

interface ScheduleRecord extends Schedule {
  pk: string;
  sk: string;
}

async function getSchedule(scheduleId: string): Promise<ScheduleRecord | undefined> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      IndexName: process.env.SCHEDULES_TABLE_SCHEDULE_INDEX || 'ScheduleIdIndex',
      KeyConditionExpression: 'scheduleId = :sid',
      ExpressionAttributeValues: {
        ':sid': scheduleId,
      },
      Limit: 1,
    })
  );

  const item = (result.Items && result.Items[0]) as Record<string, unknown> | undefined;
  if (!item) return undefined;
  if (typeof item.platform !== 'string') {
    logger.warn('Schedule item missing platform field', { scheduleId });
    return undefined;
  }
  return item as ScheduleRecord;
}

interface TokenServiceResponse {
  accessToken: string;
  expiresAt?: string;
  accountId?: string;
  pageId?: string;
}

// Get token from Token Service (via HTTP with SigV4 signing)
async function getTokenFromTokenService(
  brandId: string,
  userId: string,
  platform: string
): Promise<TokenServiceResponse> {
  logger.info('Fetching token from Token Service', {
    brandId,
    userId,
    platform,
  });

  try {
    // Use simplified service discovery
    const tokenServiceUrl = await getServiceUrl('token-service');

    logger.info('Token Service URL retrieved', {
      url: tokenServiceUrl,
    });

    // Parse URL for signing (avoid double slashes in pathname which break SigV4)
    const url = new URL(tokenServiceUrl);
    const pathSegments = ['tokens', userId, platform, brandId].map((segment) =>
      encodeURIComponent(segment)
    );
    url.pathname = `/${pathSegments.join('/')}`;

    // Create HTTP request for signing
    // Sign the request with our shared signing utility
    const headers = await signRequest({
      method: 'GET',
      url,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Make signed HTTP request
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      let errorBody: string | undefined;
      try {
        errorBody = await response.text();
      } catch (parseError) {
        logger.warn('Failed to read Token Service error body', { parseError });
      }

      logger.error('Token Service request failed', {
        status: response.status,
        statusText: response.statusText,
        body: errorBody,
      });

      const baseMessage =
        response.status === 404
          ? 'Token not found'
          : `Token Service error: ${response.status} ${response.statusText}`;
      const err = new Error(baseMessage) as Error & { meta?: Record<string, unknown> };
      const retryable = response.status === 429 || response.status >= 500;
      const errorCode =
        response.status === 404
          ? 'TOKEN_NOT_FOUND'
          : response.status === 401 || response.status === 403
            ? 'UNAUTHORIZED'
            : retryable
              ? 'SERVICE_UNAVAILABLE'
              : 'REQUEST_FAILED';
      err.meta = {
        service: 'token-service',
        httpStatus: response.status,
        errorCode,
        retryable,
      };
      throw err;
    }

    interface RawTokenResponse {
      accessToken: string;
      expiresAt?: string;
      metadata?: { accountId?: string; pageId?: string };
    }
    const tokenData = (await response.json()) as RawTokenResponse;

    if (!tokenData.accessToken) {
      throw new Error('Token Service returned no access token');
    }

    logger.info('Successfully fetched token from Token Service');
    return {
      accessToken: tokenData.accessToken,
      expiresAt: tokenData.expiresAt,
      accountId: tokenData.metadata?.accountId,
      pageId: tokenData.metadata?.pageId,
    };
  } catch (error) {
    logger.error('Failed to get token from Token Service', { error });
    // Attach structured metadata for retry analysis
    const err = error as Error & { meta?: Record<string, unknown> };
    if (!err.meta) {
      // Try to derive meta from known error messages
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('token not found')) {
        err.meta = {
          errorCode: 'TOKEN_NOT_FOUND',
          httpStatus: 404,
          retryable: false,
          service: 'token-service',
        };
      }
    }
    throw err;
  }
}

/**
 * Send structured error message to retry queue for intelligent retry handling
 * This replaces AWS automatic DLQ handling with our custom retry strategy
 */
async function sendToRetryQueue(
  scheduleId: string,
  error: Error,
  originalEvent: PublishEvent,
  errorMeta?: {
    errorCode?: string;
    httpStatus?: number;
    retryable?: boolean;
    platform?: string;
    service?: string;
  }
): Promise<void> {
  const queueUrl = process.env.RETRY_QUEUE_URL || process.env.DLQ_URL;
  if (!queueUrl) {
    logger.warn('Neither RETRY_QUEUE_URL nor DLQ_URL configured - cannot send to retry queue');
    return;
  }

  // Create structured message for retry handler with error context
  const metaFromError = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
  const mergedMeta = {
    ...(metaFromError as Record<string, unknown>),
    ...(errorMeta || {}),
  } as Record<string, unknown>;

  const retryMessage = {
    scheduleId,
    originalEvent,
    originalError: error.message,
    errorDetails: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    errorMeta: mergedMeta,
    httpStatus:
      typeof (mergedMeta as { httpStatus?: unknown }).httpStatus === 'number'
        ? (mergedMeta as { httpStatus: number }).httpStatus
        : undefined,
    timestamp: new Date().toISOString(),
    source: 'publisher',
    attempt: 1, // This is the first failure
  };

  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(retryMessage),
      MessageAttributes: {
        ErrorType: {
          DataType: 'String',
          StringValue: error.name || 'Error',
        },
        ScheduleId: {
          DataType: 'String',
          StringValue: scheduleId,
        },
        Source: {
          DataType: 'String',
          StringValue: 'publisher',
        },
      },
    })
  );

  logger.info('Successfully sent structured error message to retry queue', {
    scheduleId,
    errorType: error.name,
    messageSize: JSON.stringify(retryMessage).length,
    targetQueueUrl: queueUrl,
  });
}

// Publisher Lambda architecture:
// 1. Uses content directly from scheduler's DynamoDB (no main app API calls)
// 2. Gets tokens from Token Service via signed HTTP with service discovery (secure & loose coupling)
// 3. Uses AWS SigV4 signing for authentication to Token Service API Gateway
// 4. No direct Lambda-to-Lambda invocation to avoid service coupling
// This maintains proper microservices patterns with secure service-to-service authentication

async function getSignedVideoUrl(videoKey: string): Promise<string> {
  const candidate = videoKey.trim();
  if (!candidate) {
    throw new Error('Media key is required for video publishing');
  }

  // In the current architecture, content.videoUrl is a public CDN URL,
  // not a raw S3 key. For backward compatibility:
  // - If given an absolute URL, return it as-is for Instagram's video_url.
  // - If given a key, sign it against VIDEO_BUCKET.
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }

  const command = new GetObjectCommand({
    Bucket: process.env.VIDEO_BUCKET!,
    Key: candidate,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Build a CDN URL for an image by key (no auth)
async function getSignedImageUrlFromKey(key: string): Promise<string> {
  const candidate = key.trim();
  if (!candidate) {
    throw new Error('Media key is required for image publishing');
  }

  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }

  const cdnDomain = process.env.ASSETS_CDN_DOMAIN;
  if (!cdnDomain) {
    throw new Error('ASSETS_CDN_DOMAIN not configured for publisher');
  }

  const normalized = candidate.replace(/^\/+/, '');
  if (normalized.startsWith(`${cdnDomain}/`)) {
    return `https://${normalized}`;
  }

  return `https://${cdnDomain}/${normalized}`;
}

function extractS3Key(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    // URL paths are like "/images/yyyy-mm-dd/brandId/contentId-hash.jpg"
    const p = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
    // Guard: expect keys under images/
    if (!p || (!p.startsWith('images/') && !p.startsWith('uploads/') && !p.includes('.'))) {
      return null;
    }
    // Remove potential trailing slashes
    return p.replace(/^\/+/, '');
  } catch {
    return null;
  }
}

// Audit log helper (best-effort, never throws)
async function logAudit(
  scheduleId: string,
  action: string,
  result: 'success' | 'failure',
  details?: Record<string, unknown>
): Promise<void> {
  const tableName = process.env.AUDIT_LOG_TABLE;
  if (!tableName) {
    logger.debug('Audit log table not configured; skipping audit', { action, scheduleId });
    return;
  }
  try {
    await docClient.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: `AUDIT#${scheduleId}`,
          sk: `${Date.now()}#${action}`,
          scheduleId,
          action,
          result,
          details,
          timestamp: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
        },
      })
    );
  } catch (auditError) {
    logger.warn('Failed to write to audit log (ignored)', {
      scheduleId,
      action,
      error: (auditError as Error).message,
    });
  }
}

async function createFailedScheduleEntry(
  scheduleId: string,
  brandId: string,
  userId: string,
  errorMessage: string
): Promise<void> {
  // Avoid writing inconsistent records if the schedule does not exist
  logger.warn('Not creating failed schedule entry because schedule not found', {
    scheduleId,
    brandId,
    userId,
    errorMessage,
  });
}

async function updateScheduleStatus(
  scheduleId: string,
  status: string,
  errorMessage?: string,
  platformPostId?: string,
  platformUrl?: string
): Promise<void> {
  try {
    // Find the schedule item via GSI to get the actual PK/SK
    const schedule = await getSchedule(scheduleId);
    if (!schedule || !('pk' in schedule) || !('sk' in schedule)) {
      logger.warn('Cannot update schedule status; schedule not found or missing keys', {
        scheduleId,
        status,
      });
      return;
    }
    const setParts: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
    const removeParts: string[] = [];

    if (errorMessage) {
      setParts.push('#error = :error');
    } else {
      // Success path: clear any stale errors
      removeParts.push('#error', '#errorType');

      if (status === 'published') {
        setParts.push('#publishedAt = :publishedAt');
        if (platformPostId) setParts.push('#platformPostId = :platformPostId');
        if (platformUrl) setParts.push('#platformUrl = :platformUrl');
      }
    }

    const expressionAttributeNames: Record<string, string> = {
      '#status': 'status',
      '#updatedAt': 'updatedAt',
    };

    if (
      setParts.some((p) => p.includes('#error')) ||
      removeParts.some((p) => p.includes('#error'))
    ) {
      expressionAttributeNames['#error'] = 'schedulingError';
    }
    if (
      setParts.some((p) => p.includes('#errorType')) ||
      removeParts.some((p) => p.includes('#errorType'))
    ) {
      expressionAttributeNames['#errorType'] = 'errorType';
    }
    if (
      setParts.some((p) => p.includes('#publishedAt')) ||
      removeParts.some((p) => p.includes('#publishedAt'))
    ) {
      expressionAttributeNames['#publishedAt'] = 'publishedAt';
    }
    if (
      setParts.some((p) => p.includes('#platformPostId')) ||
      removeParts.some((p) => p.includes('#platformPostId'))
    ) {
      expressionAttributeNames['#platformPostId'] = 'platformPostId';
    }
    if (
      setParts.some((p) => p.includes('#platformUrl')) ||
      removeParts.some((p) => p.includes('#platformUrl'))
    ) {
      expressionAttributeNames['#platformUrl'] = 'platformUrl';
    }

    const expressionAttributeValues: Record<string, string> = {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    };

    if (errorMessage) {
      expressionAttributeValues[':error'] = errorMessage;
    } else if (status === 'published') {
      expressionAttributeValues[':publishedAt'] = new Date().toISOString();
      if (platformPostId) expressionAttributeValues[':platformPostId'] = platformPostId;
      if (platformUrl) expressionAttributeValues[':platformUrl'] = platformUrl;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          // Use the real keys from the schedule item
          pk: schedule.pk,
          sk: schedule.sk,
        },
        UpdateExpression: `SET ${setParts.join(', ')}${
          removeParts.length ? ' REMOVE ' + removeParts.join(', ') : ''
        }`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    // Log audit (best-effort)
    await logAudit(scheduleId, `status_update_${status}`, 'success', {
      errorMessage,
      platformPostId,
      platformUrl,
    });
  } catch (e) {
    logger.warn('Failed to update schedule status (ignored)', {
      scheduleId,
      status,
      error: (e as Error).message,
    });
  }
}

/**
 * Post first comment to Instagram media after successful publishing
 */
async function postFirstComment(
  mediaId: string,
  commentText: string,
  credentials: Credentials,
  account: { externalAccountId: string },
  scheduleId: string
): Promise<void> {
  try {
    // Use Instagram connector to post comment
    const connector = new InstagramAdapter();
    const result = await connector.postComment(mediaId, commentText, credentials, account);

    if (result.success) {
      logger.info('First comment posted successfully', {
        scheduleId,
        mediaId,
        commentId: result.commentId,
      });

      metrics.addMetric('FirstCommentPosted', MetricUnit.Count, 1);
      await updateFirstCommentStatus(scheduleId, 'posted', result.commentId);
    } else {
      logger.warn('First comment failed, will retry', {
        scheduleId,
        error: result.error,
      });

      // Set status to retrying
      await updateFirstCommentStatus(scheduleId, 'retrying');

      // Basic retry: 3 attempts with 2 second delay
      const maxAttempts = 3;
      const delay = 2000;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        logger.info('Retrying first comment', { scheduleId, attempt });
        await new Promise((resolve) => setTimeout(resolve, delay));

        const retryResult = await connector.postComment(mediaId, commentText, credentials, account);

        if (retryResult.success) {
          metrics.addMetric('FirstCommentRetrySuccess', MetricUnit.Count, 1);
          await updateFirstCommentStatus(scheduleId, 'posted', retryResult.commentId);
          return;
        }
      }

      // All retries failed
      metrics.addMetric('FirstCommentRetryExhausted', MetricUnit.Count, 1);
      await updateFirstCommentStatus(scheduleId, 'failed', undefined, result.error);
    }
  } catch (error) {
    logger.error('Failed to post first comment', {
      scheduleId,
      error: (error as Error).message,
    });
    metrics.addMetric('FirstCommentError', MetricUnit.Count, 1);
    await updateFirstCommentStatus(scheduleId, 'failed', undefined, (error as Error).message);
  }
}

/**
 * Update first comment status in DynamoDB schedule table
 */
async function updateFirstCommentStatus(
  scheduleId: string,
  status: string,
  commentId?: string,
  error?: string
): Promise<void> {
  try {
    const schedule = await getSchedule(scheduleId);
    if (!schedule || !('pk' in schedule) || !('sk' in schedule)) {
      logger.warn('Cannot update first comment status; schedule not found', {
        scheduleId,
        status,
      });
      return;
    }

    const setParts: string[] = ['#firstCommentStatus = :status'];
    const values: Record<string, string> = { ':status': status };

    if (status === 'posted' && commentId) {
      setParts.push('#firstCommentPostedAt = :postedAt');
      values[':postedAt'] = new Date().toISOString();
    }
    if (error) {
      setParts.push('#firstCommentError = :error');
      values[':error'] = error;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: { pk: schedule.pk, sk: schedule.sk },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: {
          '#firstCommentStatus': 'firstCommentStatus',
          '#firstCommentPostedAt': 'firstCommentPostedAt',
          '#firstCommentError': 'firstCommentError',
        },
        ExpressionAttributeValues: values,
      })
    );

    logger.info('Updated first comment status', { scheduleId, status });
  } catch (e) {
    logger.warn('Failed to update first comment status', {
      scheduleId,
      status,
      error: (e as Error).message,
    });
  }
}

// Idempotency helpers using RetryQueueTable (attemptNumber=0 as published marker)
type PublishMarker = { platformPostId?: string; permalink?: string };

async function getPublishMarker(scheduleId: string): Promise<PublishMarker | null> {
  const table = process.env.RETRY_QUEUE_TABLE;
  if (!table) return null;
  const res = await docClient.send(
    new GetCommand({
      TableName: table,
      Key: { scheduleId, attemptNumber: 0 },
    })
  );
  return (res.Item as PublishMarker | undefined) || null;
}

async function writePublishMarker(
  scheduleId: string,
  platformPostId?: string,
  permalink?: string
): Promise<void> {
  const table = process.env.RETRY_QUEUE_TABLE;
  if (!table) return;
  await docClient.send(
    new PutCommand({
      TableName: table,
      Item: {
        scheduleId,
        attemptNumber: 0,
        type: 'published',
        platformPostId,
        permalink,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
      },
      ConditionExpression:
        'attribute_not_exists(scheduleId) AND attribute_not_exists(attemptNumber)',
    })
  );
}
// Safe JSON parse helpers for IG error payloads
interface IGErrorPayload {
  error?: {
    error_user_msg?: string;
    message?: string;
    error_user_title?: string;
  };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asIGErrorPayload(u: unknown): IGErrorPayload | null {
  if (!u || typeof u !== 'object') return null;
  // Minimal structural check
  if ('error' in u) return u as IGErrorPayload;
  return null;
}
