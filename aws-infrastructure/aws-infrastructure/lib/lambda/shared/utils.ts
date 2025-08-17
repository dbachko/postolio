import { APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 'content-scheduler' });

// Error handling
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown): APIGatewayProxyResult {
  if (error instanceof ApiError) {
    logger.warn('API error', { 
      code: error.code, 
      statusCode: error.statusCode,
      context: error.context 
    });
    
    return {
      statusCode: error.statusCode,
      body: JSON.stringify({
        error: error.code,
        message: error.message,
        ...(error.context && { context: error.context })
      })
    };
  }
  
  // Log unexpected errors but don't expose details
  logger.error('Unexpected error', error as Error);
  
  return {
    statusCode: 500,
    body: JSON.stringify({ 
      error: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred' 
    })
  };
}

// CORS headers helper
export function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...response.headers,
    },
  };
}

// DynamoDB key helpers
export const DynamoKeys = {
  scheduleKey: (scheduleId: string) => ({
    pk: `SCHEDULE#${scheduleId}`,
    sk: 'METADATA'
  }),
  brandKey: (brandId: string) => `BRAND#${brandId}`,
  auditKey: (scheduleId: string, action: string) => ({
    pk: `AUDIT#${scheduleId}`,
    sk: `${Date.now()}#${action}`
  })
} as const;

// Error codes
export const ErrorCodes = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SCHEDULE_NOT_FOUND: 'SCHEDULE_NOT_FOUND',
  PLATFORM_ERROR: 'PLATFORM_ERROR',
  INVALID_JSON: 'INVALID_JSON',
  MISSING_BODY: 'MISSING_BODY',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
} as const;

// Input validation
export function safeJsonParse(body: string | null | undefined): unknown {
  if (!body?.trim()) {
    throw new ApiError(400, ErrorCodes.MISSING_BODY, 'Request body is required');
  }
  
  try {
    return JSON.parse(body);
  } catch {
    throw new ApiError(400, ErrorCodes.INVALID_JSON, 'Request body must be valid JSON');
  }
}

// Environment variable validation
export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

// Circuit breaker implementation
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private isOpen = false;
  private readonly threshold: number;
  private readonly resetTimeout: number;
  
  constructor(threshold = 3, resetTimeoutMs = 60000) {
    this.threshold = threshold;
    this.resetTimeout = resetTimeoutMs;
  }
  
  async execute<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    // Check if circuit should be reset
    if (this.isOpen && Date.now() - this.lastFailureTime > this.resetTimeout) {
      this.isOpen = false;
      this.failures = 0;
      logger.info('Circuit breaker reset');
    }
    
    // If circuit is open, use fallback or throw
    if (this.isOpen) {
      if (fallback) {
        return fallback();
      }
      throw new ApiError(503, ErrorCodes.RATE_LIMITED, 'Service temporarily unavailable');
    }
    
    try {
      const result = await fn();
      this.failures = 0; // Reset on success
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.isOpen = true;
        logger.warn('Circuit breaker opened', { failures: this.failures });
      }
      
      throw error;
    }
  }
  
  get state(): 'open' | 'closed' {
    return this.isOpen ? 'open' : 'closed';
  }
}

// Exponential backoff utility
export function calculateBackoff(attempt: number, baseDelayMs = 1000, maxDelayMs = 300000): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = Math.random() * 0.3 * delay; // Add 0-30% jitter
  return Math.floor(delay + jitter);
}

// Validation utilities
export function validatePlatform(platform: string): void {
  const validPlatforms = ['instagram', 'facebook', 'twitter', 'linkedin', 'youtube'];
  if (!validPlatforms.includes(platform)) {
    throw new ApiError(
      400,
      ErrorCodes.VALIDATION_FAILED,
      `Invalid platform: ${platform}`,
      { validPlatforms }
    );
  }
}

export function validateFutureDate(dateString: string): Date {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new ApiError(
      400,
      ErrorCodes.VALIDATION_FAILED,
      'Invalid date format. Use ISO 8601 format'
    );
  }
  
  if (date <= new Date()) {
    throw new ApiError(
      400,
      ErrorCodes.VALIDATION_FAILED,
      'Scheduled date must be in the future'
    );
  }
  
  return date;
}

// Platform-specific caption limits
export const PLATFORM_LIMITS = {
  instagram: { caption: 2200, hashtags: 30 },
  facebook: { caption: 63206, hashtags: 100 },
  twitter: { caption: 280, hashtags: 10 },
  linkedin: { caption: 3000, hashtags: 30 },
  youtube: { caption: 5000, hashtags: 15 },
} as const;

export function validateCaption(platform: string, caption: string): void {
  const limit = PLATFORM_LIMITS[platform as keyof typeof PLATFORM_LIMITS]?.caption || 2200;
  if (caption.length > limit) {
    throw new ApiError(
      400,
      ErrorCodes.VALIDATION_FAILED,
      `Caption exceeds ${limit} character limit for ${platform}`
    );
  }
}