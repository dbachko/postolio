/**
 * Scheduler Adapter Service
 * Adapter for AWS Content Scheduler integration
 */

import { randomUUID } from 'crypto';
import type { ContentStatus } from '@postolio/database';
import { AssetsServiceClient } from '@postolio/assets-client';
import {
  ContentSchedulerClient,
  type ContentSchedulerConfig,
  type CreateScheduleInput,
  type UpdateScheduleInput,
} from '../clients/content-scheduler-client.js';
import { SCHEDULER_TIME_INTERVALS, SYNC_TOLERANCE } from '../constants/scheduler.js';
import { getDatabaseClient } from '../config/database.js';
import { config } from '../config/env-validation.js';
import { TimezoneService } from './timezone.js';
import { resolvePrimarySocialAccount } from './social-account-resolver.js';
import type { StatusBroadcaster } from './status-broadcaster.js';
import type { GenerationParams } from '../types/scheduler.js';
import { eventEmitter } from './event-emitter.js';
import { logger } from '@postolio/logger';
import { getMaxScheduledAheadForTier } from '../constants/subscription.js';
import {
  validateContentPayload,
  type ContentType as ValidationContentType,
  type MediaType as ValidationMediaType,
} from '@postolio/content-validation';
import { haveUniformAspectRatio } from '../utils/aspect-ratio.js';
import { toSchedulerPlatform, toValidationPlatform } from '../utils/platform.js';

const prisma = getDatabaseClient();

type AssetMetadataInfo = {
  fileType: 'image' | 'video';
  s3Key: string;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
};

const ASSET_TYPE_CACHE_TTL_MS = 10 * 60 * 1000;
const ASSET_TYPE_CACHE_MAX_ENTRIES = 2000;

let cachedAssetsClient: AssetsServiceClient | null = null;
const assetTypeCache = new Map<string, { info: AssetMetadataInfo; expiresAt: number }>();

function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as any).disconnected);
}

function getAssetsServiceClient(): AssetsServiceClient {
  if (!cachedAssetsClient) {
    cachedAssetsClient = new AssetsServiceClient({
      baseUrl: config.ASSETS_API_BASE_URL,
      serviceToken: config.ASSETS_API_SERVICE_TOKEN,
    });
  }
  return cachedAssetsClient;
}

function getCachedAssetType(assetId: string, now: number): AssetMetadataInfo | null {
  const entry = assetTypeCache.get(assetId);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    assetTypeCache.delete(assetId);
    return null;
  }
  return entry.info;
}

function pruneAssetTypeCache(now: number) {
  for (const [assetId, entry] of assetTypeCache.entries()) {
    if (entry.expiresAt <= now) {
      assetTypeCache.delete(assetId);
    }
  }
  while (assetTypeCache.size > ASSET_TYPE_CACHE_MAX_ENTRIES) {
    const oldestKey = assetTypeCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    assetTypeCache.delete(oldestKey);
  }
}

function setCachedAssetType(assetId: string, info: AssetMetadataInfo, now: number) {
  pruneAssetTypeCache(now);
  assetTypeCache.set(assetId, { info, expiresAt: now + ASSET_TYPE_CACHE_TTL_MS });
}

async function getAssetMetadataByIds(assetIds: string[]): Promise<Map<string, AssetMetadataInfo>> {
  const uniqueIds = Array.from(new Set(assetIds.filter(Boolean)));
  const result = new Map<string, AssetMetadataInfo>();
  const idsToFetch: string[] = [];
  const now = Date.now();

  for (const assetId of uniqueIds) {
    const cached = getCachedAssetType(assetId, now);
    if (cached) {
      result.set(assetId, cached);
    } else {
      idsToFetch.push(assetId);
    }
  }

  if (idsToFetch.length === 0) {
    return result;
  }

  try {
    const assetsClient = getAssetsServiceClient();
    const fetched = await assetsClient.getBatchAssets(idsToFetch);
    fetched.forEach((asset, idx) => {
      const assetId = idsToFetch[idx];
      if (!asset) {
        return;
      }
      const info: AssetMetadataInfo = {
        fileType: asset.fileType === 'video' ? 'video' : 'image',
        s3Key: asset.s3Key,
        width: asset.width ?? null,
        height: asset.height ?? null,
        duration: asset.duration ?? null,
      };
      result.set(assetId, info);
      setCachedAssetType(assetId, info, now);
    });
  } catch (error) {
    logger.warn('Failed to fetch asset type metadata from assets service', {
      error,
      assetCount: idsToFetch.length,
    });
  }

  return result;
}

/**
 * Derive schedule mediaType from content + resolved assets.
 * This keeps DB minimal by not storing mediaType/videoUrl on Content.
 */
export function deriveScheduleMediaType(
  contentType: string,
  mediaAssets: Array<{ type: 'image' | 'video' }>
): 'image' | 'video' {
  const normalizedContentType = (contentType || '').toLowerCase();
  if (normalizedContentType === 'reel') {
    return 'video';
  }
  if (mediaAssets.length === 1 && mediaAssets[0]?.type === 'video') {
    return 'video';
  }
  return 'image';
}

function normalizeContentType(value: unknown): ValidationContentType {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'post' || normalized === 'reel' || normalized === 'story') {
    return normalized;
  }
  return 'post';
}

export class SchedulerAdapter {
  private _client: ContentSchedulerClient | null = null;
  private _clientPromise: Promise<ContentSchedulerClient> | null = null;
  private static instance: SchedulerAdapter | null = null;
  private broadcaster: StatusBroadcaster | null = null;

  private schedulerEnabled = true;

  private constructor(private config?: Partial<ContentSchedulerConfig>) {
    // Configuration stored for lazy initialization
  }

  static async create(config?: Partial<ContentSchedulerConfig>): Promise<SchedulerAdapter> {
    const adapter = new SchedulerAdapter(config);
    // Trigger initialization immediately
    await adapter.client;
    return adapter;
  }

  /**
   * Lazy-initialized client getter with automatic service discovery
   */
  private get client(): Promise<ContentSchedulerClient> {
    if (!this._clientPromise) {
      this._clientPromise = this.initializeClient();
    }
    return this._clientPromise;
  }

  private async initializeClient(): Promise<ContentSchedulerClient> {
    try {
      // Use the new service discovery-aware factory method
      const client = await ContentSchedulerClient.create({
        timeout: 30000,
        maxRetries: 3,
        ...this.config,
      });

      logger.info('ContentSchedulerClient initialized with service discovery');
      this.schedulerEnabled = true;
      this._client = client;
      return client;
    } catch (error) {
      logger.error('Failed to initialize ContentSchedulerClient', { error });

      // Fallback: try with alternative environment variable
      const fallbackUrl = process.env.SCHEDULER_API_URL || 'http://localhost:4000';

      // Check if scheduler is properly configured
      const isPlaceholderUrl =
        fallbackUrl.includes('your-scheduler-api') ||
        fallbackUrl.includes('scheduler-api-not-configured') ||
        fallbackUrl.includes('example.com');

      if (isPlaceholderUrl) {
        logger.warn('AWS Content Scheduler is not configured properly', { baseURL: fallbackUrl });
        logger.warn(
          'Running in degraded mode - content will be saved but not scheduled for automatic publishing.'
        );
        logger.warn(
          'To enable scheduling, deploy the ContentScheduler stack or set SCHEDULER_API_URL to a valid endpoint.'
        );
        this.schedulerEnabled = false;
        throw new Error('Scheduler not configured - degraded mode');
      } else {
        // Try with fallback URL
        try {
          const client = new ContentSchedulerClient({
            baseURL: fallbackUrl,
            timeout: 30000,
            maxRetries: 3,
            ...this.config,
          });
          logger.warn('Using fallback ContentScheduler URL', { baseURL: fallbackUrl });
          this.schedulerEnabled = true;
          this._client = client;
          return client;
        } catch (fallbackError) {
          logger.error('Failed to initialize ContentScheduler with fallback URL', {
            error: fallbackError,
          });
          this.schedulerEnabled = false;
          throw fallbackError;
        }
      }
    }
  }

  /**
   * Set the status broadcaster for real-time updates
   */
  setBroadcaster(broadcaster: StatusBroadcaster): void {
    this.broadcaster = broadcaster;
  }

  /**
   * Get the client instance (for testing purposes only)
   * @internal
   */
  getClient(): ContentSchedulerClient | null {
    return this._client;
  }

  /**
   * Get singleton instance (deprecated - use create() for proper async initialization)
   */
  static getInstance(config?: Partial<ContentSchedulerConfig>): SchedulerAdapter {
    if (!SchedulerAdapter.instance) {
      SchedulerAdapter.instance = new SchedulerAdapter(config);
    }
    return SchedulerAdapter.instance;
  }

  /**
   * Get singleton instance with proper async initialization
   */
  static async getInstanceAsync(
    config?: Partial<ContentSchedulerConfig>
  ): Promise<SchedulerAdapter> {
    if (!SchedulerAdapter.instance) {
      SchedulerAdapter.instance = await SchedulerAdapter.create(config);
    }
    return SchedulerAdapter.instance;
  }

  /**
   * Schedule content with timezone-aware handling and proper consistency
   */
  async scheduleContent(
    contentId: string,
    customTime?: Date,
    userId?: string
  ): Promise<{
    success: boolean;
    scheduleId?: string;
    brandId?: string;
    error?: string;
  }> {
    // Store original state for rollback
    let originalStatus: ContentStatus | null = null;
    let originalScheduledAt: Date | null = null;
    // Minimal content info for notifications in catch
    let fetchedContent: { brandId: string; brand: { userId: string } } | null = null;

    try {
      // 1. Get content with brand and user info
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            include: {
              user: true,
            },
          },
          mediaAssets: {
            select: {
              displayOrder: true,
              assetId: true,
            },
            orderBy: { displayOrder: 'asc' },
          },
        },
      });

      if (!content) {
        try {
          await eventEmitter.emitScheduleFailed({
            contentId,
            brandId: undefined,
            operation: 'create',
            error: 'Content not found',
          });
        } catch (emitErr) {
          logger.warn('Failed to emit schedule.failed event for missing content', {
            contentId,
            error: emitErr,
          });
        }
        return { success: false, error: 'Content not found' };
      }
      fetchedContent = { brandId: content.brandId, brand: { userId: content.brand.userId } };

      const emitScheduleFailure = async (message: string) => {
        try {
          await eventEmitter.emitScheduleFailed({
            contentId,
            brandId: content.brandId,
            operation: 'create',
            error: message,
          });
        } catch (emitError) {
          logger.warn('Failed to emit schedule.failed event from API layer', {
            contentId,
            error: emitError,
          });
        }
      };

      // Store original state for potential rollback
      originalStatus = content.status as ContentStatus;
      originalScheduledAt = content.scheduledAt;

      // 2. Enforce plan limits: max allowed future scheduled per brand for this user tier
      try {
        const tier = content.brand?.user?.subscriptionTier || 'free';
        const maxAhead = getMaxScheduledAheadForTier(tier);
        if (Number.isFinite(maxAhead)) {
          const now = new Date();
          const futureCountExcludingThis = await prisma.content.count({
            where: {
              brandId: content.brandId,
              id: { not: content.id },
              scheduledAt: { gte: now },
              status: { in: ['scheduled', 'draft'] },
            },
          });
          if (futureCountExcludingThis + 1 > maxAhead) {
            const message = `Upgrade required: your plan allows up to ${maxAhead} scheduled posts ahead`;
            await emitScheduleFailure(message);
            return {
              success: false,
              error: message,
            };
          }
        }
      } catch (limitError) {
        logger.warn('Plan limit check failed; proceeding without limit enforcement', {
          error: limitError,
        });
      }

      // 3. Get the brand's timezone for proper scheduling
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
      logger.info('Scheduling with brand timezone', {
        brandId: content.brandId,
        timezone: brandTimezone,
      });

      // 4. Determine the scheduled time
      let scheduledTimeUTC: Date;

      if (customTime) {
        // customTime coming from the API layer is already an absolute instant (UTC ISO -> Date).
        // Only fall back to timezone conversion if we somehow get a naive string without offset.
        const candidate = customTime instanceof Date ? customTime : new Date(customTime);
        if (isNaN(candidate.getTime())) {
          return {
            success: false,
            error: 'Invalid scheduled time provided',
          };
        }
        const needsConversionFromLocal =
          typeof customTime === 'string' && !/[zZ]|[+-]\d{2}:\d{2}$/.test(customTime);

        if (needsConversionFromLocal) {
          scheduledTimeUTC = TimezoneService.toUTC(candidate, brandTimezone);
          logger.warn('Received timezone-naive customTime; converted using brand timezone', {
            brandId: content.brandId,
            timezone: brandTimezone,
            requestedAt: customTime,
            scheduledAtUTC: scheduledTimeUTC.toISOString(),
          });
        } else {
          scheduledTimeUTC = candidate;
          logger.info('Using provided scheduledAt as absolute UTC instant', {
            brandId: content.brandId,
            scheduledAtUTC: scheduledTimeUTC.toISOString(),
            timezone: brandTimezone,
          });
        }
      } else if (content.scheduledAt) {
        // If content already has a scheduled time, use it (assume it's already in UTC)
        scheduledTimeUTC = new Date(content.scheduledAt);
      } else {
        // Default: schedule for 1 hour from now in the brand's timezone
        const defaultTimeLocal = new Date(
          Date.now() + SCHEDULER_TIME_INTERVALS.DEFAULT_SCHEDULE_DELAY_MS
        );
        scheduledTimeUTC = TimezoneService.toUTC(defaultTimeLocal, brandTimezone);
      }

      // 5. Handle concurrency and set processing state
      const currentParams = (content.generationParams as GenerationParams | null) || {};
      const operationId = randomUUID();

      // Check if another operation is in progress
      if (currentParams.processing?.active) {
        logger.info('Canceling existing operation for content', { contentId });

        // Cancel existing AWS schedule if it exists
        if (currentParams.scheduleId) {
          try {
            // Cancel by deleting the schedule in the scheduler microservice.
            // The scheduler service does not currently support status-based cancellations.
            await (
              await this.client
            ).deleteSchedule(currentParams.scheduleId, {
              userId: userId || content.brand.userId,
            });
            logger.info('Deleted existing AWS schedule', { scheduleId: currentParams.scheduleId });
          } catch (cancelError) {
            const code =
              typeof cancelError === 'object' && cancelError && 'code' in cancelError
                ? (cancelError as { code?: string }).code
                : undefined;
            if (code === 'NOT_FOUND') {
              // Already gone; safe to proceed.
              logger.info('Schedule already deleted in scheduler service', {
                scheduleId: currentParams.scheduleId,
              });
            } else {
              logger.warn('Failed to cancel existing schedule', {
                scheduleId: currentParams.scheduleId,
                error: cancelError,
              });
              // Continue with new operation anyway
            }
          }
        }
      }

      // Set processing state before AWS call
      await prisma.content.update({
        where: { id: contentId },
        data: {
          generationParams: {
            ...currentParams,
            processing: {
              active: true,
              operation: 'scheduling',
              startedAt: new Date().toISOString(),
              operationId,
            },
          },
        },
      });

      // 6. Create schedule in AWS microservice first (primary system)
      let scheduleId: string | undefined;
      let awsScheduleCreated = false;
      let scheduleCreationError: unknown = null;

      // Skip AWS scheduling if scheduler is not enabled
      if (!this.schedulerEnabled) {
        logger.info('Scheduler is disabled - saving content locally without AWS scheduling');
        // Clear processing state since we're not actually scheduling
        await prisma.content.update({
          where: { id: contentId },
          data: {
            generationParams: {
              ...currentParams,
              processing: null, // Clear processing state
              awsScheduleCreated: false,
            },
          },
        });
      } else {
        try {
          const preferredTargetSocialAccountId =
            typeof (content as any).targetSocialAccountId === 'string' &&
            String((content as any).targetSocialAccountId).trim().length > 0
              ? String((content as any).targetSocialAccountId).trim()
              : null;

          let destinationPlatform = 'instagram';
          let resolvedSocialAccountId: string | null = null;

          if (preferredTargetSocialAccountId) {
            const sa = await prisma.socialAccount.findFirst({
              where: {
                id: preferredTargetSocialAccountId,
                brandId: content.brandId,
              },
              select: { id: true, platform: true, metadata: true },
            });

            if (!sa || isDisconnected(sa.metadata)) {
              const msg =
                'Selected destination account is no longer connected. Choose a different destination and try again.';
              await emitScheduleFailure(msg);
              return { success: false, error: msg };
            }

            destinationPlatform = String(sa.platform);
            resolvedSocialAccountId = sa.id;
          } else {
            const primary = await resolvePrimarySocialAccount(content.brandId, 'instagram');
            destinationPlatform = primary?.platform ?? 'instagram';
            resolvedSocialAccountId = primary?.id ?? null;
          }

          if (!resolvedSocialAccountId) {
            const msg =
              destinationPlatform === 'facebook'
                ? 'No Facebook Page is connected for this brand. Connect a Facebook Page before scheduling.'
                : 'No Instagram account is connected for this brand. Connect an Instagram account before scheduling.';
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          const schedulerPlatform = toSchedulerPlatform(destinationPlatform);
          if (!schedulerPlatform) {
            const msg = `Scheduling is not supported for platform: ${destinationPlatform}`;
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          const validationPlatform = toValidationPlatform(destinationPlatform);
          if (!validationPlatform) {
            const msg = `Content validation is not supported for platform: ${destinationPlatform}`;
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          const normalizedContentType: ValidationContentType =
            validationPlatform === 'instagram' ? normalizeContentType(content.contentType) : 'post';
          const dbMediaAssets = (content.mediaAssets || []).map((asset) => ({
            assetId: asset.assetId,
            displayOrder: asset.displayOrder,
          }));
          const assetIds = dbMediaAssets
            .map((asset) => asset.assetId)
            .filter(
              (assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0
            );

          const assetMetadataById = await getAssetMetadataByIds(assetIds);
          const missingAssetIds: string[] = [];
          const structuredMediaAssets: Array<{
            key: string;
            type: 'image' | 'video';
            order: number;
            width?: number;
            height?: number;
            assetId?: string;
            duration?: number;
          }> = [];

          for (const asset of dbMediaAssets) {
            const info = assetMetadataById.get(asset.assetId);
            if (!info) {
              missingAssetIds.push(asset.assetId);
              continue;
            }
            structuredMediaAssets.push({
              key: info.s3Key,
              type: info.fileType,
              order: asset.displayOrder,
              width: info.width ?? undefined,
              height: info.height ?? undefined,
              assetId: asset.assetId,
              duration: info.fileType === 'video' ? (info.duration ?? undefined) : undefined,
            });
          }

          structuredMediaAssets.sort((a, b) => a.order - b.order);

          const hasCaptionText = Boolean(content.caption && content.caption.trim().length > 0);

          if (missingAssetIds.length > 0) {
            const msg = `Some media assets could not be resolved: ${missingAssetIds.join(', ')}`;
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          if (
            structuredMediaAssets.length === 0 &&
            !(validationPlatform === 'facebook' && hasCaptionText)
          ) {
            const msg = 'Missing media assets for scheduling. Please attach media and try again.';
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          const hasImages = structuredMediaAssets.some((asset) => asset.type === 'image');
          const hasVideos = structuredMediaAssets.some((asset) => asset.type === 'video');
          if (validationPlatform === 'facebook' && hasImages && hasVideos) {
            const msg = 'Facebook posts cannot mix images and videos in the same scheduled post.';
            await emitScheduleFailure(msg);
            return { success: false, error: msg };
          }

          const normalizedMediaType: ValidationMediaType | undefined =
            structuredMediaAssets.length > 0
              ? validationPlatform === 'instagram'
                ? deriveScheduleMediaType(normalizedContentType, structuredMediaAssets)
                : hasVideos
                  ? 'video'
                  : 'image'
              : undefined;

          // For Instagram carousels (multiple media assets), Instagram requires a consistent aspect ratio.
          if (
            schedulerPlatform === 'instagram' &&
            structuredMediaAssets.length > 1 &&
            !haveUniformAspectRatio(structuredMediaAssets)
          ) {
            const msg =
              'All carousel items must have the same aspect ratio before scheduling. Please crop or resize your media so they match.';
            await emitScheduleFailure(msg);
            return {
              success: false,
              error: msg,
            };
          }

          const validation = validateContentPayload({
            platform: validationPlatform,
            contentType: normalizedContentType,
            ...(normalizedMediaType ? { mediaType: normalizedMediaType } : {}),
            caption: normalizedContentType === 'story' ? '' : content.caption,
            ...(structuredMediaAssets.length > 0
              ? {
                  mediaAssets: structuredMediaAssets.map((asset) => ({
                    key: asset.key,
                    type: asset.type,
                  })),
                }
              : {}),
          });

          if (!validation.ok) {
            const msg = validation.errors[0]?.message || 'Invalid content payload for scheduling';
            await emitScheduleFailure(msg);
            return {
              success: false,
              error: msg,
            };
          }

          const schedulePayload: CreateScheduleInput = {
            contentId: content.id,
            brandId: content.brandId,
            userId: userId || content.brand.userId,
            platform: schedulerPlatform,
            scheduledAt: scheduledTimeUTC.toISOString(),
            contentType: normalizedContentType,
            ...(normalizedMediaType ? { mediaType: normalizedMediaType } : {}),
            caption: content.caption || '',
            ...(schedulerPlatform === 'instagram' &&
            typeof content.firstComment === 'string' &&
            content.firstComment.trim().length
              ? { firstComment: content.firstComment.trim() }
              : {}),
            ...(schedulerPlatform === 'instagram' &&
            Array.isArray(content.hashtags) &&
            content.hashtags.length
              ? { hashtags: content.hashtags }
              : {}),
            metadata: {
              socialAccountId: resolvedSocialAccountId,
              timezone: brandTimezone,
              localTime: customTime ? customTime.toISOString() : undefined,
            },
            ...(schedulerPlatform === 'instagram' &&
            normalizedContentType === 'reel' &&
            typeof content.shareToFeed === 'boolean'
              ? { shareToFeed: Boolean(content.shareToFeed) }
              : {}),
            ...(schedulerPlatform === 'instagram' &&
            typeof content.thumbOffset === 'number' &&
            content.thumbOffset >= 0
              ? { thumbOffset: content.thumbOffset }
              : {}),
            ...(structuredMediaAssets.length > 0 ? { mediaAssets: structuredMediaAssets } : {}),
          };

          const schedule = await (await this.client).createSchedule(schedulePayload);

          scheduleId = schedule?.scheduleId;
          awsScheduleCreated = true;
        } catch (awsError: unknown) {
          scheduleCreationError = awsError;
          // Handle circuit breaker and network errors gracefully
          const code =
            typeof awsError === 'object' && awsError && 'code' in awsError
              ? (awsError as { code?: string }).code
              : undefined;
          if (code === 'CIRCUIT_BREAKER_OPEN' || code === 'EOPENBREAKER') {
            logger.warn('Circuit breaker open - saving locally without scheduling');
          } else if (code === 'NETWORK_ERROR' || code === 'TIMEOUT') {
            logger.warn('Network or timeout error connecting to scheduler - saving locally');
          } else if (code === 'SERVICE_BUSY') {
            logger.warn('Scheduler service busy - saving locally');
          } else {
            logger.error('Failed to create schedule in AWS', { error: awsError });
          }
          // AWS scheduling failed - we'll handle this below by updating local DB with error
        }
      }

      // 7. Persist schedule metadata if AWS succeeded; otherwise clear processing
      if (!awsScheduleCreated) {
        // AWS scheduling failed - capture a user-facing reason and keep the attempted time visible
        const validationErrors =
          typeof (scheduleCreationError as { details?: { errors?: unknown[] } }).details?.errors ===
          'object'
            ? ((scheduleCreationError as { details?: { errors?: unknown[] } }).details
                ?.errors as unknown[])
            : undefined;
        const firstValidationError =
          Array.isArray(validationErrors) && validationErrors.length
            ? String(validationErrors[0])
            : null;
        const fallbackMessage =
          scheduleCreationError instanceof Error && scheduleCreationError.message
            ? scheduleCreationError.message
            : 'AWS Scheduler unavailable - content not scheduled';
        const schedulingError = firstValidationError || fallbackMessage;

        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              // Surface as failed so calendars keep it visible with error context
              status: 'failed',
              scheduledAt: scheduledTimeUTC,
              schedulingError,
              generationParams: {
                ...currentParams,
                processing: null, // Clear processing flag
                awsScheduleCreated: false,
              },
            },
          });
        } catch (dbError) {
          logger.error('Failed to update local database with scheduling error', { error: dbError });
          throw dbError;
        }
      } else {
        // Persist scheduleId and flag so later cancel/delete can reliably unschedule
        try {
          const updatedParams = {
            ...currentParams,
            // keep processing active until downstream sync clears it
            processing: currentParams.processing || {
              active: true,
              operation: 'scheduling',
              startedAt: new Date().toISOString(),
              operationId,
            },
            scheduleId,
            awsScheduleCreated: true,
          } as GenerationParams;

          // Only update scheduledAt if it differs or was missing
          const needsScheduledAtUpdate =
            !content.scheduledAt || content.scheduledAt.getTime() !== scheduledTimeUTC.getTime();

          await prisma.content.update({
            where: { id: contentId },
            data: {
              ...(needsScheduledAtUpdate ? { scheduledAt: scheduledTimeUTC } : {}),
              generationParams: JSON.parse(JSON.stringify(updatedParams)),
            },
          });
        } catch (persistErr) {
          logger.warn('Failed to persist schedule metadata; cancel may not work', {
            error: persistErr,
            contentId,
          });
        }
      }

      // 8. Broadcast status change (only after both AWS and DB succeed)
      if (awsScheduleCreated && this.broadcaster && scheduleId) {
        await this.broadcaster.broadcastStatusChange(
          content.id,
          content.brandId,
          originalStatus,
          'scheduled',
          {
            scheduleId,
            scheduledAt: scheduledTimeUTC.toISOString(),
            timezone: brandTimezone,
          }
        );
      }

      // Log with timezone context
      if (awsScheduleCreated) {
        const localTimeDisplay = TimezoneService.formatWithTimezone(
          scheduledTimeUTC,
          brandTimezone
        );
        logger.info('Content scheduled successfully', {
          contentId,
          scheduledFor: localTimeDisplay,
        });
      }

      if (!awsScheduleCreated) {
        await emitScheduleFailure('AWS Scheduler unavailable - content not scheduled');
      }

      return awsScheduleCreated
        ? {
            success: true,
            scheduleId: scheduleId!,
            brandId: content.brandId,
          }
        : {
            success: false,
            error: 'AWS Scheduler unavailable - content not scheduled',
          };
    } catch (error) {
      logger.error('Error scheduling content', { error });

      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        await eventEmitter.emitScheduleFailed({
          contentId,
          brandId: fetchedContent?.brandId,
          operation: 'create',
          error: message,
        });
      } catch (emitError) {
        logger.warn('Failed to emit schedule.failed event from API catch', {
          contentId,
          error: emitError,
        });
      }

      // Attempt to restore original state in database
      if (originalStatus !== null && contentId) {
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              status: originalStatus,
              scheduledAt: originalScheduledAt,
              schedulingError: `Scheduling failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          });
          // Emit notification about scheduling failure
          try {
            const { notificationsService } = await import('./notifications.js');
            await notificationsService.emitEvent({
              userId: fetchedContent?.brand.userId || userId || '',
              brandId: fetchedContent?.brandId,
              type: 'publishing.scheduling_failed',
              category: 'publishing',
              severity: 'error',
              title: 'Scheduling failed',
              body:
                error instanceof Error
                  ? error.message
                  : 'An unknown error occurred while scheduling your post.',
              linkUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/posts/${contentId}`,
              resource: { type: 'post', id: contentId },
              dedupeKey: `content:${contentId}:scheduling_failed`,
            });
          } catch (e) {
            logger.error('Failed to emit scheduling failure notification', { error: e });
          }
        } catch (restoreError) {
          logger.error('Failed to restore original state', { error: restoreError });
        }
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Publish content immediately via the scheduler pipeline.
   *
   * This creates/updates a schedule record with scheduledAt=now and emits schedule.due right away.
   * The publisher uses the schedule record as the source of truth for publishing payload.
   */
  async publishNow(
    contentId: string,
    userId?: string
  ): Promise<{
    success: boolean;
    scheduleId?: string;
    brandId?: string;
    error?: string;
  }> {
    // Store original state for rollback
    let originalStatus: ContentStatus | null = null;
    let originalScheduledAt: Date | null = null;
    let originalSchedulingError: string | null = null;
    let currentParams: GenerationParams = {};
    let fetchedContent: { brandId: string; brand: { userId: string } } | null = null;

    const operationId = randomUUID();

    try {
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            include: {
              user: true,
            },
          },
          mediaAssets: {
            select: {
              displayOrder: true,
              assetId: true,
            },
            orderBy: {
              displayOrder: 'asc',
            },
          },
        },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      fetchedContent = { brandId: content.brandId, brand: { userId: content.brand.userId } };

      originalStatus = content.status as ContentStatus;
      originalScheduledAt = content.scheduledAt;
      originalSchedulingError =
        typeof (content as any).schedulingError === 'string'
          ? String((content as any).schedulingError)
          : null;

      if ((content.status as unknown as string) === 'published') {
        return { success: false, error: 'Content is already published' };
      }

      currentParams = (content.generationParams as GenerationParams | null) || {};
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
      const scheduledTimeUTC = new Date();

      const preferredTargetSocialAccountId =
        typeof (content as any).targetSocialAccountId === 'string' &&
        String((content as any).targetSocialAccountId).trim().length > 0
          ? String((content as any).targetSocialAccountId).trim()
          : null;

      let destinationPlatform = 'instagram';
      let resolvedSocialAccountId: string | null = null;

      if (preferredTargetSocialAccountId) {
        const sa = await prisma.socialAccount.findFirst({
          where: {
            id: preferredTargetSocialAccountId,
            brandId: content.brandId,
          },
          select: { id: true, platform: true, metadata: true },
        });

        if (!sa || isDisconnected(sa.metadata)) {
          const msg =
            'Selected destination account is no longer connected. Choose a different destination and try again.';
          return { success: false, error: msg };
        }

        destinationPlatform = String(sa.platform);
        resolvedSocialAccountId = sa.id;
      } else {
        const primary = await resolvePrimarySocialAccount(content.brandId, 'instagram');
        destinationPlatform = primary?.platform ?? 'instagram';
        resolvedSocialAccountId = primary?.id ?? null;
      }

      if (!resolvedSocialAccountId) {
        const msg =
          destinationPlatform === 'facebook'
            ? 'No Facebook Page is connected for this brand. Connect a Facebook Page before publishing.'
            : 'No Instagram account is connected for this brand. Connect an Instagram account before publishing.';
        return { success: false, error: msg };
      }

      const schedulerPlatform = toSchedulerPlatform(destinationPlatform);
      if (
        !schedulerPlatform ||
        (schedulerPlatform !== 'instagram' && schedulerPlatform !== 'facebook')
      ) {
        const msg = `Publishing is not supported for platform: ${destinationPlatform}`;
        return { success: false, error: msg };
      }

      const validationPlatform = toValidationPlatform(destinationPlatform);
      if (!validationPlatform) {
        const msg = `Content validation is not supported for platform: ${destinationPlatform}`;
        return { success: false, error: msg };
      }

      const normalizedContentType: ValidationContentType =
        validationPlatform === 'instagram' ? normalizeContentType(content.contentType) : 'post';

      const dbMediaAssets = (content.mediaAssets || []).map((asset) => ({
        assetId: asset.assetId,
        displayOrder: asset.displayOrder,
      }));
      const assetIds = dbMediaAssets
        .map((asset) => asset.assetId)
        .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0);

      const assetMetadataById = await getAssetMetadataByIds(assetIds);
      const missingAssetIds: string[] = [];
      const structuredMediaAssets: Array<{
        key: string;
        type: 'image' | 'video';
        order: number;
        width?: number;
        height?: number;
        assetId?: string;
        duration?: number;
      }> = [];

      for (const asset of dbMediaAssets) {
        const info = assetMetadataById.get(asset.assetId);
        if (!info) {
          missingAssetIds.push(asset.assetId);
          continue;
        }
        structuredMediaAssets.push({
          key: info.s3Key,
          type: info.fileType,
          order: asset.displayOrder,
          width: info.width ?? undefined,
          height: info.height ?? undefined,
          assetId: asset.assetId,
          duration: info.fileType === 'video' ? (info.duration ?? undefined) : undefined,
        });
      }

      structuredMediaAssets.sort((a, b) => a.order - b.order);

      const hasCaptionText = Boolean(content.caption && content.caption.trim().length > 0);

      if (missingAssetIds.length > 0) {
        const msg = `Some media assets could not be resolved: ${missingAssetIds.join(', ')}`;
        return { success: false, error: msg };
      }

      if (
        structuredMediaAssets.length === 0 &&
        !(validationPlatform === 'facebook' && hasCaptionText)
      ) {
        const msg = 'Missing media assets for publishing. Please attach media and try again.';
        return { success: false, error: msg };
      }

      const hasImages = structuredMediaAssets.some((asset) => asset.type === 'image');
      const hasVideos = structuredMediaAssets.some((asset) => asset.type === 'video');
      if (validationPlatform === 'facebook' && hasImages && hasVideos) {
        const msg = 'Facebook posts cannot mix images and videos in the same published post.';
        return { success: false, error: msg };
      }

      const normalizedMediaType: ValidationMediaType | undefined =
        structuredMediaAssets.length > 0
          ? validationPlatform === 'instagram'
            ? deriveScheduleMediaType(normalizedContentType, structuredMediaAssets)
            : hasVideos
              ? 'video'
              : 'image'
          : undefined;

      if (
        schedulerPlatform === 'instagram' &&
        structuredMediaAssets.length > 1 &&
        !haveUniformAspectRatio(structuredMediaAssets)
      ) {
        const msg =
          'All carousel items must have the same aspect ratio before publishing. Please crop or resize your media so they match.';
        return { success: false, error: msg };
      }

      const validation = validateContentPayload({
        platform: validationPlatform,
        contentType: normalizedContentType,
        ...(normalizedMediaType ? { mediaType: normalizedMediaType } : {}),
        caption: normalizedContentType === 'story' ? '' : content.caption,
        ...(structuredMediaAssets.length > 0
          ? {
              mediaAssets: structuredMediaAssets.map((asset) => ({
                key: asset.key,
                type: asset.type,
              })),
            }
          : {}),
      });

      if (!validation.ok) {
        const msg = validation.errors[0]?.message || 'Invalid content payload for publishing';
        return { success: false, error: msg };
      }

      // Set processing state + move content to scheduled at "now" before enqueue.
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'scheduled' as ContentStatus,
          scheduledAt: scheduledTimeUTC,
          schedulingError: null,
          generationParams: {
            ...currentParams,
            processing: {
              active: true,
              operation: 'scheduling',
              startedAt: new Date().toISOString(),
              operationId,
            },
          },
        },
      });

      const publishPayload: CreateScheduleInput = {
        contentId: content.id,
        brandId: content.brandId,
        userId: userId || content.brand.userId,
        platform: schedulerPlatform,
        scheduledAt: scheduledTimeUTC.toISOString(),
        contentType: normalizedContentType,
        ...(normalizedMediaType ? { mediaType: normalizedMediaType } : {}),
        caption: content.caption || '',
        ...(schedulerPlatform === 'instagram' &&
        typeof content.firstComment === 'string' &&
        content.firstComment.trim().length
          ? { firstComment: content.firstComment.trim() }
          : {}),
        ...(schedulerPlatform === 'instagram' &&
        Array.isArray(content.hashtags) &&
        content.hashtags.length
          ? { hashtags: content.hashtags }
          : {}),
        metadata: {
          socialAccountId: resolvedSocialAccountId,
          timezone: brandTimezone,
          localTime: scheduledTimeUTC.toISOString(),
        },
        ...(schedulerPlatform === 'instagram' &&
        normalizedContentType === 'reel' &&
        typeof content.shareToFeed === 'boolean'
          ? { shareToFeed: Boolean(content.shareToFeed) }
          : {}),
        ...(schedulerPlatform === 'instagram' &&
        typeof content.thumbOffset === 'number' &&
        content.thumbOffset >= 0
          ? { thumbOffset: content.thumbOffset }
          : {}),
        ...(structuredMediaAssets.length > 0 ? { mediaAssets: structuredMediaAssets } : {}),
      };

      const schedule = await (await this.client).publishNow(publishPayload);

      const scheduleId = schedule?.scheduleId;
      if (!scheduleId) {
        throw new Error('Failed to enqueue publish request');
      }

      const updatedParams = {
        ...currentParams,
        processing: currentParams.processing || {
          active: true,
          operation: 'scheduling',
          startedAt: new Date().toISOString(),
          operationId,
        },
        scheduleId,
        awsScheduleCreated: true,
      } as GenerationParams;

      await prisma.content.update({
        where: { id: contentId },
        data: {
          generationParams: JSON.parse(JSON.stringify(updatedParams)),
        },
      });

      return {
        success: true,
        scheduleId,
        brandId: content.brandId,
      };
    } catch (error) {
      logger.error('Error publishing content (publish-now)', { error });

      const message = error instanceof Error ? error.message : 'Unknown error';
      try {
        await eventEmitter.emitScheduleFailed({
          contentId,
          brandId: fetchedContent?.brandId,
          operation: 'create',
          error: message,
        });
      } catch (emitError) {
        logger.warn('Failed to emit schedule.failed event from publish-now catch', {
          contentId,
          error: emitError,
        });
      }

      if (originalStatus !== null && contentId) {
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              status: originalStatus,
              scheduledAt: originalScheduledAt,
              schedulingError: originalSchedulingError,
              generationParams: JSON.parse(
                JSON.stringify({
                  ...currentParams,
                  processing: null,
                })
              ),
            },
          });
        } catch (restoreError) {
          logger.error('Failed to restore original state after publish-now failure', {
            error: restoreError,
            contentId,
          });
        }
      }

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Cancel scheduled content with proper consistency
   */
  async cancelSchedule(contentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get content to find schedule ID and store original state
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: { brand: { select: { id: true, userId: true } } },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Type-safe access to generationParams with proper null checking
      const generationParams = (content.generationParams as GenerationParams | null) || {};
      let scheduleId = generationParams.scheduleId;
      let wasAwsScheduled = generationParams.awsScheduleCreated;

      // Fallback: scheduleId might not have been persisted (older records)
      if ((!scheduleId || !wasAwsScheduled) && content.brand?.id) {
        try {
          const list = await (await this.client).getUpcomingSchedules(content.brand.id, 50);
          const match = list.find((s) => s.contentId === contentId);
          if (match) {
            scheduleId = match.scheduleId;
            wasAwsScheduled = true;
          }
        } catch (listErr) {
          logger.warn('Failed to list schedules for fallback cancel lookup', {
            error: listErr,
            brandId: content.brand.id,
          });
        }
      }

      let awsCancelled = false;

      if (scheduleId && wasAwsScheduled) {
        // Cancel in AWS if it was actually created there
        try {
          // Cancel by deleting the schedule in the scheduler microservice.
          // The scheduler service does not currently support status-based cancellations.
          await (await this.client).deleteSchedule(scheduleId, { userId: content.brand.userId });
          awsCancelled = true;
          logger.info('AWS schedule cancelled successfully', { scheduleId });
        } catch (error: unknown) {
          // Handle circuit breaker errors gracefully
          const errObj = error as { code?: string } | undefined;
          if (errObj?.code === 'NOT_FOUND') {
            awsCancelled = true;
            logger.info('AWS schedule already deleted', { scheduleId });
          } else {
            if (errObj?.code === 'CIRCUIT_BREAKER_OPEN' || errObj?.code === 'EOPENBREAKER') {
              logger.warn('Circuit breaker open - continuing with local cancellation only');
            } else if (errObj?.code === 'NETWORK_ERROR' || errObj?.code === 'TIMEOUT') {
              logger.warn('Network or timeout error - continuing with local cancellation only');
            } else if (errObj?.code === 'SERVICE_BUSY') {
              logger.warn('Scheduler service busy - continuing with local cancellation only');
            } else {
              logger.error('Failed to cancel in AWS', { error });
              // Log inconsistency but continue with local update
              await this.logInconsistency(contentId, 'AWS_CANCEL_FAILED', {
                scheduleId,
                error,
              });
            }
          }
        }
      }

      // Update local database (always update to maintain user expectation)
      await prisma.content.update({
        where: { id: contentId },
        data: {
          status: 'draft' as ContentStatus,
          scheduledAt: null,
          schedulingError:
            awsCancelled || !wasAwsScheduled ? null : 'Warning: AWS schedule may still be active',
          generationParams: JSON.parse(
            JSON.stringify({
              ...generationParams,
              scheduleId: null,
              awsScheduleCreated: false,
              cancelledAt: new Date().toISOString(),
            })
          ),
        },
      });

      // Broadcast status change if we have a broadcaster
      if (this.broadcaster) {
        await this.broadcaster.broadcastStatusChange(
          content.id,
          content.brandId,
          'scheduled',
          'draft',
          { cancelled: true }
        );
      }

      return { success: true };
    } catch (error) {
      logger.error('Error canceling schedule', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Reschedule content to new time with timezone awareness
   */
  async rescheduleContent(
    contentId: string,
    newTime: Date,
    isLocalTime = true
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get content to find schedule ID
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            select: {
              id: true,
              name: true,
              userId: true, // Include userId for scheduler
            },
          },
          mediaAssets: {
            select: {
              displayOrder: true,
              assetId: true,
            },
          },
        },
      });

      if (!content) {
        return { success: false, error: 'Content not found' };
      }

      // Get brand timezone
      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);

      // Convert new time to UTC if it's provided in local time
      const newTimeUTC = isLocalTime ? TimezoneService.toUTC(newTime, brandTimezone) : newTime;

      logger.info('Rescheduling content', {
        contentId,
        from: content.scheduledAt,
        to: newTimeUTC.toISOString(),
        timezone: brandTimezone,
      });

      // Type-safe access to generationParams
      const generationParams = (content.generationParams as GenerationParams | null) || {};
      const scheduleId = generationParams.scheduleId;
      let awsRescheduleSuccess = false;
      // Removed unused awsError variable (errors handled inline)

      if (!scheduleId) {
        // Auto-recovery pattern: Handle different scenarios where schedule ID is missing
        if (content.scheduledAt) {
          // Content has a scheduled time but no AWS schedule ID
          // This typically happens when:
          // 1. Initial scheduling failed (e.g., AWS was down)
          // 2. A prior workflow attempted to schedule but did not persist schedule metadata
          // 3. Manual scheduling attempt failed

          logger.warn(
            'AUTO-RECOVERY: scheduledAt present but no scheduleId - treating as new schedule',
            { contentId, status: content.status }
          );

          // Create a new schedule instead of failing
          // This provides auto-recovery for failed scheduling attempts
          const newTimeLocal = isLocalTime
            ? newTime
            : TimezoneService.toLocal(newTimeUTC, brandTimezone);

          logger.info('Attempting to schedule content after recovery', {
            contentId,
            scheduledAt: newTimeUTC.toISOString(),
            timezone: brandTimezone,
          });

          const scheduleResult = await this.scheduleContent(
            contentId,
            newTimeLocal,
            content.brand.userId
          );

          if (scheduleResult.success) {
            logger.info('AUTO-RECOVERY SUCCESS: Content scheduled after recovery', {
              contentId,
              scheduledAt: newTimeUTC.toISOString(),
            });

            // Also update the scheduled time if it's different
            if (content.scheduledAt.getTime() !== newTimeUTC.getTime()) {
              await prisma.content.update({
                where: { id: contentId },
                data: {
                  scheduledAt: newTimeUTC,
                  schedulingError: null, // Clear any previous errors
                },
              });
            }

            return { success: true };
          }
          return {
            success: false,
            error: `Failed to schedule content: ${scheduleResult.error}`,
          };
        }
        if (content.status === 'scheduled') {
          // Edge case: Content is marked as scheduled but has no scheduledAt or scheduleId
          // This shouldn't happen but handle it gracefully
          logger.error(
            'Data inconsistency: content marked as scheduled but missing scheduledAt or scheduleId',
            { contentId }
          );

          // Try to schedule it at the requested time
          const newTimeLocal = isLocalTime
            ? newTime
            : TimezoneService.toLocal(newTimeUTC, brandTimezone);

          const scheduleResult = await this.scheduleContent(
            contentId,
            newTimeLocal,
            content.brand.userId
          );

          if (scheduleResult.success) {
            logger.info('Successfully created schedule for inconsistent content', { contentId });
            return { success: true };
          }
          return {
            success: false,
            error: `Failed to create schedule: ${scheduleResult.error}`,
          };
        }
        // Content is truly not scheduled (draft with no scheduledAt)
        return {
          success: false,
          error: 'Content is not scheduled. Please use the schedule action instead of reschedule.',
        };
      }

      // Reschedule in AWS FIRST - only update local DB if this succeeds
      // Use updateSchedule directly to include content updates
      try {
        const updatePayload: UpdateScheduleInput = {
          scheduledAt: newTimeUTC.toISOString(),
          brandId: content.brandId,
          contentId: content.id,
          userId: content.brand.userId,
          caption: content.caption || '',
        };

        const preferredTargetSocialAccountId =
          typeof (content as any).targetSocialAccountId === 'string' &&
          String((content as any).targetSocialAccountId).trim().length > 0
            ? String((content as any).targetSocialAccountId).trim()
            : null;

        let destinationPlatform = 'instagram';
        let resolvedSocialAccountId: string | null = null;
        if (preferredTargetSocialAccountId) {
          const sa = await prisma.socialAccount.findFirst({
            where: {
              id: preferredTargetSocialAccountId,
              brandId: content.brandId,
            },
            select: { id: true, platform: true, metadata: true },
          });
          if (!sa || isDisconnected(sa.metadata)) {
            return {
              success: false,
              error:
                'Selected destination account is no longer connected. Choose a different destination and try again.',
            };
          }
          destinationPlatform = String(sa.platform);
          resolvedSocialAccountId = sa.id;
        } else {
          const primary = await resolvePrimarySocialAccount(content.brandId, 'instagram');
          destinationPlatform = primary?.platform ?? 'instagram';
          resolvedSocialAccountId = primary?.id ?? null;
        }

        if (!resolvedSocialAccountId) {
          return {
            success: false,
            error:
              destinationPlatform === 'facebook'
                ? 'No Facebook Page is connected for this brand. Connect a Facebook Page before rescheduling.'
                : 'No Instagram account is connected for this brand. Connect an Instagram account before rescheduling.',
          };
        }

        const schedulerPlatform = toSchedulerPlatform(destinationPlatform);
        if (!schedulerPlatform) {
          return {
            success: false,
            error: `Scheduling is not supported for platform: ${destinationPlatform}`,
          };
        }

        updatePayload.platform = schedulerPlatform;
        if (
          schedulerPlatform === 'instagram' &&
          typeof content.firstComment === 'string' &&
          content.firstComment.trim().length
        ) {
          updatePayload.firstComment = content.firstComment.trim();
        }
        if (schedulerPlatform === 'instagram' && typeof content.shareToFeed === 'boolean') {
          updatePayload.shareToFeed = Boolean(content.shareToFeed);
        }
        updatePayload.metadata = {
          timezone: brandTimezone,
          localTime: isLocalTime
            ? newTime.toISOString()
            : TimezoneService.toLocal(newTimeUTC, brandTimezone).toISOString(),
          socialAccountId: resolvedSocialAccountId,
        };
        const dbMediaAssets = (content.mediaAssets || []).map((asset) => ({
          assetId: asset.assetId,
          displayOrder: asset.displayOrder,
        }));
        const assetIds = dbMediaAssets
          .map((asset) => asset.assetId)
          .filter(
            (assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0
          );

        const assetMetadataById = await getAssetMetadataByIds(assetIds);
        const missingAssetIds: string[] = [];
        const structuredMediaAssets: Array<{
          key: string;
          type: 'image' | 'video';
          order: number;
          width?: number;
          height?: number;
          assetId?: string;
          duration?: number;
        }> = [];

        for (const asset of dbMediaAssets) {
          const info = assetMetadataById.get(asset.assetId);
          if (!info) {
            missingAssetIds.push(asset.assetId);
            continue;
          }
          structuredMediaAssets.push({
            key: info.s3Key,
            type: info.fileType,
            order: asset.displayOrder,
            width: info.width ?? undefined,
            height: info.height ?? undefined,
            assetId: asset.assetId,
            duration: info.fileType === 'video' ? (info.duration ?? undefined) : undefined,
          });
        }

        structuredMediaAssets.sort((a, b) => a.order - b.order);

        if (missingAssetIds.length > 0) {
          return {
            success: false,
            error: `Some media assets could not be resolved: ${missingAssetIds.join(', ')}`,
          };
        }

        // For Instagram carousels, enforce consistent aspect ratio before rescheduling.
        if (
          schedulerPlatform === 'instagram' &&
          structuredMediaAssets.length > 1 &&
          !haveUniformAspectRatio(structuredMediaAssets)
        ) {
          return {
            success: false,
            error:
              'All carousel items must have the same aspect ratio before rescheduling. Please crop or resize your media so they match.',
          };
        }

        // Send structured media assets
        if (structuredMediaAssets.length > 0) {
          updatePayload.mediaAssets = structuredMediaAssets;
        }
        if (Array.isArray(content.hashtags) && content.hashtags.length) {
          updatePayload.hashtags = content.hashtags;
        }
        if (typeof content.thumbOffset === 'number' && content.thumbOffset >= 0) {
          updatePayload.thumbOffset = content.thumbOffset;
        }
        await (await this.client).updateSchedule(scheduleId, updatePayload);
        awsRescheduleSuccess = true;
        logger.info('AWS schedule rescheduled successfully with updated content', { scheduleId });
      } catch (error: unknown) {
        // Handle circuit breaker errors with more specific messaging
        const errObj = error as
          | { code?: string; message?: string; details?: Record<string, unknown> }
          | undefined;
        const detailsMessage =
          errObj?.details &&
          typeof errObj.details === 'object' &&
          (typeof errObj.details.error === 'string'
            ? errObj.details.error
            : typeof errObj.details.message === 'string'
              ? errObj.details.message
              : null);
        if (errObj?.code === 'CIRCUIT_BREAKER_OPEN' || errObj?.code === 'EOPENBREAKER') {
          logger.error(
            'Circuit breaker is open - AWS scheduler temporarily unavailable. Reschedule failed.'
          );
          return {
            success: false,
            error: 'AWS scheduler temporarily unavailable. Please try again in a few minutes.',
          };
        }
        if (errObj?.code === 'NETWORK_ERROR' || errObj?.code === 'TIMEOUT') {
          logger.error('Network or timeout error connecting to AWS scheduler. Reschedule failed.');
          return {
            success: false,
            error:
              'Network error connecting to scheduler service. Please check your connection and try again.',
          };
        }
        if (errObj?.code === 'SERVICE_BUSY') {
          logger.error('Scheduler service busy. Reschedule failed.');
          return {
            success: false,
            error: 'Scheduler service is busy. Please retry shortly.',
          };
        }
        logger.error('Failed to reschedule in AWS', { error });
        return {
          success: false,
          error: `Failed to reschedule: ${detailsMessage || errObj?.message || 'Unknown AWS scheduler error'}`,
        };
      }

      // Only update local database if AWS reschedule succeeded
      if (awsRescheduleSuccess) {
        try {
          await prisma.content.update({
            where: { id: contentId },
            data: {
              scheduledAt: newTimeUTC,
              schedulingError: null, // Clear any previous errors
              generationParams: JSON.parse(
                JSON.stringify({
                  ...generationParams,
                  scheduledTimezone: brandTimezone,
                  rescheduledAt: new Date().toISOString(),
                  rescheduledLocalTime: isLocalTime ? newTime.toISOString() : undefined,
                })
              ),
            },
          });

          // Log with timezone context
          const localTimeDisplay = TimezoneService.formatWithTimezone(newTimeUTC, brandTimezone);
          logger.info('Content rescheduled successfully', {
            contentId,
            scheduledFor: localTimeDisplay,
          });

          return { success: true };
        } catch (dbError) {
          // AWS succeeded but local DB failed - this is a serious consistency issue
          logger.error('CRITICAL: AWS reschedule succeeded but local DB update failed', {
            error: dbError,
          });
          await this.logInconsistency(contentId, 'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS', {
            awsScheduleId: scheduleId,
            newTime: newTimeUTC.toISOString(),
            error: dbError,
          });

          return {
            success: false,
            error:
              'Schedule was updated in AWS but local database sync failed. Please refresh the page.',
          };
        }
      }

      // This shouldn't be reached given the return statements above
      return {
        success: false,
        error: 'Unknown error during reschedule operation',
      };
    } catch (error) {
      logger.error('Error rescheduling content', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync the AWS schedule payload (caption/media/etc) without changing time.
   * This keeps scheduled posts accurate when users edit them after scheduling.
   */
  async updateScheduledContent(contentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const content = await prisma.content.findUnique({
        where: { id: contentId },
        include: {
          brand: {
            select: {
              id: true,
              userId: true,
            },
          },
          mediaAssets: {
            select: {
              displayOrder: true,
              assetId: true,
            },
          },
        },
      });

      if (!content?.brand) {
        return { success: false, error: 'Content not found' };
      }

      const generationParams = (content.generationParams as GenerationParams | null) || {};
      const scheduleId = generationParams.scheduleId;
      if (!scheduleId) {
        return { success: false, error: 'Content is not scheduled in AWS' };
      }

      const preferredTargetSocialAccountId =
        typeof (content as any).targetSocialAccountId === 'string' &&
        String((content as any).targetSocialAccountId).trim().length > 0
          ? String((content as any).targetSocialAccountId).trim()
          : null;

      let destinationPlatform = 'instagram';
      let resolvedSocialAccountId: string | null = null;
      if (preferredTargetSocialAccountId) {
        const sa = await prisma.socialAccount.findFirst({
          where: {
            id: preferredTargetSocialAccountId,
            brandId: content.brandId,
          },
          select: { id: true, platform: true, metadata: true },
        });
        if (!sa || isDisconnected(sa.metadata)) {
          return {
            success: false,
            error:
              'Selected destination account is no longer connected. Choose a different destination and try again.',
          };
        }
        destinationPlatform = String(sa.platform);
        resolvedSocialAccountId = sa.id;
      } else {
        const primary = await resolvePrimarySocialAccount(content.brandId, 'instagram');
        destinationPlatform = primary?.platform ?? 'instagram';
        resolvedSocialAccountId = primary?.id ?? null;
      }

      if (!resolvedSocialAccountId) {
        return {
          success: false,
          error:
            destinationPlatform === 'facebook'
              ? 'No Facebook Page is connected for this brand. Connect a Facebook Page before updating the schedule.'
              : 'No Instagram account is connected for this brand. Connect an Instagram account before updating the schedule.',
        };
      }

      const schedulerPlatform = toSchedulerPlatform(destinationPlatform);
      if (!schedulerPlatform) {
        return {
          success: false,
          error: `Scheduling is not supported for platform: ${destinationPlatform}`,
        };
      }

      const brandTimezone = await TimezoneService.getBrandTimezone(content.brandId);
      const localTime =
        content.scheduledAt instanceof Date
          ? TimezoneService.toLocal(content.scheduledAt, brandTimezone).toISOString()
          : undefined;

      const updatePayload: UpdateScheduleInput = {
        brandId: content.brandId,
        contentId: content.id,
        userId: content.brand.userId,
        platform: schedulerPlatform,
        caption: content.caption || '',
        ...(schedulerPlatform === 'instagram' &&
        typeof content.firstComment === 'string' &&
        content.firstComment.trim().length
          ? { firstComment: content.firstComment.trim() }
          : {}),
        ...(schedulerPlatform === 'instagram' && typeof content.shareToFeed === 'boolean'
          ? { shareToFeed: Boolean(content.shareToFeed) }
          : {}),
      };

      updatePayload.metadata = {
        timezone: brandTimezone,
        ...(localTime ? { localTime } : {}),
        socialAccountId: resolvedSocialAccountId,
      };

      const dbMediaAssets = (content.mediaAssets || []).map((asset) => ({
        assetId: asset.assetId,
        displayOrder: asset.displayOrder,
      }));
      const assetIds = dbMediaAssets
        .map((asset) => asset.assetId)
        .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0);

      const assetMetadataById = await getAssetMetadataByIds(assetIds);
      const missingAssetIds: string[] = [];
      const structuredMediaAssets: Array<{
        key: string;
        type: 'image' | 'video';
        order: number;
        width?: number;
        height?: number;
        assetId?: string;
        duration?: number;
      }> = [];

      for (const asset of dbMediaAssets) {
        const info = assetMetadataById.get(asset.assetId);
        if (!info) {
          missingAssetIds.push(asset.assetId);
          continue;
        }
        structuredMediaAssets.push({
          key: info.s3Key,
          type: info.fileType,
          order: asset.displayOrder,
          width: info.width ?? undefined,
          height: info.height ?? undefined,
          assetId: asset.assetId,
          duration: info.fileType === 'video' ? (info.duration ?? undefined) : undefined,
        });
      }

      structuredMediaAssets.sort((a, b) => a.order - b.order);

      if (missingAssetIds.length > 0) {
        return {
          success: false,
          error: `Some media assets could not be resolved: ${missingAssetIds.join(', ')}`,
        };
      }

      if (
        schedulerPlatform === 'instagram' &&
        structuredMediaAssets.length > 1 &&
        !haveUniformAspectRatio(structuredMediaAssets)
      ) {
        return {
          success: false,
          error:
            'All carousel items must have the same aspect ratio before updating the schedule. Please crop or resize your media so they match.',
        };
      }

      updatePayload.mediaAssets = structuredMediaAssets;
      if (Array.isArray(content.hashtags) && content.hashtags.length) {
        updatePayload.hashtags = content.hashtags;
      }
      if (typeof content.thumbOffset === 'number' && content.thumbOffset >= 0) {
        updatePayload.thumbOffset = content.thumbOffset;
      }

      await (await this.client).updateSchedule(scheduleId, updatePayload);
      logger.info('AWS schedule content updated successfully', { scheduleId, contentId });
      return { success: true };
    } catch (error) {
      logger.error('Error updating scheduled content payload', { error, contentId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get scheduled content for a brand with proper typing
   */
  async getScheduledContent(
    brandId: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      brandId: string;
      caption: string;
      status: string;
      scheduledAt: Date | null;
      scheduleId?: string;
      source: 'aws' | 'local' | 'merged';
    }>
  > {
    try {
      // Fetch from AWS
      const schedules = await (await this.client).getUpcomingSchedules(brandId, limit);

      // Also get from local database for consistency check
      const localContent = await prisma.content.findMany({
        where: {
          brandId,
          status: 'scheduled',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      });

      // Merge and deduplicate
      const mergedContent = this.mergeScheduledContent(schedules, localContent);
      return mergedContent;
    } catch (error) {
      logger.error('Error getting scheduled content', { error });

      // Fallback to local database
      const content = await prisma.content.findMany({
        where: {
          brandId,
          status: 'scheduled',
          scheduledAt: { gte: new Date() },
        },
        orderBy: { scheduledAt: 'asc' },
        take: limit,
      });

      return content.map((c) => ({
        ...c,
        status: c.status,
        source: 'local' as const,
      }));
    }
  }

  /**
   * Get scheduling statistics with proper typing
   */
  async getSchedulingStats(brandId: string): Promise<{
    aws: { total: number; upcoming: number; failed: number } | null;
    local: {
      total: number;
      scheduled: number;
      draft: number;
      published: number;
    };
    synced: boolean;
  }> {
    try {
      // Get from AWS
      const awsRawStats = await (await this.client).getSchedulingStats(brandId);

      // Transform AWS stats to match expected format
      const awsStats = {
        total:
          awsRawStats.scheduled +
          awsRawStats.published +
          awsRawStats.failed +
          awsRawStats.cancelled +
          awsRawStats.processing,
        upcoming: awsRawStats.scheduled + awsRawStats.processing,
        failed: awsRawStats.failed,
      };

      // Also get from local database
      const localStats = await this.getLocalSchedulingStats(brandId);

      // Return combined stats
      return {
        aws: awsStats,
        local: localStats,
        synced: this.areStatsSynced(awsStats, localStats),
      };
    } catch (error) {
      logger.error('Error getting scheduling stats', { error });

      // Fallback to local stats
      return {
        local: await this.getLocalSchedulingStats(brandId),
        aws: null,
        synced: false,
      };
    }
  }

  /**
   * Health check for scheduler service
   */
  async healthCheck(): Promise<boolean> {
    try {
      return await (await this.client).healthCheck();
    } catch (error) {
      logger.error('Scheduler health check failed', { error });
      return false;
    }
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats(): {
    opened: boolean;
    failures: number;
    successes: number;
    fallbacks: number;
  } {
    if (!this._client) {
      return {
        opened: false,
        failures: 0,
        successes: 0,
        fallbacks: 0,
      };
    }
    const stats = this._client.getCircuitBreakerStats() as unknown as {
      open?: boolean;
      failures: number;
      successes: number;
      fallbacks: number;
    };
    return {
      opened: !!stats.open,
      failures: stats.failures,
      successes: stats.successes,
      fallbacks: stats.fallbacks,
    };
  }

  /**
   * Log data inconsistency for monitoring and reconciliation
   */
  private async logInconsistency(
    contentId: string,
    type:
      | 'AWS_SCHEDULE_WITHOUT_LOCAL'
      | 'AWS_CANCEL_FAILED'
      | 'LOCAL_WITHOUT_AWS'
      | 'DATA_MISMATCH'
      | 'LOCAL_DB_UPDATE_FAILED_AFTER_AWS_SUCCESS',
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      logger.error('DATA INCONSISTENCY', {
        type,
        contentId,
        timestamp: new Date().toISOString(),
        ...details,
      });

      // Store in database for reconciliation (using generationParams as audit trail)
      const content = await prisma.content.findUnique({
        where: { id: contentId },
      });

      if (content) {
        const generationParams = (content.generationParams as GenerationParams | null) || {};
        const inconsistencies = (generationParams.inconsistencies as unknown[]) || [];

        inconsistencies.push({
          type,
          timestamp: new Date().toISOString(),
          details,
        });

        await prisma.content.update({
          where: { id: contentId },
          data: {
            generationParams: JSON.parse(
              JSON.stringify({
                ...generationParams,
                inconsistencies,
                lastInconsistency: type,
                lastInconsistencyAt: new Date().toISOString(),
              })
            ),
          },
        });
      }

      // TODO: Send to monitoring service (CloudWatch, DataDog, etc.)
      // TODO: Trigger reconciliation job if critical inconsistency
    } catch (error) {
      // Don't let logging failures break the main flow
      logger.error('Failed to log inconsistency', { error });
    }
  }

  // ==================== Private Helper Methods ====================

  private mergeScheduledContent(
    awsSchedules: Array<{
      contentId: string;
      scheduledAt: string;
      [key: string]: unknown;
    }>,
    localContent: Array<{
      id: string;
      brandId: string;
      caption: string;
      status: string;
      scheduledAt: Date | null;
      [key: string]: unknown;
    }>
  ): Array<{
    id: string;
    brandId: string;
    caption: string;
    status: string;
    scheduledAt: Date | null;
    scheduleId?: string;
    source: 'aws' | 'local' | 'merged';
  }> {
    const contentMap = new Map();

    // Add AWS schedules
    for (const schedule of awsSchedules) {
      contentMap.set(schedule.contentId, {
        ...schedule,
        source: 'aws',
      });
    }

    // Add/merge local content
    for (const content of localContent) {
      const existing = contentMap.get(content.id);
      if (existing) {
        // Merge, preferring AWS data
        contentMap.set(content.id, {
          ...content,
          ...existing,
          source: 'both',
        });
      } else {
        contentMap.set(content.id, {
          ...content,
          source: 'local',
        });
      }
    }

    return Array.from(contentMap.values());
  }

  private async getLocalSchedulingStats(brandId: string): Promise<{
    total: number;
    scheduled: number;
    draft: number;
    published: number;
  }> {
    const [draft, scheduled, published] = await Promise.all([
      prisma.content.count({
        where: { brandId, status: 'draft' },
      }),
      prisma.content.count({
        where: { brandId, status: 'scheduled' },
      }),
      prisma.content.count({
        where: { brandId, status: 'published' },
      }),
    ]);

    return {
      draft,
      scheduled,
      published,
      total: draft + scheduled + published,
    };
  }

  private areStatsSynced(
    awsStats: { total: number; upcoming: number; failed: number } | null,
    localStats: {
      total: number;
      scheduled: number;
      draft: number;
      published: number;
    }
  ): boolean {
    if (!awsStats || !localStats) {
      return false;
    }

    // Check if key metrics are within acceptable range (allow small differences)
    return (
      Math.abs((awsStats.upcoming || 0) - (localStats.scheduled || 0)) <= SYNC_TOLERANCE &&
      Math.abs((awsStats.total || 0) - (localStats.total || 0)) <= SYNC_TOLERANCE
    );
  }
}

// Export singleton instance. We intentionally avoid logging deprecation warnings here
// because this synchronous accessor is safe: the underlying client is lazily
// initialized via the async `client` getter when first used.
export const schedulerAdapter = SchedulerAdapter.getInstance();
