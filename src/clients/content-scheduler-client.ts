/**
 * Content Scheduler Client SDK
 * Provides type-safe integration with AWS Content Scheduler microservice
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import * as https from 'https';
import CircuitBreaker from 'opossum';
import type { Options as CircuitBreakerOptions } from 'opossum';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { getServiceDiscovery, SERVICES } from '../utils/service-discovery-client.js';

// ==================== Validation Schemas ====================

const PlatformSchema = z.enum(['instagram', 'facebook', 'twitter', 'linkedin', 'youtube']);
const ScheduleStatusSchema = z.enum(['scheduled', 'processing', 'published', 'failed', 'cancelled']);
const ContentTypeSchema = z.enum(['image', 'video', 'carousel', 'reel', 'story']);

// Schema that matches Lambda's expected format
const CreateScheduleInputSchema = z.object({
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string().optional(),
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(), // Changed from scheduledTime to scheduledAt
  contentType: ContentTypeSchema.optional(),
  videoUrl: z.string().url().optional(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  mediaUrls: z.array(z.string().url()).optional(), // Array of URLs for carousel/multiple images
  metadata: z.record(z.unknown()).optional(),
});

const UpdateScheduleInputSchema = z.object({
  scheduledAt: z.string().datetime().optional(), // Changed from scheduledTime
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  mediaUrls: z.array(z.string().url()).optional(),
  status: ScheduleStatusSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Response schema from Lambda
const ScheduleSchema = z.object({
  scheduleId: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string().optional(),
  platform: PlatformSchema,
  scheduledAt: z.string().datetime(),
  contentType: ContentTypeSchema,
  videoUrl: z.string().url().optional(),
  caption: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
  mediaUrls: z.array(z.string().url()).optional(),
  status: ScheduleStatusSchema,
  retryCount: z.number().default(0),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  publishedAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
});

const ScheduleListSchema = z.object({
  schedules: z.array(ScheduleSchema),
  nextToken: z.string().optional(),
  total: z.number(),
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
export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleList = z.infer<typeof ScheduleListSchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleInputSchema>;
export type ListSchedulesParams = z.infer<typeof ListSchedulesParamsSchema>;

// ==================== Error Classes ====================

export class SchedulerError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'SchedulerError';
  }
}

export class ValidationError extends SchedulerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class NetworkError extends SchedulerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'NETWORK_ERROR', 0, details);
  }
}

export class RateLimitError extends SchedulerError {
  constructor(message: string, retryAfter?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, { retryAfter });
  }
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
  private circuitBreaker: any; // CircuitBreaker instance
  private config: ContentSchedulerConfig;
  private cache: Map<string, { data: any; timestamp: number; etag?: string }>;
  private debug: boolean;
  private region: string;

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

    // Infer AWS region from execute-api hostname if possible (fallback to env or us-east-1)
  const inferredRegion: string = (() => {
      try {
        const host = new URL(normalizedBaseURL).hostname;
        const match = host.match(/execute-api\.([a-z0-9-]+)\.amazonaws\.com$/);
        if (match && match[1]) return match[1];
      } catch { /* ignore parse errors */ }
      return process.env.AWS_REGION || 'us-east-1';
    })();
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
        delete (req.headers as any)['Host'];
        delete (req.headers as any)['host'];
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
      (req as any).__meta = {
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
          const creds: any = {
            accessKeyId: awsCredentials.accessKeyId,
            secretAccessKey: awsCredentials.secretAccessKey,
          };
          if (awsCredentials.sessionToken) {
            creds.sessionToken = awsCredentials.sessionToken;
          }
          return creds;
        } catch (error) {
          console.error('[ContentSchedulerClient] Failed to get AWS credentials:', error);
          return undefined;
        }
      }
    };
    
    const sigv4Interceptor = aws4Interceptor({
      options: {
        region: inferredRegion,
        service: 'execute-api',
      },
      // Use the adapter to provide credentials to aws4-axios
      credentials: credentialsAdapter,
    });
    
    // Add debug logging for SigV4 signing
    if (this.debug) {
      console.log('[ContentSchedulerClient] Configuring SigV4 signing:', JSON.stringify({
        region: inferredRegion,
        service: 'execute-api',
        baseURL: normalizedBaseURL,
        AWS_REGION: process.env.AWS_REGION,
        AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
        // Check if we're running in ECS by looking for task metadata endpoint
        isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
      }));
    }
    
    this.client.interceptors.request.use(sigv4Interceptor);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      async (fn: () => Promise<any>) => fn(),
      {
        timeout: 30000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
        name: 'ContentSchedulerClient',
        ...this.config.circuitBreakerOptions,
      }
    );

    // Circuit breaker event handlers
    this.setupCircuitBreakerEvents();
  }

  /**
   * Create a ContentSchedulerClient with automatic service discovery
   */
  static async create(config: Partial<ContentSchedulerConfig> = {}): Promise<ContentSchedulerClient> {
    const finalConfig = { ...config };
    
    // Use service discovery if enabled and no baseURL provided
    if (process.env.SERVICE_DISCOVERY_ENABLED === 'true' && !finalConfig.baseURL) {
      try {
        const discovery = getServiceDiscovery();
        const schedulerUrl = await discovery.getServiceUrl(SERVICES.CONTENT_SCHEDULER);
        finalConfig.baseURL = schedulerUrl;
        console.log('✅ Content Scheduler discovered via Cloud Map:', finalConfig.baseURL);
      } catch {
        // Fall back to environment variable
        const fallbackUrl = process.env.SCHEDULER_API_URL || process.env.CONTENT_SCHEDULER_URL;
        if (fallbackUrl) {
          finalConfig.baseURL = fallbackUrl;
          console.warn('⚠️  Content Scheduler discovery failed, using fallback URL:', fallbackUrl);
        } else {
          console.error('❌ Content Scheduler discovery failed and no fallback URL available');
          throw new Error('Unable to discover Content Scheduler service URL');
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
      const response = await this.retryWithBackoff(
        () => this.client.post('schedules', validatedData)
      );
      
      // Validate and return response
      return ScheduleSchema.parse(response.data);
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
      const response = await this.retryWithBackoff(
        () => this.client.patch(`schedules/${id}`, validatedData)
      );
      
      // Validate and return response
      return ScheduleSchema.parse(response.data);
    });
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(id: string): Promise<void> {
    return this.executeWithCircuitBreaker(async () => {
      await this.retryWithBackoff(
        () => this.client.delete(`schedules/${id}`)
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
      return cached;
    }
    
    return this.executeWithCircuitBreaker(async () => {
      const response = await this.retryWithBackoff(
        () => this.client.get(`schedules/${id}`)
      );
      
      const result = ScheduleSchema.parse(response.data);
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
      const response = await this.retryWithBackoff(
        () => this.client.get('schedules', { params: validatedParams })
      );
      
      // Validate and return response
      return ScheduleListSchema.parse(response.data);
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
   */
  async reschedule(id: string, newTime: Date): Promise<Schedule> {
    return this.updateSchedule(id, { 
      scheduledAt: newTime.toISOString(),
      status: 'scheduled' 
    });
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
  async getUpcomingSchedules(
    brandId: string,
    limit: number = 10
  ): Promise<Schedule[]> {
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
    const statuses: ScheduleStatus[] = ['scheduled', 'published', 'failed', 'cancelled', 'processing'];
    
    const results = await Promise.all(
      statuses.map(status =>
        this.listSchedules({
          brandId,
          status,
          limit: 1, // We only need the total count
        })
      )
    );

    // Build stats object from parallel results
    const stats: Record<ScheduleStatus, number> = {
      scheduled: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
      processing: 0,
    };
    
    statuses.forEach((status, index) => {
      const result = results[index];
      stats[status] = result ? result.total : 0;
    });

    return stats;
  }

  // ==================== Private Methods ====================

  /**
   * Execute function with circuit breaker protection
   */
  private async executeWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.circuitBreaker.fire(fn) as T;
    } catch (error) {
      // Check if circuit breaker is open
      if (error && typeof error === 'object' && 'name' in error) {
        const errorObj = error as any;
        
        // Handle circuit breaker specific errors
        if (errorObj.name === 'OpenCircuitError') {
          throw new SchedulerError(
            'Scheduler service is temporarily unavailable due to repeated failures',
            'CIRCUIT_BREAKER_OPEN',
            503,
            { 
              message: 'Circuit breaker is open. Service will retry after cooldown period.',
              stats: this.getCircuitBreakerStats() 
            }
          );
        }
        
        if (errorObj.name === 'TimeoutError') {
          throw new SchedulerError(
            'Request to scheduler service timed out',
            'TIMEOUT',
            504,
            { 
              timeout: this.config.timeout,
              message: 'The operation took too long to complete'
            }
          );
        }
      }
      
      // Handle known error types
      if (error instanceof SchedulerError) {
        throw error;
      }
      
      if (error instanceof z.ZodError) {
        throw new ValidationError('Invalid data format', {
          errors: error.errors,
        });
      }

      if (axios.isAxiosError(error)) {
        throw this.handleAxiosError(error);
      }

      // Log unexpected errors for debugging
      console.error('Unexpected error in circuit breaker:', error);
      
      throw new SchedulerError(
        'Unexpected error occurred in scheduler client',
        'UNKNOWN_ERROR',
        500,
        { 
          originalError: error instanceof Error ? error.message : String(error),
          circuitBreakerState: this.circuitBreaker.opened ? 'open' : 'closed'
        }
      );
    }
  }

  /**
   * Retry logic with exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> {
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
  private isRetryableError(error: any): boolean {
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
      return new ValidationError('Invalid request', data as any);
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
          hint: data && (data as any).message === 'Missing Authentication Token'
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
        data as any
      );
    }

    return new SchedulerError(
      'Request failed',
      'REQUEST_FAILED',
      status,
      data as any
    );
  }

  /**
   * Setup Axios interceptors with AWS SigV4 signing
   */
  private setupInterceptors(): void {
    // Request interceptor for adding custom headers and distributed tracing
    this.client.interceptors.request.use(
      (config) => {
  // Reuse meta id if created earlier; otherwise generate
  const meta = (config as any).__meta || { id: this.generateRequestId(), start: Date.now(), attempt: 0 };
  const requestId = meta.id;
        
        // Add request ID for tracing
        config.headers['X-Request-ID'] = requestId;
        
        // Add timestamp
        config.headers['X-Request-Timestamp'] = new Date().toISOString();
        
        // Add distributed tracing headers (AWS X-Ray compatible)
        config.headers['X-Amzn-Trace-Id'] = `Root=1-${Math.floor(Date.now() / 1000).toString(16)}-${requestId.replace(/-/g, '').substring(0, 24)}`;
        
        // Add caller context for better debugging
        config.headers['X-Caller-Service'] = 'postolio-backend';
        config.headers['X-Caller-Version'] = process.env.APP_VERSION || '1.0.0';
        
        // Add user context if available
        if (this.config.userId) {
          config.headers['X-User-Context'] = this.config.userId;
        }
        
        if (this.debug) {
          const fullUrl = this.composeFullUrl(config.baseURL || this.config.baseURL, config.url || '');
          
          // Log Authorization header to verify SigV4 signing
          const hasAuth = !!(config.headers['Authorization'] || config.headers['authorization']);
          if (!hasAuth && (config.method || 'get').toUpperCase() !== 'OPTIONS') {
            console.warn('[ContentSchedulerClient] Warning: No Authorization header present before request', JSON.stringify({
              url: config.url,
              fullUrl,
              headers: Object.keys(config.headers || {}),
            }));
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
          const meta = (response.config as any).__meta;
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
          const meta = (cfg as any).__meta;
          const duration = meta ? Date.now() - meta.start : undefined;
          
          // Special handling for authentication errors
          if (error.response?.status === 403 && error.response?.data?.message === 'Missing Authentication Token') {
            console.error('[ContentSchedulerClient] Authentication Error - Missing or invalid SigV4 signature:', JSON.stringify({
              url: cfg.url,
              baseURL: cfg.baseURL,
              fullURL: this.composeFullUrl(cfg.baseURL || this.config.baseURL, cfg.url || ''),
              headers: cfg.headers,
              AWS_REGION: process.env.AWS_REGION,
              isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
              errorData: error.response?.data,
            }));
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
      console.warn('Circuit breaker opened - requests will fail fast', JSON.stringify({
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      }));
    });

    this.circuitBreaker.on('halfOpen', () => {
      console.info('Circuit breaker half-open - testing service availability', JSON.stringify({
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      }));
    });

    this.circuitBreaker.on('close', () => {
      console.info('Circuit breaker closed - service recovered', JSON.stringify({
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      }));
    });

    this.circuitBreaker.on('timeout', () => {
      console.error('Circuit breaker timeout', JSON.stringify({
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      }));
    });

    this.circuitBreaker.on('failure', (error: Error) => {
      console.error('Circuit breaker failure detected', JSON.stringify({
        baseURL: this.config.baseURL,
        error: error.message,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      }));
    });

    this.circuitBreaker.on('success', () => {
      // Only log on debug level to avoid spam
      if (process.env.NODE_ENV === 'development') {
        console.debug('Circuit breaker success', JSON.stringify({
          baseURL: this.config.baseURL,
          timestamp: new Date().toISOString(),
          stats: this.circuitBreaker.stats
        }));
      }
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${randomUUID()}`;
  }

  /** Log helper */
  private log(level: 'info' | 'warn' | 'error' | 'debug', event: string, details: Record<string, any>): void {
    // Simple structured logger; could later integrate with pino
    const payload = {
      level,
      time: new Date().toISOString(),
      event,
      ...details,
    };
    (console as any)[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(payload));
  }

  private summarizeError(err: any): Record<string, any> {
    if (!err) return { type: 'unknown' };
    if (axios.isAxiosError(err)) {
      return {
        type: 'AxiosError',
        message: err.message,
        code: err.code,
        status: err.response?.status,
        data: err.response?.data && this.safeSize(err.response.data) < 2048 ? err.response.data : undefined,
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

  private safeSize(data: any): number {
    try {
      if (data == null) return 0;
      if (typeof data === 'string') return data.length;
      return JSON.stringify(data).length;
    } catch { return 0; }
  }

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
  getCircuitBreakerStats(): any {
    return this.circuitBreaker.stats;
  }

  /**
   * Get cached response if valid
   */
  private getCachedResponse(key: string): any | null {
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
  private setCachedResponse(key: string, data: any, etag?: string): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ...(etag ? { etag } : {}),
    });
    
    // Limit cache size to prevent memory issues
    const MAX_CACHE_SIZE = 100;
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entries until we're back within limit
      const keysToDelete = Array.from(this.cache.keys()).slice(0, this.cache.size - MAX_CACHE_SIZE + 1);
      keysToDelete.forEach(key => this.cache.delete(key));
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
