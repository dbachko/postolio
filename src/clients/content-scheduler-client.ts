/**
 * Content Scheduler Client SDK
 * Provides type-safe integration with AWS Content Scheduler microservice
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { aws4Interceptor } from 'aws4-axios';
import * as https from 'https';
// Using require for opossum due to ESM/CommonJS compatibility issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CircuitBreaker = require('opossum');
import type { Options as CircuitBreakerOptions } from 'opossum';

// ==================== Validation Schemas ====================

const PlatformSchema = z.enum(['instagram', 'tiktok', 'youtube']);
const ScheduleStatusSchema = z.enum(['pending', 'processing', 'published', 'failed', 'cancelled']);

const ContentDataSchema = z.object({
  caption: z.string(),
  mediaUrl: z.string().url().optional(),
  hashtags: z.array(z.string()).optional(),
  mediaType: z.enum(['image', 'video', 'carousel']).optional(),
  thumbnailUrl: z.string().url().optional(),
});

const ScheduleSchema = z.object({
  id: z.string(),
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  scheduledTime: z.string().datetime(),
  content: ContentDataSchema,
  status: ScheduleStatusSchema,
  retryCount: z.number().default(0),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
  errorMessage: z.string().optional(),
});

const ScheduleListSchema = z.object({
  schedules: z.array(ScheduleSchema),
  nextToken: z.string().optional(),
  total: z.number(),
});

const CreateScheduleInputSchema = z.object({
  contentId: z.string(),
  brandId: z.string(),
  userId: z.string(),
  platform: PlatformSchema,
  scheduledTime: z.string().datetime(),
  content: ContentDataSchema,
  metadata: z.record(z.unknown()).optional(),
});

const UpdateScheduleInputSchema = z.object({
  scheduledTime: z.string().datetime().optional(),
  content: ContentDataSchema.optional(),
  status: ScheduleStatusSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
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
export type ContentData = z.infer<typeof ContentDataSchema>;
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
  apiKey?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  circuitBreakerOptions?: CircuitBreakerOptions;
  // User context for multi-tenant support
  userId?: string;
}

// ==================== Main Client Class ====================

export class ContentSchedulerClient {
  private client: AxiosInstance;
  private circuitBreaker: any; // CircuitBreaker instance
  private config: ContentSchedulerConfig;
  private cache: Map<string, { data: any; timestamp: number; etag?: string }>;

  constructor(config: ContentSchedulerConfig) {
    this.config = {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    // Initialize cache for response caching
    this.cache = new Map();

    // Initialize Axios client with connection keep-alive for better performance
    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
      },
      // Add HTTPS agent with keep-alive for persistent connections
      httpsAgent: new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
      }),
    });

    // Add AWS SigV4 signing interceptor
    const interceptor = aws4Interceptor({
      options: {
        region: process.env.AWS_REGION || 'us-east-1',
        service: 'execute-api',
      },
      // Let aws4-axios use the default credential provider chain
      // This will automatically use ECS task role credentials when running in ECS
    });
    
    this.client.interceptors.request.use(interceptor);

    // Add custom request/response interceptors for logging and request IDs
    this.setupInterceptors();

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

  // ==================== Public Methods ====================

  /**
   * Create a new schedule
   */
  async createSchedule(data: CreateScheduleInput): Promise<Schedule> {
    return this.executeWithCircuitBreaker(async () => {
      // Validate input
      const validatedData = CreateScheduleInputSchema.parse(data);
      
      // Make API call
      const response = await this.retryWithBackoff(
        () => this.client.post('/schedules', validatedData)
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
      
      // Make API call
      const response = await this.retryWithBackoff(
        () => this.client.patch(`/schedules/${id}`, validatedData)
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
        () => this.client.delete(`/schedules/${id}`)
      );
    });
  }

  /**
   * Get a specific schedule with caching
   */
  async getSchedule(id: string): Promise<Schedule> {
    const cacheKey = `GET:/schedules/${id}`;
    const cached = this.getCachedResponse(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    return this.executeWithCircuitBreaker(async () => {
      const response = await this.retryWithBackoff(
        () => this.client.get(`/schedules/${id}`)
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
        () => this.client.get('/schedules', { params: validatedParams })
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
      scheduledTime: newTime.toISOString(),
      status: 'pending' 
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
      status: 'pending',
      startTime: now.toISOString(),
      limit,
    });
    
    return result.schedules;
  }

  /**
   * Get scheduling statistics
   */
  async getSchedulingStats(brandId: string): Promise<{
    pending: number;
    published: number;
    failed: number;
    cancelled: number;
    processing: number;
  }> {
    // Fetch counts for each status in parallel
    const statuses: ScheduleStatus[] = ['pending', 'published', 'failed', 'cancelled', 'processing'];
    
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
      pending: 0,
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
        throw error;
      }

      // Check if error is retryable
      if (this.isRetryableError(error)) {
        const delay = this.calculateBackoffDelay(attempt);
        await this.sleep(delay);
        return this.retryWithBackoff(fn, attempt + 1);
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
        const requestId = this.generateRequestId();
        
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
        
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        // Log error for debugging
        console.error('Scheduler API error:', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data,
        });
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Setup circuit breaker event handlers
   */
  private setupCircuitBreakerEvents(): void {
    this.circuitBreaker.on('open', () => {
      console.warn('Circuit breaker opened - requests will fail fast', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      });
    });

    this.circuitBreaker.on('halfOpen', () => {
      console.info('Circuit breaker half-open - testing service availability', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      });
    });

    this.circuitBreaker.on('close', () => {
      console.info('Circuit breaker closed - service recovered', {
        baseURL: this.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      });
    });

    this.circuitBreaker.on('timeout', () => {
      console.error('Circuit breaker timeout', {
        baseURL: this.config.baseURL,
        timeout: this.config.timeout,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      });
    });

    this.circuitBreaker.on('failure', (error: Error) => {
      console.error('Circuit breaker failure detected', {
        baseURL: this.config.baseURL,
        error: error.message,
        timestamp: new Date().toISOString(),
        stats: this.circuitBreaker.stats
      });
    });

    this.circuitBreaker.on('success', () => {
      // Only log on debug level to avoid spam
      if (process.env.NODE_ENV === 'development') {
        console.debug('Circuit breaker success', {
          baseURL: this.config.baseURL,
          timestamp: new Date().toISOString(),
          stats: this.circuitBreaker.stats
        });
      }
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${randomUUID()}`;
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
      const response = await this.client.get('/health', {
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
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
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