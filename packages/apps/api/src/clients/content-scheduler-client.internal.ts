import axios, { type AxiosError } from 'axios';
import { z } from 'zod';
import {
  NetworkError,
  type ErrorDetails,
  RateLimitError,
  SchedulerError,
  ValidationError,
} from './content-scheduler-client.errors.js';
import { log, summarizeError, sleep } from './content-scheduler-client.logging.js';

type ClientLike = any;

export {
  setupInterceptors,
  setupCircuitBreakerEvents,
  resolveUserContext,
  generateRequestId,
  log,
  summarizeError,
  composeFullUrl,
  safeSize,
  sleep,
  getCachedResponse,
  setCachedResponse,
  applyRequestTracingHeaders,
} from './content-scheduler-client.logging.js';

export async function executeWithCircuitBreaker<T>(
  client: ClientLike,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return (await client.circuitBreaker.fire(fn)) as T;
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (code === 'EOPENBREAKER') {
      throw new SchedulerError(
        'Scheduler service is temporarily unavailable due to repeated failures',
        'CIRCUIT_BREAKER_OPEN',
        503,
        {
          message: 'Circuit breaker is open. Service will retry after cooldown period.',
          stats: client.getCircuitBreakerStats(),
        }
      );
    }
    if (code === 'ETIMEDOUT') {
      throw new SchedulerError('Request to scheduler service timed out', 'TIMEOUT', 504, {
        timeout: client.config.timeout,
        message: error instanceof Error && error.message ? error.message : 'Operation timed out',
      });
    }
    if (code === 'ESEMLOCKED') {
      throw new SchedulerError(
        'Scheduler service is busy. Please retry shortly.',
        'SERVICE_BUSY',
        429,
        {
          stats: client.getCircuitBreakerStats(),
        }
      );
    }
    if (error instanceof SchedulerError) {
      throw error;
    }
    if (error instanceof z.ZodError) {
      throw new ValidationError('Invalid data format', { errors: error.issues });
    }
    if (axios.isAxiosError(error)) {
      throw handleAxiosError(client, error);
    }
    log(client, 'error', 'scheduler.circuit.unexpected_error', summarizeError(error));
    throw new SchedulerError(
      'Unexpected error occurred in scheduler client',
      'UNKNOWN_ERROR',
      500,
      {
        originalError: error instanceof Error ? error.message : String(error),
        circuitBreakerState: client.circuitBreaker.opened ? 'open' : 'closed',
      }
    );
  }
}

export async function retryWithBackoff<T>(
  client: ClientLike,
  fn: () => Promise<T>,
  attempt = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= (client.config.maxRetries || 3)) {
      if (client.debug) {
        log(client, 'warn', 'scheduler.retry.maxAttemptsReached', {
          attempts: attempt + 1,
          error: summarizeError(error),
        });
      }
      throw error;
    }

    if (isRetryableError(error)) {
      const delay = calculateBackoffDelay(client, attempt);
      if (client.debug) {
        log(client, 'info', 'scheduler.retry.backoff', {
          attempt: attempt + 1,
          delayMs: delay,
          error: summarizeError(error),
        });
      }
      await sleep(delay);
      return retryWithBackoff(client, fn, attempt + 1);
    }

    if (client.debug) {
      log(client, 'info', 'scheduler.retry.nonRetryable', {
        attempt: attempt + 1,
        error: summarizeError(error),
      });
    }
    throw error;
  }
}

export function calculateBackoffDelay(client: ClientLike, attempt: number): number {
  const baseDelay = client.config.retryDelay || 1000;
  const maxDelay = 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

export function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  if (!error.response) {
    return true;
  }
  return [408, 429, 500, 502, 503, 504].includes(error.response.status);
}

export function handleAxiosError(client: ClientLike, error: AxiosError): SchedulerError {
  if (!error.response) {
    if (client.debug) {
      log(client, 'error', 'scheduler.http.networkError', {
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
    return new RateLimitError('Rate limit exceeded', retryAfter ? parseInt(retryAfter) : undefined);
  }
  if (status === 400) {
    return new ValidationError('Invalid request', data as ErrorDetails);
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
      data as ErrorDetails
    );
  }
  return new SchedulerError('Request failed', 'REQUEST_FAILED', status, data as ErrorDetails);
}
