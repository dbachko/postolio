/**
 * Content Scheduler Client SDK
 * Provides type-safe integration with AWS Content Scheduler microservice
 */

import { z } from 'zod';
import axios, { AxiosInstance, AxiosError } from 'axios';
import CircuitBreaker from 'opossum';

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
  circuitBreakerOptions?: CircuitBreaker.Options;
}

// ==================== Main Client Class ====================

export class ContentSchedulerClient {
  private client: AxiosInstance;
  private circuitBreaker: CircuitBreaker;
  private config: ContentSchedulerConfig;

  constructor(config: ContentSchedulerConfig) {
    this.config = {
      timeout: 10000,
      maxRetries: 3,
      retryDelay: 1000,
      ...config,
    };

    // Initialize Axios client
    this.client = axios.create({
      baseURL: this.config.baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey && { 'X-API-Key': this.config.apiKey }),
      },
    });

    // Add request/response interceptors
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
   * Get a specific schedule
   */
  async getSchedule(id: string): Promise<Schedule> {
    return this.executeWithCircuitBreaker(async () => {
      const response = await this.retryWithBackoff(
        () => this.client.get(`/schedules/${id}`)
      );
      
      return ScheduleSchema.parse(response.data);
    });
  }

  /**
   * List schedules with filters
   */
  async listSchedules(params: ListSchedulesParams = {}): Promise<ScheduleList> {
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
    params: Omit<ListSchedulesParams, 'brandId'> = {}
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
  }> {
    const stats = {
      pending: 0,
      published: 0,
      failed: 0,
      cancelled: 0,
    };

    // Fetch counts for each status
    const statuses: ScheduleStatus[] = ['pending', 'published', 'failed', 'cancelled'];
    
    for (const status of statuses) {
      const result = await this.listSchedules({
        brandId,
        status,
        limit: 1, // We only need the total count
      });
      stats[status] = result.total;
    }

    return stats;
  }

  // ==================== Private Methods ====================

  /**
   * Execute function with circuit breaker protection
   */
  private async executeWithCircuitBreaker<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.circuitBreaker.fire(fn);
    } catch (error) {
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

      throw new SchedulerError(
        'Unexpected error occurred',
        'UNKNOWN_ERROR',
        500,
        { originalError: error }
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
   * Setup Axios interceptors
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        // Add request ID for tracing
        config.headers['X-Request-ID'] = this.generateRequestId();
        
        // Add timestamp
        config.headers['X-Request-Timestamp'] = new Date().toISOString();
        
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
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
      console.warn('Circuit breaker opened - requests will fail fast');
    });

    this.circuitBreaker.on('halfOpen', () => {
      console.info('Circuit breaker half-open - testing service availability');
    });

    this.circuitBreaker.on('close', () => {
      console.info('Circuit breaker closed - service recovered');
    });

    this.circuitBreaker.on('timeout', () => {
      console.error('Circuit breaker timeout');
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
  getCircuitBreakerStats(): CircuitBreaker.Stats {
    return this.circuitBreaker.stats;
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