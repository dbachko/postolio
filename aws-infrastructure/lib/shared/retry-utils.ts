/**
 * Retry utilities with exponential backoff and circuit breaker patterns
 * Implements reliability patterns for the Content Scheduler
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'retry-utils' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'retry-utils' });

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  exponentialBase?: number;
  jitter?: boolean;
  retryableErrors?: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'retryableErrors' | 'onRetry'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBase: 2,
  jitter: true,
};

/**
 * Platform-specific retry configurations
 */
export const PLATFORM_RETRY_CONFIGS: Record<string, RetryConfig> = {
  instagram: {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60000,
    retryableErrors: ['ERR_RATE_LIMITED', 'ERR_TEMPORARY_FAILURE'],
  },
  tiktok: {
    maxRetries: 4,
    baseDelayMs: 1500,
    maxDelayMs: 45000,
    retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ERR_RATE_LIMITED'],
  },
  youtube: {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableErrors: ['quotaExceeded', 'rateLimitExceeded', 'backendError'],
  },
  facebook: {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 40000,
    retryableErrors: ['ERR_RATE_LIMITED', 'ERR_TEMPORARY_UNAVAILABLE'],
  },
  linkedin: {
    maxRetries: 3,
    baseDelayMs: 3000,
    maxDelayMs: 60000,
    retryableErrors: ['ERR_RATE_LIMITED', 'ERR_SERVICE_UNAVAILABLE'],
  },
};

/**
 * Determines if an error is retryable
 */
function isRetryableError(error: Error, retryableErrors?: string[]): boolean {
  // Always retry on network errors
  const networkErrors = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'];
  if (networkErrors.some(code => error.message.includes(code))) {
    return true;
  }

  // Check for specific retryable errors
  if (retryableErrors) {
    return retryableErrors.some(code => error.message.includes(code));
  }

  // Check for HTTP status codes that are retryable
  const retryableStatusCodes = [429, 500, 502, 503, 504];
  const statusMatch = error.message.match(/status[:\s]+(\d{3})/i);
  if (statusMatch) {
    const statusCode = parseInt(statusMatch[1], 10);
    return retryableStatusCodes.includes(statusCode);
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  exponentialBase: number,
  jitter: boolean
): number {
  // Calculate exponential delay
  let delay = Math.min(baseDelayMs * Math.pow(exponentialBase, attempt - 1), maxDelayMs);

  // Add jitter to prevent thundering herd
  if (jitter) {
    // Random jitter between 0% and 100% of the delay
    delay = delay * (0.5 + Math.random() * 0.5);
  }

  return Math.floor(delay);
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config?: RetryConfig
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
    exponentialBase,
    jitter,
    retryableErrors,
    onRetry,
  } = finalConfig;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      logger.info('Attempting operation', { attempt, maxRetries: maxRetries + 1 });
      const result = await operation();
      
      if (attempt > 1) {
        logger.info('Operation succeeded after retry', { attempt });
        metrics.addMetric('RetrySuccess', MetricUnit.Count, 1);
      }
      
      return result;
    } catch (error) {
      lastError = error as Error;
      logger.error('Operation failed', { error: lastError, attempt });

      // Check if we should retry
      if (attempt > maxRetries || !isRetryableError(lastError, retryableErrors)) {
        logger.error('Max retries exceeded or non-retryable error', { 
          attempt, 
          maxRetries,
          error: lastError.message 
        });
        metrics.addMetric('RetryExhausted', MetricUnit.Count, 1);
        throw lastError;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, exponentialBase, jitter);
      logger.info('Retrying after delay', { attempt, delayMs: delay });

      // Call retry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt);
      }

      // Record retry metric
      metrics.addMetric('RetryAttempt', MetricUnit.Count, 1);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (lastError) {
    throw lastError;
  } else {
    throw new Error('No error captured during retries');
  }
}

/**
 * Circuit breaker state
 */
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  resetTimeout?: number;
  onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime = 0;
  private readonly config: Required<Omit<CircuitBreakerConfig, 'onStateChange'>>;
  private readonly onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;

  constructor(config?: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      successThreshold: config?.successThreshold ?? 2,
      timeout: config?.timeout ?? 60000, // 1 minute
      resetTimeout: config?.resetTimeout ?? 30000, // 30 seconds
    };
    this.onStateChange = config?.onStateChange;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime < this.config.timeout) {
        logger.warn('Circuit breaker is open, rejecting request');
        metrics.addMetric('CircuitBreakerRejection', MetricUnit.Count, 1);
        throw new Error('Circuit breaker is open');
      }
      // Transition to half-open
      this.setState(CircuitState.HALF_OPEN);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.setState(CircuitState.CLOSED);
        this.reset();
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failures = 0; // Reset failures on success
    }
    
    metrics.addMetric('CircuitBreakerSuccess', MetricUnit.Count, 1);
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.setState(CircuitState.OPEN);
      this.successes = 0;
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.config.failureThreshold) {
      this.setState(CircuitState.OPEN);
    }

    metrics.addMetric('CircuitBreakerFailure', MetricUnit.Count, 1);
  }

  /**
   * Change circuit state
   */
  private setState(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    
    logger.info('Circuit breaker state changed', { oldState, newState });
    metrics.addMetric(`CircuitBreakerState${newState}`, MetricUnit.Count, 1);
    
    if (this.onStateChange) {
      this.onStateChange(oldState, newState);
    }
  }

  /**
   * Reset circuit breaker
   */
  private reset(): void {
    this.failures = 0;
    this.successes = 0;
    logger.info('Circuit breaker reset');
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): { state: CircuitState; failures: number; successes: number } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
    };
  }
}

/**
 * Platform-specific circuit breakers (singleton pattern)
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create circuit breaker for a platform
 */
export function getPlatformCircuitBreaker(platform: string): CircuitBreaker {
  if (!circuitBreakers.has(platform)) {
    const config: CircuitBreakerConfig = {
      failureThreshold: platform === 'youtube' ? 10 : 5, // YouTube is more tolerant
      successThreshold: 2,
      timeout: 60000,
      onStateChange: (oldState, newState) => {
        logger.warn('Platform circuit breaker state changed', { 
          platform, 
          oldState, 
          newState 
        });
      },
    };
    circuitBreakers.set(platform, new CircuitBreaker(config));
  }
  return circuitBreakers.get(platform)!;
}

/**
 * Combine retry with circuit breaker
 */
export async function retryWithCircuitBreaker<T>(
  operation: () => Promise<T>,
  platform: string,
  retryConfig?: RetryConfig
): Promise<T> {
  const circuitBreaker = getPlatformCircuitBreaker(platform);
  
  return retryWithBackoff(
    () => circuitBreaker.execute(operation),
    retryConfig || PLATFORM_RETRY_CONFIGS[platform]
  );
}