/**
 * Industry-Standard Retry Strategy Implementation
 *
 * Based on AWS, Netflix, Google, and Uber best practices for 2024:
 * - Exponential backoff with jitter (AWS/Google standard)
 * - Circuit breaker pattern (Netflix standard)
 * - Smart error classification
 * - Maximum retry limits per error type
 * - Proper observability and monitoring
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const logger = new Logger({ serviceName: 'retry-strategy' });

// AWS/Google recommended constants
const BASE_DELAY_MS = 1000; // 1 second base delay
const MAX_DELAY_MS = 20000; // 20 seconds maximum delay (AWS SDK standard)
const JITTER_FACTOR = 0.1; // 10% jitter
const MAX_RETRIES_TRANSIENT = 5; // For retryable errors
const MAX_RETRIES_NON_TRANSIENT = 1; // For non-retryable errors (fast fail)
const CIRCUIT_BREAKER_THRESHOLD = 5; // Consecutive failures before circuit opens
const CIRCUIT_BREAKER_TIMEOUT_MS = 300000; // 5 minutes circuit breaker timeout

// Error classification based on industry standards
export enum ErrorType {
  TRANSIENT = 'transient', // Retry with exponential backoff
  NON_TRANSIENT = 'non_transient', // Fast fail / circuit breaker
  RATE_LIMITED = 'rate_limited', // Longer backoff
  AUTHENTICATION = 'authentication', // Circuit breaker immediately
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  errorType: ErrorType;
}

export interface RetryResult {
  shouldRetry: boolean;
  delayMs: number;
  reason: string;
  circuitBreakerOpen: boolean;
}

export interface ErrorAnalysis {
  errorType: ErrorType;
  isRetryable: boolean;
  httpStatusCode?: number;
  errorMessage: string;
}

/**
 * Circuit Breaker state management
 * Netflix pattern implementation
 */
class CircuitBreaker {
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private isOpen = false;

  private readonly threshold: number;
  private readonly timeoutMs: number;

  constructor(threshold = CIRCUIT_BREAKER_THRESHOLD, timeoutMs = CIRCUIT_BREAKER_TIMEOUT_MS) {
    this.threshold = threshold;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check if circuit breaker should allow the request
   */
  canExecute(): boolean {
    if (!this.isOpen) {
      return true;
    }

    // Check if timeout has passed (half-open state)
    if (Date.now() - this.lastFailureTime > this.timeoutMs) {
      logger.info('Circuit breaker entering half-open state');
      this.isOpen = false;
      return true;
    }

    return false;
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.isOpen = false;
    logger.info('Circuit breaker reset due to successful execution');
  }

  /**
   * Record a failed execution
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.consecutiveFailures >= this.threshold && !this.isOpen) {
      this.isOpen = true;
      logger.warn('Circuit breaker opened', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.threshold,
      });
    }
  }

  /**
   * Get current circuit breaker state
   */
  getState(): { isOpen: boolean; consecutiveFailures: number; lastFailureTime: number } {
    return {
      isOpen: this.isOpen,
      consecutiveFailures: this.consecutiveFailures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Main retry strategy class implementing industry best practices
 */
export class RetryStrategy {
  private static circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly metrics: Metrics;

  constructor(metrics: Metrics) {
    this.metrics = metrics;
  }

  /**
   * Analyze error to determine retry strategy
   * Based on AWS SDK error classification
   */
  analyzeError(error: Error | unknown): ErrorAnalysis {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Extract HTTP status code if available
    const statusCodeMatch = errorMessage.match(/(\d{3})/);
    const httpStatusCode = statusCodeMatch ? parseInt(statusCodeMatch[1]) : undefined;

    // AWS/Industry standard error classification
    if (httpStatusCode) {
      switch (httpStatusCode) {
        // Authentication/Authorization errors → Circuit breaker
        case 401:
        case 403:
          return {
            errorType: ErrorType.AUTHENTICATION,
            isRetryable: false,
            httpStatusCode,
            errorMessage,
          };

        // Client errors (non-retryable)
        case 400:
        case 404:
        case 409:
          return {
            errorType: ErrorType.NON_TRANSIENT,
            isRetryable: false,
            httpStatusCode,
            errorMessage,
          };

        // Rate limiting
        case 429:
          return {
            errorType: ErrorType.RATE_LIMITED,
            isRetryable: true,
            httpStatusCode,
            errorMessage,
          };

        // Server errors (retryable)
        case 500:
        case 502:
        case 503:
        case 504:
          return {
            errorType: ErrorType.TRANSIENT,
            isRetryable: true,
            httpStatusCode,
            errorMessage,
          };

        default:
          return {
            errorType: ErrorType.NON_TRANSIENT,
            isRetryable: false,
            httpStatusCode,
            errorMessage,
          };
      }
    }

    // Network/timeout errors (retryable)
    if (
      errorMessage.includes('timeout') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ENOTFOUND')
    ) {
      return {
        errorType: ErrorType.TRANSIENT,
        isRetryable: true,
        errorMessage,
      };
    }

    // Default to non-transient for unknown errors
    return {
      errorType: ErrorType.NON_TRANSIENT,
      isRetryable: false,
      errorMessage,
    };
  }

  /**
   * Calculate retry delay using exponential backoff with jitter
   * AWS/Google standard implementation
   */
  calculateDelay(attempt: number, errorType: ErrorType): number {
    let baseDelay = BASE_DELAY_MS;
    let maxDelay = MAX_DELAY_MS;

    // Rate limiting gets longer base delay
    if (errorType === ErrorType.RATE_LIMITED) {
      baseDelay = 5000; // 5 seconds for rate limiting
      maxDelay = 60000; // 1 minute max for rate limiting
    }

    // Exponential backoff: delay = base * 2^attempt
    const exponentialDelay = baseDelay * Math.pow(2, attempt);

    // Add jitter (randomness) to prevent thundering herd
    const jitter = exponentialDelay * JITTER_FACTOR * Math.random();
    const totalDelay = exponentialDelay + jitter;

    // Cap at maximum delay
    return Math.min(totalDelay, maxDelay);
  }

  /**
   * Get circuit breaker for a specific key (e.g., scheduleId, brandId)
   */
  private getCircuitBreaker(key: string): CircuitBreaker {
    if (!RetryStrategy.circuitBreakers.has(key)) {
      RetryStrategy.circuitBreakers.set(key, new CircuitBreaker());
    }
    return RetryStrategy.circuitBreakers.get(key)!;
  }

  /**
   * Determine if a retry should be attempted
   * Main decision logic implementing all patterns
   */
  shouldRetry(error: Error | unknown, attemptNumber: number, scheduleId: string): RetryResult {
    const errorAnalysis = this.analyzeError(error);
    const circuitBreaker = this.getCircuitBreaker(scheduleId);

    logger.info('Analyzing retry decision', {
      scheduleId,
      attemptNumber,
      errorType: errorAnalysis.errorType,
      isRetryable: errorAnalysis.isRetryable,
      httpStatusCode: errorAnalysis.httpStatusCode,
      circuitBreakerState: circuitBreaker.getState(),
    });

    // Record metrics
    this.metrics.addMetric('RetryAnalysis', MetricUnit.Count, 1);
    this.metrics.addMetric(`ErrorType_${errorAnalysis.errorType}`, MetricUnit.Count, 1);

    // Check circuit breaker first
    if (!circuitBreaker.canExecute()) {
      this.metrics.addMetric('CircuitBreakerRejection', MetricUnit.Count, 1);
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Circuit breaker is open',
        circuitBreakerOpen: true,
      };
    }

    // Authentication errors → Open circuit breaker immediately
    if (errorAnalysis.errorType === ErrorType.AUTHENTICATION) {
      circuitBreaker.recordFailure();
      this.metrics.addMetric('AuthenticationError', MetricUnit.Count, 1);
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Authentication error - circuit breaker opened',
        circuitBreakerOpen: true,
      };
    }

    // Non-retryable errors → Fast fail
    if (!errorAnalysis.isRetryable) {
      circuitBreaker.recordFailure();
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: 'Non-retryable error type',
        circuitBreakerOpen: false,
      };
    }

    // Check retry limits based on error type
    const maxRetries =
      errorAnalysis.errorType === ErrorType.TRANSIENT ||
      errorAnalysis.errorType === ErrorType.RATE_LIMITED
        ? MAX_RETRIES_TRANSIENT
        : MAX_RETRIES_NON_TRANSIENT;

    if (attemptNumber >= maxRetries) {
      circuitBreaker.recordFailure();
      this.metrics.addMetric('MaxRetriesExceeded', MetricUnit.Count, 1);
      return {
        shouldRetry: false,
        delayMs: 0,
        reason: `Maximum retry attempts exceeded (${maxRetries})`,
        circuitBreakerOpen: false,
      };
    }

    // Calculate delay for retryable errors
    const delayMs = this.calculateDelay(attemptNumber, errorAnalysis.errorType);

    this.metrics.addMetric('RetryScheduled', MetricUnit.Count, 1);
    this.metrics.addMetric('RetryDelayMs', MetricUnit.Milliseconds, delayMs);

    return {
      shouldRetry: true,
      delayMs,
      reason: `Retryable ${errorAnalysis.errorType} error`,
      circuitBreakerOpen: false,
    };
  }

  /**
   * Record successful execution (resets circuit breaker)
   */
  recordSuccess(scheduleId: string): void {
    const circuitBreaker = this.getCircuitBreaker(scheduleId);
    circuitBreaker.recordSuccess();
    this.metrics.addMetric('RetrySuccess', MetricUnit.Count, 1);
  }

  /**
   * Get retry configuration for error type
   */
  getRetryConfig(errorType: ErrorType): RetryConfig {
    const configs: Record<ErrorType, RetryConfig> = {
      [ErrorType.TRANSIENT]: {
        maxRetries: MAX_RETRIES_TRANSIENT,
        baseDelayMs: BASE_DELAY_MS,
        maxDelayMs: MAX_DELAY_MS,
        jitterFactor: JITTER_FACTOR,
        errorType: ErrorType.TRANSIENT,
      },
      [ErrorType.RATE_LIMITED]: {
        maxRetries: MAX_RETRIES_TRANSIENT,
        baseDelayMs: 5000, // 5 seconds for rate limiting
        maxDelayMs: 60000, // 1 minute max
        jitterFactor: JITTER_FACTOR,
        errorType: ErrorType.RATE_LIMITED,
      },
      [ErrorType.NON_TRANSIENT]: {
        maxRetries: MAX_RETRIES_NON_TRANSIENT,
        baseDelayMs: BASE_DELAY_MS,
        maxDelayMs: MAX_DELAY_MS,
        jitterFactor: JITTER_FACTOR,
        errorType: ErrorType.NON_TRANSIENT,
      },
      [ErrorType.AUTHENTICATION]: {
        maxRetries: 0, // No retries for auth errors
        baseDelayMs: 0,
        maxDelayMs: 0,
        jitterFactor: 0,
        errorType: ErrorType.AUTHENTICATION,
      },
    };

    return configs[errorType];
  }
}
