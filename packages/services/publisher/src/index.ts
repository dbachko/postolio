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

type PlatformName = 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'youtube';

interface Schedule {
  scheduleId?: string;
  contentId?: string;
  brandId?: string;
  userId?: string;
  caption?: string;
  hashtags?: string[];
  contentType?: 'video' | 'image' | 'text' | string;
  imageUrl?: string;
  mediaKeys?: string[];
  videoUrl?: string;
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
    isVideo: boolean
  ): Promise<void> {
    const statusUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${creationId}`;
    const maxWaitMs = isVideo ? 120_000 : 30_000;
    const started = Date.now();
    let attempt = 0;

    while (Date.now() - started < maxWaitMs) {
      try {
        const params = new URLSearchParams({
          fields: 'status_code,status',
          access_token: accessToken,
        });
        const resp = await fetch(`${statusUrl}?${params}`);
        const body = resp.ok ? await resp.json() : undefined;
        const codeRaw = (body?.status_code || body?.status || '').toString();
        const code = codeRaw.toUpperCase();

        logger.info('Instagram media status check', {
          creationId,
          attempt,
          status_code: code || 'UNKNOWN',
        });

        if (code === 'FINISHED' || code === 'PUBLISHED') return; // Ready
        if (code === 'ERROR') throw new Error('Instagram media processing error');
      } catch (e) {
        // Log and continue until timeout; transient errors are common
        logger.warn('Failed to check Instagram media status', {
          creationId,
          attempt,
          error: (e as Error).message,
        });
      }

      // Backoff: start small for images, longer for videos
      const base = isVideo ? 1200 : 400;
      const delay = Math.min(base * Math.pow(1.6, attempt), isVideo ? 5000 : 1500);
      attempt += 1;
      await new Promise((r) => setTimeout(r, delay));
    }

    throw new Error('Media is not ready for publishing after waiting');
  }
  async publish(
    schedule: Schedule,
    credentials: Credentials,
    mediaUrl: string | null
  ): Promise<PublishResult> {
    try {
      if (!mediaUrl) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      const formattedCaption = this.formatCaption(schedule.caption, schedule.hashtags);
      const isVideo = (schedule.contentType || '').toLowerCase() === 'video';

      // Step 1: Create media container
      const createMediaUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media`;
      const createMediaParams = new URLSearchParams({
        caption: formattedCaption,
        access_token: credentials.accessToken,
      });
      if (isVideo) {
        createMediaParams.set('video_url', mediaUrl);
      } else {
        createMediaParams.set('image_url', mediaUrl);
      }

      logger.info('Creating Instagram media container', {
        accountId: credentials.accountId,
        hasMediaUrl: !!mediaUrl,
        mediaKind: isVideo ? 'video' : 'image',
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
        return {
          success: false,
          error: `Failed to create media: ${igMsg}`,
        };
      }

      const createResult = await createResponse.json();
      const creationId = createResult.id;

      if (!creationId) {
        return {
          success: false,
          error: 'No creation ID returned from Instagram',
        };
      }

      // Step 2: Wait for the media container to be ready (prevents "The media is not ready" errors)
      await this.waitForMediaReady(creationId, credentials.accessToken, isVideo);

      // Step 3: Publish the media
      const publishUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media_publish`;
      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: credentials.accessToken,
      });

      logger.info('Publishing Instagram media', { creationId });

      const publishResponse = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });

      if (!publishResponse.ok) {
        const raw = await publishResponse.text();
        const parsed = asIGErrorPayload(safeParseJson(raw));
        const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
        const igTitle = parsed?.error?.error_user_title;
        logger.error('Failed to publish Instagram media', {
          status: publishResponse.status,
          error: igMsg,
          title: igTitle,
        });
        return { success: false, error: `Failed to publish: ${igMsg}` };
      }

      const publishResult = await publishResponse.json();
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

      return {
        success: true,
        platformPostId: postId,
        platformUrl: permalink,
      };
    } catch (error) {
      logger.error('Instagram publishing failed', error as Error);
      return { success: false, error: (error as Error).message };
    }
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && credentials?.accountId);
  }

  formatContent(schedule: Schedule): unknown {
    return {
      caption: this.formatCaption(schedule.caption, schedule.hashtags),
      mediaType: schedule.contentType === 'video' ? 'VIDEO' : 'IMAGE',
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

export const handler = async (event: PublishEvent): Promise<void> => {
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
            GroupName: process.env.SCHEDULE_GROUP_NAME || 'default',
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
      mediaKeys: schedule.mediaKeys,
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

    // If video content, get signed URL
    let mediaUrl = null;
    if (schedule.contentType === 'video' && schedule.videoUrl) {
      mediaUrl = await getSignedVideoUrl(schedule.videoUrl);
    } else if (publishableSchedule.mediaKeys?.[0]) {
      mediaUrl = await getSignedImageUrlFromKey(publishableSchedule.mediaKeys[0]);
    } else if (publishableSchedule.imageUrl) {
      // Backward compatibility: derive key from URL
      const key = extractS3Key(publishableSchedule.imageUrl);
      mediaUrl = key ? await getSignedImageUrlFromKey(key) : publishableSchedule.imageUrl;
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
              GroupName: process.env.SCHEDULE_GROUP_NAME || 'default',
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
      throw new Error(publishResult.error || 'Publishing failed');
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

    // 🔥 CRITICAL: Delete EventBridge schedule after successful publishing
    try {
      await schedulerClient.send(
        new DeleteScheduleCommand({
          Name: event.scheduleId,
          GroupName: process.env.SCHEDULE_GROUP_NAME || 'default',
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
    logger.error('Failed to publish content', error as Error);
    metrics.addMetric('PublishingError', MetricUnit.Count, 1);

    // Update schedule status to failed
    await updateScheduleStatus(event.scheduleId, 'failed', (error as Error).message);

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
          GroupName: process.env.SCHEDULE_GROUP_NAME || 'default',
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
      await sendToRetryQueue(event.scheduleId, error as Error, event);
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

      if (response.status === 404) {
        throw new Error('Token not found');
      }

      throw new Error(`Token Service error: ${response.status} ${response.statusText}`);
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
    throw error;
  }
}

/**
 * Send structured error message to retry queue for intelligent retry handling
 * This replaces AWS automatic DLQ handling with our custom retry strategy
 */
async function sendToRetryQueue(
  scheduleId: string,
  error: Error,
  originalEvent: PublishEvent
): Promise<void> {
  const queueUrl = process.env.RETRY_QUEUE_URL || process.env.DLQ_URL;
  if (!queueUrl) {
    logger.warn('Neither RETRY_QUEUE_URL nor DLQ_URL configured - cannot send to retry queue');
    return;
  }

  // Create structured message for retry handler with error context
  const retryMessage = {
    scheduleId,
    originalEvent,
    originalError: error.message,
    errorDetails: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
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
  const command = new GetObjectCommand({
    Bucket: process.env.VIDEO_BUCKET!,
    Key: videoKey,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

// Build a CDN URL for an image by key (no auth)
async function getSignedImageUrlFromKey(key: string): Promise<string> {
  const cdnDomain = process.env.IMAGES_CDN_DOMAIN;
  if (!cdnDomain) {
    throw new Error('IMAGES_CDN_DOMAIN not configured for publisher');
  }
  return `https://${cdnDomain}/${key.replace(/^\/+/, '')}`;
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
      '#error': 'schedulingError',
      '#errorType': 'errorType',
    };

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
