import crypto from 'crypto';

import { getRedisClient } from '../../services/redis.js';
import type { StoreTokenParams, TokenData } from '../../types/token-service.js';
import {
  RateLimitError,
  TokenServiceError,
  ValidationError,
} from '../../errors/token-service-errors.js';
import {
  type RateLimitState,
  type RequestHeaders,
  type TokenServiceConfig,
  TokenServiceClientBase,
} from './base.js';

export class TokenServiceClientRequestSupport extends TokenServiceClientBase {
  constructor(config?: TokenServiceConfig) {
    super(config);
  }

  protected async makeRequest(
    path: string,
    method: string,
    body?: unknown,
    retries = this.config.maxRetries
  ): Promise<Response> {
    const url = new URL(`${this.baseURL}${path}`);
    const requestId = crypto.randomUUID();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await this.executeRequest(url, path, method, body, requestId, attempt);
        if (!this.shouldRetryResponse(response, attempt, retries)) {
          return response;
        }

        const delay = this.computeRetryDelay(attempt);
        this.logWarn('Retrying request', {
          method,
          path,
          status: response.status,
          attempt: attempt + 1,
          retryAfter: delay,
        });
        await this.sleep(delay);
      } catch (error) {
        if (attempt >= retries - 1) {
          throw error;
        }

        const delay = this.computeRetryDelay(attempt);
        this.logWarn('Network error, retrying', {
          method,
          path,
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt: attempt + 1,
          retryAfter: delay,
        });
        await this.sleep(delay);
      }
    }

    throw new TokenServiceError(`Failed after ${retries} attempts`, 'MAX_RETRIES_EXCEEDED');
  }

  protected getFromCache(key: string): TokenData | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  protected setInCache(key: string, data: TokenData): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.config.cacheTTL,
    });
  }

  protected cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > entry.ttl * 1000) {
        this.cache.delete(key);
      }
    }
  }

  protected async checkRateLimit(operation: string): Promise<void> {
    const now = Date.now();
    const state = this.rateLimitState.get(operation) || {
      count: 0,
      resetTime: now + this.config.rateLimit.windowMs,
    };

    if (now > state.resetTime) {
      state.count = 0;
      state.resetTime = now + this.config.rateLimit.windowMs;
    }

    if (state.count >= this.config.rateLimit.maxRequests) {
      const retryAfter = Math.ceil((state.resetTime - now) / 1000);
      throw new RateLimitError(retryAfter);
    }

    state.count += 1;
    this.rateLimitState.set(operation, state as RateLimitState);
  }

  protected validateStoreTokenParams(params: StoreTokenParams): void {
    if (!params.userId || !params.brandId || !params.platform || !params.accessToken) {
      throw new ValidationError('Missing required parameters');
    }

    if (params.expiresAt && new Date(params.expiresAt) < new Date()) {
      throw new ValidationError('Token already expired');
    }
  }

  protected async auditLog(action: string, data: Record<string, unknown>): Promise<void> {
    try {
      const redis = getRedisClient();
      if (!redis) {
        return;
      }

      const logEntry = {
        action,
        data,
        timestamp: new Date().toISOString(),
        correlationId: this.correlationId,
      };
      await redis.lpush('token-service:audit', JSON.stringify(logEntry));
      await redis.ltrim('token-service:audit', 0, 10000);
    } catch (error) {
      this.logWarn('Failed to write audit log', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  protected logDebug(message: string, context?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL !== 'debug') {
      return;
    }

    console.debug(
      JSON.stringify({
        level: 'DEBUG',
        message,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString(),
        ...context,
      })
    );
  }

  protected logInfo(message: string, context?: Record<string, unknown>): void {
    console.info(
      JSON.stringify({
        level: 'INFO',
        message,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString(),
        ...context,
      })
    );
  }

  protected logWarn(message: string, context?: Record<string, unknown>): void {
    console.warn(
      JSON.stringify({
        level: 'WARN',
        message,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString(),
        ...context,
      })
    );
  }

  protected logError(message: string, context?: Record<string, unknown>): void {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message,
        correlationId: this.correlationId,
        timestamp: new Date().toISOString(),
        ...context,
      })
    );
  }

  getCircuitBreakerStats() {
    if (!this.circuitBreaker) {
      return {
        opened: false,
        closed: false,
        halfOpen: false,
        stats: null,
      };
    }

    return {
      opened: this.circuitBreaker.opened,
      closed: this.circuitBreaker.closed,
      halfOpen: this.circuitBreaker.halfOpen,
      stats: this.circuitBreaker.stats,
    };
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/health', 'GET');
      return response.ok;
    } catch (error) {
      this.logWarn('Token service health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  async getMetrics(): Promise<Record<string, unknown> | null> {
    try {
      const response = await this.makeRequest('/metrics', 'GET');
      if (!response.ok) {
        throw new Error(`Failed to get metrics: ${response.status}`);
      }
      return response.json() as Promise<Record<string, unknown>>;
    } catch (error) {
      this.logWarn('Failed to get token service metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private shouldRetryResponse(response: Response, attempt: number, retries: number): boolean {
    return response.status >= 500 && attempt < retries - 1;
  }

  private computeRetryDelay(attempt: number): number {
    const baseDelay = this.config.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * exponentialDelay * 0.1;
    return Math.min(exponentialDelay + jitter, 30000);
  }

  private async executeRequest(
    url: URL,
    path: string,
    method: string,
    body: unknown,
    requestId: string,
    attempt: number
  ): Promise<Response> {
    const headers = await this.buildSignedHeaders(url, method, body, requestId);
    const options = this.buildFetchOptions(method, headers, body);

    const startTime = Date.now();
    const response = await fetch(url.toString(), options);
    const duration = Date.now() - startTime;

    this.logDebug('Request completed', {
      method,
      path,
      status: response.status,
      duration,
      attempt: attempt + 1,
      requestId,
    });

    return response;
  }

  private async buildSignedHeaders(
    url: URL,
    method: string,
    body: unknown,
    requestId: string
  ): Promise<Record<string, string>> {
    const headers: RequestHeaders = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'X-Correlation-ID': this.correlationId,
    };

    if (!this.signer) {
      return headers;
    }

    const request = {
      method,
      headers: { ...headers, host: url.hostname },
      hostname: url.hostname,
      path: url.pathname + url.search,
      protocol: url.protocol,
      body: body ? JSON.stringify(body) : undefined,
    };

    const signedRequest = await this.signer.sign(request);
    return signedRequest.headers as Record<string, string>;
  }

  private buildFetchOptions(method: string, headers: Record<string, string>, body?: unknown) {
    if (!body) {
      return { method, headers };
    }

    return {
      method,
      headers,
      body: JSON.stringify(body),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
