/**
 * Content Scheduler Client SDK
 * Provides type-safe integration with AWS Content Scheduler microservice
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import * as https from 'https';
import CircuitBreaker from 'opossum';
import type { Options as CircuitBreakerOptions } from 'opossum';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { ParameterManager, getCurrentEnvironment } from '@postolio/service-parameters';
import { resolveAwsServiceTarget } from '@postolio/aws';
import { logger as baseLogger } from '@postolio/logger';

// ==================== Validation Schemas ====================

const PlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin', 'youtube']);
const ScheduleStatusSchema = z.enum([
  'draft',
  'pending',
  'scheduled',
  'processing',
  'published',
  'failed',
  'skipped',
  'cancelled',
  'canceled',
]);
const ContentTypeSchema = z.enum(['post', 'reel', 'story']); // User-facing content type
// Pure media format; reels are modeled as contentType === 'reel' + mediaType === 'video'
const MediaTypeSchema = z.enum(['image', 'video']); // Media format

// Schema that matches Lambda's expected format
const MetadataSchema = z.record(z.string(), z.unknown());

// Structured media asset schema (kept in sync with schedule-management + publisher)
const MediaAssetSchema = z.object({
  key: z.string(), // S3 key or CDN URL
  type: z.enum(['image', 'video']), // Explicit media type
  order: z.number(), // Display order
  width: z.number().optional(), // Asset width in pixels
  height: z.number().optional(), // Asset height in pixels
  assetId: z.string().optional(), // Asset service identifier
  duration: z.number().optional(), // Video duration in seconds
});

const CreateScheduleInputSchema = z.object({
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(), // Required for ownership validation and token retrieval
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(), // Changed from scheduledTime to scheduledAt
  contentType: ContentTypeSchema.optional(), // User-facing type: post/reel/story
  mediaType: MediaTypeSchema.optional(), // Media format: image/video
  videoUrl: z.string().url().nullish(),
  caption: z.string().optional(),
  firstComment: z.string().max(2200, 'firstComment must be at most 2200 characters').optional(),
  mediaAssets: z.array(MediaAssetSchema).optional(),
  hashtags: z.array(z.string()).optional(),
  thumbOffset: z.number().optional(), // Video thumbnail offset in milliseconds
  metadata: MetadataSchema.optional(),
  shareToFeed: z.boolean().optional(),
});

const PublishNowInputSchema = CreateScheduleInputSchema.omit({ scheduledAt: true }).extend({
  // Optional client-provided value; the scheduler service sets the actual value.
  scheduledAt: z.string().datetime().optional(),
});

const UpdateScheduleInputSchema = z
  .object({
    scheduledAt: z.string().datetime().optional(), // Changed from scheduledTime
    caption: z.string().optional(),
    firstComment: z.string().max(2200, 'firstComment must be at most 2200 characters').optional(),
    mediaAssets: z.array(MediaAssetSchema).optional(),
    hashtags: z.array(z.string()).optional(),
    thumbOffset: z.number().optional(),
    shareToFeed: z.boolean().optional(),
    status: ScheduleStatusSchema.optional(),
    metadata: MetadataSchema.optional(),
    // API Gateway validation fields (required when performing reschedule)
    brandId: z.string().optional(),
    contentId: z.string().optional(),
    userId: z.string().optional(), // Required for token retrieval in publisher Lambda
    platform: PlatformSchema.optional(),
  })
  .refine(
    (data) => {
      // If any of the API Gateway fields are provided, all must be provided (including userId for security)
      const hasAnyApiField = data.brandId || data.contentId || data.platform || data.userId;
      const hasRequiredApiFields = data.brandId && data.contentId && data.platform && data.userId;

      return !hasAnyApiField || hasRequiredApiFields;
    },
    {
      message:
        'When updating schedule, brandId, contentId, userId, and platform must all be provided together for API Gateway validation and security',
      path: ['brandId', 'contentId', 'userId', 'platform'],
    }
  );

// Response schema from Lambda
const ScheduleSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(), // Required for security and authorization
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(),
  contentType: ContentTypeSchema.optional(), // User-facing type: post/reel/story
  mediaType: MediaTypeSchema.optional(), // Media format: image/video
  videoUrl: z.string().url().nullish(),
  caption: z.string().nullish(),
  firstComment: z.string().nullish(),
  mediaAssets: z.array(MediaAssetSchema).nullish(),
  hashtags: z.array(z.string()).nullish(),
  shareToFeed: z.boolean().nullish(),
  thumbOffset: z.number().nullish(),
  status: ScheduleStatusSchema,
  retryCount: z.number().default(0),
  metadata: MetadataSchema.nullish(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullish(),
  publishedAt: z.string().datetime().nullish(),
  errorMessage: z.string().nullish(),
});

const ScheduleListSchema = z.object({
  schedules: z.array(ScheduleSchema),
  nextToken: z.string().optional(),
  total: z.number().optional(), // Make total optional since it might be missing
});

const ListSchedulesParamsSchema = z.object({
  brandId: z.string().optional(),
  userId: z.string().optional(),
  platform: PlatformSchema.optional(),
  status: ScheduleStatusSchema.optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  limit: z.number().min(1).max(100).default(20),
  nextToken: z.string().optional(),
});

// ==================== Type Definitions ====================

export type Platform = z.infer<typeof PlatformSchema>;
export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ContentType = z.infer<typeof ContentTypeSchema>;
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleList = z.infer<typeof ScheduleListSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type PublishNowInput = z.infer<typeof PublishNowInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
export type ListSchedulesParams = z.infer<typeof ListSchedulesParamsSchema>;

// ==================== Error Classes ====================

type ErrorDetails = Record<string, unknown>;
export class SchedulerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: ErrorDetails
  ) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export class ValidationError extends SchedulerError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NetworkError extends SchedulerError {
  constructor(message: string, details?: ErrorDetails) {
    super(message, 'NETWORK_ERROR', 0, details);
  }
}

export class RateLimitError extends SchedulerError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter });
  }
}

// Internal helper types for strong typing (cache, request metadata)
type CacheValue =
  | Schedule
  | ScheduleList
  | ErrorDetails
  | string
  | number
  | boolean
  | null
  | undefined;
interface RequestMeta {
  id: string;
  start: number;
  attempt: number;
}
interface RequestWithMeta {
  __meta?: RequestMeta;
  headers?: Record<string, unknown>;
  url?: string;
  method?: string;
  baseURL?: string;
  timeout?: number;
}

// ==================== Client Configuration ====================

export interface ContentSchedulerConfig {
  baseURL: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerOptions?: CircuitBreakerOptions;
  // User context for multi-tenant support
  userId?: string;
  /** Enable verbose debug logging for scheduler HTTP calls */
  debugLogging?: boolean;
}

// ==================== Main Client Class ====================

export class ContentSchedulerClient {
  private client: AxiosInstance;
  private circuitBreaker: CircuitBreaker; // CircuitBreaker instance
  private config: ContentSchedulerConfig;
  private cache: Map<string, { data: CacheValue; timestamp: number; etag?: string }>;
  private debug: boolean;
  private region: string;
  private logger = baseLogger.child({ module: 'ContentSchedulerClient' });

  constructor(config: ContentSchedulerConfig) {
    this.config = {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    // Initialize cache for response caching
    this.cache = new Map();

    // Normalize and sanitize base URL (remove trailing slashes) to avoid SigV4 canonical path mismatches
    const normalizedBaseURL = this.config.baseURL.replace(/\/+$/, '');

    // Infer AWS region and service from hostname
    const { region: inferredRegion, service: inferredService } =
      resolveAwsServiceTarget(normalizedBaseURL);
    this.region = inferredRegion;
    this.debug = this.config.debugLogging ?? true; // default on for now per request for comprehensive logging

    // Initialize Axios client with connection keep-alive for better performance
    this.client = axios.create({
      baseURL: normalizedBaseURL,
      timeout: this.config.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
      }),
    });

    // Pre-signing request interceptor: canonicalize URL path and attach metadata
    // (Must run BEFORE we add headers and BEFORE SigV4 signing)
    this.client.interceptors.request.use((req) => {
      // NOTE: Do NOT delete Authorization header here - it will be added by SigV4 interceptor
      // Only clean up Host header as it's set by the HTTP agent
      if (req.headers) {
        delete (req.headers as Record<string, unknown>)['Host'];
        delete (req.headers as Record<string, unknown>)['host'];
      }

      // Avoid accidental double slashes which break canonical request
      if (req.url) {
        // Preserve query string while normalizing path
        const parts = req.url.split('?');
        const pathPart = parts[0] || '/';
        const queryPart = parts[1];
        const normalizedPath = pathPart.replace(/\/+/g, '/');
        req.url = queryPart ? `${normalizedPath}?${queryPart}` : normalizedPath;
      }

      // Attach timing metadata
      (req as RequestWithMeta).__meta = {
        start: Date.now(),
        id: this.generateRequestId(),
        attempt: 0,
      };
      return req;
    });

    // Add custom request/response interceptors for logging + header enrichment
    // IMPORTANT: These MUST be registered BEFORE the SigV4 interceptor so that
    // all added headers (trace IDs, request IDs, user context) are included in
    // the canonical request that is signed. Previously the signing interceptor
    // ran earlier causing signature mismatches and API Gateway 403 (Missing Authentication Token).
    this.setupInterceptors();

    // Finally add AWS SigV4 signing interceptor LAST to sign the fully-prepared request
    // We need to ensure the interceptor uses the correct credentials and region

    // Create a credential provider adapter that works with aws4-axios
    const credentialProvider = defaultProvider();
    const credentialsAdapter = {
      getCredentials: async () => {
        try {
          const awsCredentials = await credentialProvider();
          // aws4-axios expects sessionToken to be string or absent, not undefined
          const creds: {
            accessKeyId: string;
            secretAccessKey: string;
            sessionToken?: string;
          } = {
            accessKeyId: awsCredentials.accessKeyId,
            secretAccessKey: awsCredentials.secretAccessKey,
          };
          if (awsCredentials.sessionToken) {
            creds.sessionToken = awsCredentials.sessionToken;
          }
          return creds;
        } catch (error) {
          this.log('error', 'scheduler.auth.credentials_error', {
            message: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        }
      },
    };

    const sigv4Interceptor = aws4Interceptor({
      options: {
        region: inferredRegion,
        service: inferredService,
      },
      // Use the adapter to provide credentials to aws4-axios
      credentials: credentialsAdapter,
    });

    // Add debug logging for SigV4 signing
    if (this.debug) {
      this.log('info', 'scheduler.sigv4.config', {
        region: inferredRegion,
        service: inferredService,
        baseURL: normalizedBaseURL,
        AWS_REGION: process.env.AWS_REGION,
        AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
        isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
      });
    }

    this.client.interceptors.request.use(sigv4Interceptor);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(async (fn: () => Promise<unknown>) => fn(), {
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
      name: 'ContentSchedulerClient',
      // Do not trip the breaker on client errors (non-429 4xx)
      errorFilter: (err: unknown) => {
        if (axios.isAxiosError(err) && err.response) {
          const status = err.response.status;
          // Treat <500 (except 429) as filtered (won't count as failure)
          return status < 500 && status !== 429;
        }
        return false;
      },
      ...this.config.circuitBreakerOptions,
    });

    // Circuit breaker event handlers
    this.setupCircuitBreakerEvents();
  }

  private parseScheduleResponseData(
    scheduleData: unknown,
    context: { path: string; status: number }
  ): Schedule {
    try {
      return ScheduleSchema.parse(scheduleData);
    } catch (parseError) {
      const size = this.safeSize(scheduleData);
      this.log('error', 'scheduler.response.parse_failed', {
        baseURL: this.config.baseURL,
        path: context.path,
        status: context.status,
        size,
        body: size < 2048 ? scheduleData : undefined,
        error: parseError instanceof Error ? parseError.message : String(parseError),
        zodErrors: parseError instanceof z.ZodError ? (parseError.issues as unknown[]) : undefined,
      });

      // If the response has scheduleId, try to return it anyway for backward compatibility
      if (scheduleData && typeof scheduleData === 'object' && 'scheduleId' in scheduleData) {
        this.log('warn', 'scheduler.response.schema_mismatch_with_id', {
          scheduleId: (scheduleData as { scheduleId: string }).scheduleId,
        });
        return scheduleData as Schedule;
      }

      // If the response doesn't have scheduleId, use the contentId as a fallback
      if (scheduleData && typeof scheduleData === 'object' && !('scheduleId' in scheduleData)) {
        const data = scheduleData as Record<string, unknown>;
        const fallbackId = (data.id as string) || (data.contentId as string) || randomUUID();
        this.log('warn', 'scheduler.response.schema_mismatch_without_id', {
          fallbackScheduleId: fallbackId,
        });
        return {
          ...data,
          scheduleId: fallbackId,
        } as Schedule;
      }

      throw parseError;
    }
  }

  /**
   * Create a ContentSchedulerClient with automatic URL resolution from SSM Parameter Store
   */
  static async create(
    config: Partial<ContentSchedulerConfig> = {}
  ): Promise<ContentSchedulerClient> {
    const finalConfig = { ...config };

    // Get URL from SSM Parameter Store if not provided using centralized parameter manager
    if (!finalConfig.baseURL) {
      try {
        const parameterManager = new ParameterManager(process.env.AWS_REGION || 'us-east-1');
        const environment = getCurrentEnvironment();

        finalConfig.baseURL = await parameterManager.getServiceUrl(
          'CONTENT_SCHEDULER_URL',
          environment
        );
        baseLogger.info('Content Scheduler URL retrieved from SSM', {
          baseURL: finalConfig.baseURL,
          source: 'ssm',
        });
      } catch (ssmError) {
        baseLogger.warn('Content Scheduler SSM lookup failed, trying fallback URLs', {
          error: ssmError instanceof Error ? ssmError.message : String(ssmError),
        });

        // Fall back to environment variable
        const fallbackUrl =
          process.env.CONTENT_SCHEDULER_FUNCTION_URL ||
          process.env.SCHEDULER_API_URL ||
          process.env.CONTENT_SCHEDULER_URL;
        if (fallbackUrl) {
          finalConfig.baseURL = fallbackUrl;
          baseLogger.warn('Using Content Scheduler fallback URL', { baseURL: fallbackUrl });
        } else {
          baseLogger.error('Content Scheduler URL not found in SSM or environment variables');
          throw new Error('Unable to resolve Content Scheduler service URL');
        }
      }
    }

    // Ensure baseURL is provided
    if (!finalConfig.baseURL) {
      throw new Error('baseURL is required for ContentSchedulerClient');
    }

    return new ContentSchedulerClient(finalConfig as ContentSchedulerConfig);
  }

  // ==================== Public Methods ====================

  /**
   * Create a new schedule
   */
  async createSchedule(data: CreateScheduleInput): Promise<Schedule> {
    return this.executeWithCircuitBreaker(async () => {
      // Validate input
      const validatedData = CreateScheduleInputSchema.parse(data);

      // NOTE: Do NOT prefix with leading slash. Axios treats a URL starting with '/' as
      // absolute (replacing the baseURL path). We need to preserve the API stage (e.g. /dev)
      // contained in baseURL. Using 'schedules' ensures the request becomes `${baseURL}/schedules`.
      const response = await this.retryWithBackoff(() =>
        this.client.post('schedules', validatedData)
      );

      // Log the raw response for debugging
      if (this.debug) {
        const size = this.safeSize(response.data);
        this.log('info', 'scheduler.http.create.response', {
          status: response.status,
          size,
          body: size < 2048 ? response.data : undefined,
        });
      }

      // Unwrap response: Lambda returns {success: true, data: schedule, timestamp}
      const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
      const scheduleData = responseBody.data;

      return this.parseScheduleResponseData(scheduleData, {
        path: 'schedules',
        status: response.status,
      });
    });
  }

  /**
   * Publish immediately (no EventBridge schedule creation).
   *
   * Creates/updates a schedule record and emits schedule.due right away.
   */
  async publishNow(data: PublishNowInput): Promise<Schedule> {
    return this.executeWithCircuitBreaker(async () => {
      const validatedData = PublishNowInputSchema.parse(data);

      const response = await this.retryWithBackoff(() =>
        this.client.post('schedules/publish-now', validatedData)
      );

      if (this.debug) {
        const size = this.safeSize(response.data);
        this.log('info', 'scheduler.http.publishNow.response', {
          status: response.status,
          size,
          body: size < 2048 ? response.data : undefined,
        });
      }

      const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
      return this.parseScheduleResponseData(responseBody.data, {
        path: 'schedules/publish-now',
        status: response.status,
      });
    });
  }

  /**
   * Update an existing schedule
   */
  async updateSchedule(id: string, data: UpdateScheduleInput): Promise<Schedule> {
    return this.executeWithCircuitBreaker(async () => {
      // Validate input
      const validatedData = UpdateScheduleInputSchema.parse(data);

      // Preserve stage path by omitting leading slash
      // Note: API Gateway only supports PUT for updates, not PATCH
      const response = await this.retryWithBackoff(() =>
        this.client.put(`schedules/${id}`, validatedData)
      );

      // Unwrap response: Lambda returns {success: true, data: schedule, timestamp}
      const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
      return this.parseScheduleResponseData(responseBody.data, {
        path: `schedules/${id}`,
        status: response.status,
      });
    });
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(id: string, options?: { userId?: string }): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      const headers: Record<string, string> = {};
      const userId = options?.userId && options.userId.trim().length ? options.userId.trim() : null;
      if (userId) headers['X-User-Context'] = userId;

      await this.retryWithBackoff(() =>
        this.client.delete(`schedules/${id}`, Object.keys(headers).length ? { headers } : undefined)
      );
    });
  }

  /**
   * Get a specific schedule with caching
   */
  async getSchedule(id: string): Promise<Schedule> {
    const cacheKey = `GET:schedules/${id}`; // match path without leading slash
    const cached = this.getCachedResponse(cacheKey);

    if (cached) {
      return cached as Schedule;
    }

    return this.executeWithCircuitBreaker(async () => {
      const response = await this.retryWithBackoff(() => this.client.get(`schedules/${id}`));

      // Unwrap response: Lambda returns {success: true, data: schedule, timestamp}
      const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
      const result = ScheduleSchema.parse(responseBody.data);
      this.setCachedResponse(cacheKey, result, response.headers.etag);
      return result;
    });
  }

  /**
   * List schedules with filters
   */
  async listSchedules(params: ListSchedulesParams = { limit: 20 }): Promise<ScheduleList> {
    return this.executeWithCircuitBreaker(async () => {
      // Validate parameters
      const validatedParams = ListSchedulesParamsSchema.parse(params);

      // Make API call
      const response = await this.retryWithBackoff(() =>
        this.client.get('schedules', { params: validatedParams })
      );

      // Unwrap response: Lambda returns {success: true, data: {schedules, pagination}, timestamp}
      const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
      return ScheduleListSchema.parse(responseBody.data);
    });
  }

  /**
   * Cancel a scheduled post
   */
  async cancelSchedule(id: string): Promise<Schedule> {
    return this.updateSchedule(id, { status: 'cancelled' });
  }

  /**
   * Reschedule a post to a new time
   * Note: API Gateway requires all required fields even for updates
   */
  async reschedule(
    id: string,
    newTime: Date,
    requiredFields: {
      brandId: string;
      contentId: string;
      userId: string; // Required for security validation
      platform?: string;
    }
  ): Promise<Schedule> {
    // For reschedule operations, API Gateway requires all fields
    const updateData: UpdateScheduleInput = {
      scheduledAt: newTime.toISOString(),
      status: 'scheduled',
      // Include required fields directly in the typed object
      brandId: requiredFields.brandId,
      contentId: requiredFields.contentId,
      userId: requiredFields.userId, // Always include for ownership validation
      platform: (requiredFields.platform as Platform) || 'instagram',
    };

    return this.updateSchedule(id, updateData);
  }

  /**
   * Get schedules for a specific brand
   */
  async getSchedulesByBrand(
    brandId: string,
    params: Omit<ListSchedulesParams, 'brandId'> = { limit: 20 }
  ): Promise<ScheduleList> {
    return this.listSchedules({ ...params, brandId });
  }

  /**
   * Get upcoming schedules
   */
  async getUpcomingSchedules(brandId: string, limit: number = 10): Promise<Schedule[]> {
    const now = new Date();
    const result = await this.listSchedules({
      brandId,
      status: 'scheduled', // Changed from 'pending' to match Lambda
      startTime: now.toISOString(),
      limit,
    });

    return result.schedules;
  }

  /**
   * Get scheduling statistics
   */
  async getSchedulingStats(brandId: string): Promise<{
    scheduled: number;
    published: number;
    failed: number;
    cancelled: number;
    processing: number;
  }> {
    // Fetch counts for each status in parallel
    const statuses = [
      'scheduled',
      'published',
      'failed',
      'cancelled',
      'canceled',
      'processing',
    ] as const;
    type StatStatus = (typeof statuses)[number];

    const results = await Promise.all(
      statuses.map((status) =>
        this.listSchedules({
          brandId,
          status,
          limit: 1, // We only need the total count
        })
      )
    );

    // Build stats object from parallel results
    const stats: Record<StatStatus, number> = {
      scheduled: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
      canceled: 0,
      processing: 0,
    };

    statuses.forEach((status, index) => {
      const result = results[index];
      stats[status] = result ? (result.total ?? 0) : 0;
    });

    return {
      scheduled: stats.scheduled,
      published: stats.published,
      failed: stats.failed,
      cancelled: stats.cancelled + stats.canceled,
      processing: stats.processing,
    };
  }

  // ==================== Private Methods ====================

  /**
   * Execute function with circuit breaker protection
   */
  private async executeWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return (await this.circuitBreaker.fire(fn)) as T;
    } catch (error) {
      // Map opossum (circuit breaker) error codes properly
      const code = (error as { code?: string } | undefined)?.code;

      if (code === 'EOPENBREAKER') {
        throw new SchedulerError(
          'Scheduler service is temporarily unavailable due to repeated failures',
          'CIRCUIT_BREAKER_OPEN',
          503,
          {
            message: 'Circuit breaker is open. Service will retry after cooldown period.',
            stats: this.getCircuitBreakerStats(),
          }
        );
      }

      if (code === 'ETIMEDOUT') {
        throw new SchedulerError('Request to scheduler service timed out', 'TIMEOUT', 504, {
          timeout: this.config.timeout,
          message: error instanceof Error && error.message ? error.message : 'Operation timed out',
        });
      }

      if (code === 'ESEMLOCKED') {
        // Concurrency limit reached for the breaker; treat as retryable/service busy
        throw new SchedulerError(
          'Scheduler service is busy. Please retry shortly.',
          'SERVICE_BUSY',
          429,
          { stats: this.getCircuitBreakerStats() }
        );
      }

      // Handle known error types
      if (error instanceof SchedulerError) {
        throw error;
      }

      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid data format', {
          errors: error.issues,
        });
      }

      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error);
      }

      // Log unexpected errors for debugging
      this.log('error', 'scheduler.circuit.unexpected_error', this.summarizeError(error));

      throw new SchedulerError(
        'Unexpected error occurred in scheduler client',
        'UNKNOWN_ERROR',
        500,
        {
          originalError: error instanceof Error ? error.message : String(error),
          circuitBreakerState: this.circuitBreaker.opened ? 'open' : 'closed',
        }
      );
    }
  }

  /**
   * Retry logic with exponential backoff
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>, attempt: number = 0): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= (this.config.maxRetries || 3)) {
        if (this.debug) {
          this.log('warn', 'scheduler.retry.maxAttemptsReached', {
            attempts: attempt + 1,
            error: this.summarizeError(error),
          });
        }
        throw error;
      }

      // Check if error is retryable
      if (this.isRetryableError(error)) {
        const delay = this.calculateBackoffDelay(attempt);
        if (this.debug) {
          this.log('info', 'scheduler.retry.backoff', {
            attempt: attempt + 1,
            delayMs: delay,
            error: this.summarizeError(error),
          });
        }
        await this.sleep(delay);
        return this.retryWithBackoff(fn, attempt + 1);
      }

      if (this.debug) {
        this.log('info', 'scheduler.retry.nonRetryable', {
          attempt: attempt + 1,
          error: this.summarizeError(error),
        });
      }
      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.config.retryDelay || 1000;
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (axios.isAxiosError(error)) {
      // Retry on network errors
      if (!error.response) {
        return true;
      }

      // Retry on specific status codes
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      return retryableStatuses.includes(error.response.status);
    }

    return false;
  }

  /**
   * Handle Axios errors and convert to custom errors
   */
  private handleAxiosError(error: AxiosError): SchedulerError {
    if (!error.response) {
      if (this.debug) {
        this.log('error', 'scheduler.http.networkError', {
          message: error.message,
          code: error.code,
          isAxiosError: true,
        });
      }
      return new NetworkError('Network error occurred', {
        code: error.code,
        message: error.message,
      });
    }

    const { status, data } = error.response;

    if (status === 429) {
      const retryAfter = error.response.headers['retry-after'];
      return new RateLimitError(
        'Rate limit exceeded',
        retryAfter ? parseInt(retryAfter) : undefined
      );
    }

    if (status === 400) {
      return new ValidationError('Invalid request', data as ErrorDetails);
    }

    if (status === 401) {
      return new SchedulerError('Unauthorized', 'UNAUTHORIZED', 401);
    }

    if (status === 403) {
      if (this.debug) {
        this.log('warn', 'scheduler.http.forbidden', {
          status,
          data,
          baseURL: this.config.baseURL,
          fullUrl: this.composeFullUrl(this.config.baseURL, error.config?.url || ''),
          region: this.region,
          hint:
            data &&
            typeof data === 'object' &&
            (data as { message?: string }).message === 'Missing Authentication Token'
              ? 'Check that the request path preserves the API stage (e.g. /dev). Leading slashes on axios request URLs can strip the stage.'
              : undefined,
        });
      }
      return new SchedulerError('Forbidden', 'FORBIDDEN', 403);
    }

    if (status === 404) {
      return new SchedulerError('Resource not found', 'NOT_FOUND', 404);
    }

    if (status >= 500) {
      return new SchedulerError(
        'Server error occurred',
        'SERVER_ERROR',
        status,
        data as ErrorDetails
      );
    }

    return new SchedulerError('Request failed', 'REQUEST_FAILED', status, data as ErrorDetails);
  }

  /**
   * Setup Axios interceptors with AWS SigV4 signing
   */
  private setupInterceptors(): void {
    // Request interceptor for adding custom headers and distributed tracing
    this.client.interceptors.request.use(
      (config) => {
        config.headers = config.headers || {};
        const headers = config.headers as Record<string, unknown>;

        // Reuse meta id if created earlier; otherwise generate
        const meta = (config as RequestWithMeta).__meta || {
          id: this.generateRequestId(),
          start: Date.now(),
          attempt: 0,
        };
        const requestId = meta.id;

        // Add request ID for tracing
        headers['X-Request-ID'] = requestId;

        // Add timestamp
        headers['X-Request-Timestamp'] = new Date().toISOString();

        // Add distributed tracing headers (AWS X-Ray compatible)
        headers['X-Amzn-Trace-Id'] =
          `Root=1-${Math.floor(Date.now() / 1000).toString(16)}-${requestId.replace(/-/g, '').substring(0, 24)}`;

        // Add caller context for better debugging
        headers['X-Caller-Service'] = 'postolio-backend';
        headers['X-Caller-Version'] = process.env.APP_VERSION || '1.0.0';

        // Add user context if available (required for IAM-authenticated scheduler)
        const userContext = this.resolveUserContext(config);
        if (userContext) {
          headers['X-User-Context'] = userContext;
        }

        if (this.debug) {
          const fullUrl = this.composeFullUrl(
            config.baseURL || this.config.baseURL,
            config.url || ''
          );

          // Log Authorization header to verify SigV4 signing
          const hasAuth = !!(headers['Authorization'] || headers['authorization']);
          if (!hasAuth && (config.method || 'get').toUpperCase() !== 'OPTIONS') {
            this.log('warn', 'scheduler.auth.no_authorization_header', {
              url: config.url,
              fullUrl,
              headers: Object.keys(config.headers || {}),
            });
          }

          this.log('info', 'scheduler.http.request', {
            id: requestId,
            method: (config.method || 'get').toUpperCase(),
            url: config.url,
            baseURL: config.baseURL || this.config.baseURL,
            fullUrl,
            region: this.region,
            timeout: config.timeout,
            attempt: meta.attempt + 1,
          });
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        if (this.debug) {
          const meta = (response.config as RequestWithMeta).__meta;
          const duration = meta ? Date.now() - meta.start : undefined;
          this.log('info', 'scheduler.http.response', {
            id: meta?.id,
            method: (response.config.method || 'get').toUpperCase(),
            url: response.config.url,
            status: response.status,
            durationMs: duration,
            size: this.safeSize(response.data),
          });
        }
        return response;
      },
      (error) => {
        if (this.debug) {
          const cfg = error.config || {};
          const meta = (cfg as RequestWithMeta).__meta;
          const duration = meta ? Date.now() - meta.start : undefined;

          // Special handling for authentication errors
          if (
            error.response?.status === 403 &&
            error.response?.data?.message === 'Missing Authentication Token'
          ) {
            this.log('error', 'scheduler.auth.missing_auth_token', {
              url: cfg.url,
              baseURL: cfg.baseURL,
              fullURL: this.composeFullUrl(cfg.baseURL || this.config.baseURL, cfg.url || ''),
              headers: cfg.headers,
              AWS_REGION: process.env.AWS_REGION,
              isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
              errorData: error.response?.data,
            });
          }

          this.log('error', 'scheduler.http.error', {
            id: meta?.id,
            method: (cfg.method || 'get').toUpperCase(),
            url: cfg.url,
            status: error.response?.status,
            durationMs: duration,
            data: error.response?.data,
            message: error.message,
          });
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Setup circuit breaker event handlers
   */
  private setupCircuitBreakerEvents(): void {
    this.circuitBreaker.on('open', () => {
      this.log('warn', 'scheduler.circuit.open', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats,
      });
    });

    this.circuitBreaker.on('halfOpen', () => {
      this.log('info', 'scheduler.circuit.half_open', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats,
      });
    });

    this.circuitBreaker.on('close', () => {
      this.log('info', 'scheduler.circuit.close', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats,
      });
    });

    this.circuitBreaker.on('timeout', () => {
      this.log('error', 'scheduler.circuit.timeout', {
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats,
      });
    });

    this.circuitBreaker.on('failure', (error: Error) => {
      this.log('error', 'scheduler.circuit.failure', {
        baseURL: this.config.baseURL,
        error: error.message,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats,
      });
    });

    this.circuitBreaker.on('success', () => {
      if (process.env.NODE_ENV === 'dev') {
        this.log('debug', 'scheduler.circuit.success', {
          baseURL: this.config.baseURL,
          timestamp: new Date().toISOString(),
          stats: this.circuitBreaker.stats,
        });
      }
    });
  }

  /**
   * Resolve end-user context for IAM-authenticated scheduler calls.
   * Falls back to payload/params when config.userId is not set.
   */
  private resolveUserContext(config: AxiosRequestConfig): string | undefined {
    const headers = (config.headers || {}) as Record<string, unknown>;
    const headerUser =
      (headers['X-User-Context'] as string | undefined) ||
      (headers['x-user-context'] as string | undefined) ||
      (headers['X-User-Id'] as string | undefined) ||
      (headers['x-user-id'] as string | undefined) ||
      (headers['User-Id'] as string | undefined) ||
      (headers['user-id'] as string | undefined);
    if (headerUser && headerUser.trim()) {
      return headerUser.trim();
    }

    const payload = config.data as Record<string, unknown> | undefined;
    const payloadUser = payload?.userId;
    if (typeof payloadUser === 'string' && payloadUser.trim()) {
      return payloadUser.trim();
    }

    const paramsUser =
      config.params && typeof (config.params as { userId?: unknown }).userId === 'string'
        ? ((config.params as { userId?: string }).userId as string)
        : undefined;
    if (paramsUser && paramsUser.trim()) {
      return paramsUser.trim();
    }

    return this.config.userId?.trim();
  }

  /**
   * Generate unique request ID - hex-only format for AWS compatibility
   */
  private generateRequestId(): string {
    // Generate hex-only request ID for AWS EventBridge compatibility
    const timestamp = Date.now().toString(16).toUpperCase();
    const randomHex = randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase();
    return `${timestamp}${randomHex}`;
  }

  /** Log helper */
  private log(
    level: 'info' | 'warn' | 'error' | 'debug',
    event: string,
    details: ErrorDetails
  ): void {
    const message = String(event);
    if (level === 'error') this.logger.error(message, details);
    else if (level === 'warn') this.logger.warn(message, details);
    else if (level === 'debug') this.logger.debug(message, details);
    else this.logger.info(message, details);
  }

  private summarizeError(err: unknown): Record<string, unknown> {
    if (!err) return { type: 'unknown' };
    if (axios.isAxiosError(err)) {
      return {
        type: 'AxiosError',
        message: err.message,
        code: err.code,
        status: err.response?.status,
        data:
          err.response?.data && this.safeSize(err.response.data) < 2048
            ? err.response.data
            : undefined,
      };
    }
    if (err instanceof Error) return { type: err.name, message: err.message };
    return { type: typeof err, value: String(err) };
  }

  private composeFullUrl(base: string, path: string): string {
    if (!base.endsWith('/') && !path.startsWith('/')) return base + '/' + path;
    if (base.endsWith('/') && path.startsWith('/')) return base + path.substring(1);
    return base + path;
  }

  private safeSize(data: unknown): number {
    try {
      if (data == null) return 0;
      if (typeof data === 'string') return data.length;
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== Health Check ====================

  /**
   * Check if the scheduler service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('health', {
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Get circuit breaker stats
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.stats;
  }

  /**
   * Get cached response if valid
   */
  private getCachedResponse(key: string): CacheValue | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check if cache is still valid (5 minutes TTL)
    const now = Date.now();
    if (now - cached.timestamp > 5 * 60 * 1000) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cached response
   */
  private setCachedResponse(key: string, data: CacheValue, etag?: string): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ...(etag ? { etag } : {}),
    });

    // Limit cache size to prevent memory issues
    const MAX_CACHE_SIZE = 100;
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Use iterator for efficient cache eviction (O(n) where n = items to delete, not total cache size)
      const iterator = this.cache.keys();
      const itemsToDelete = this.cache.size - MAX_CACHE_SIZE + 1;
      for (let i = 0; i < itemsToDelete; i++) {
        const { value: key, done } = iterator.next();
        if (!done && key !== undefined) {
          this.cache.delete(key);
        }
      }
    }
  }
}

// ==================== Factory Function ====================

/**
 * Create a new ContentSchedulerClient instance
 */
export function createSchedulerClient(config: ContentSchedulerConfig): ContentSchedulerClient {
  return new ContentSchedulerClient(config);
}

// ==================== Default Export ====================

export default ContentSchedulerClient;
