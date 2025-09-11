/**
 * Enhanced Token Service Client SDK
 * Addresses architectural, engineering, and security review findings
 */

import CircuitBreaker from 'opossum';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { getServiceDiscovery } from '../utils/service-discovery-client.js';
import { shouldUseServiceDiscovery } from '../utils/service-discovery.js';
import type { StoreTokenParams, TokenData } from '../types/token-service.js';
import { getRedisClient } from '../services/redis.js';
import crypto from 'crypto';
import {
  TokenServiceError,
  RateLimitError,
  ValidationError,
} from '../errors/token-service-errors.js';

// Proper type definitions
interface RequestHeaders extends Record<string, string> {
  'Content-Type': string;
  'X-Request-ID': string;
  'X-Correlation-ID': string;
}

interface TokenCacheEntry {
  data: TokenData;
  timestamp: number;
  ttl: number;
}

interface RateLimitState {
  count: number;
  resetTime: number;
}

export interface TokenServiceConfig {
  apiUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  cacheTTL?: number; // Cache TTL in seconds
  enableCache?: boolean;
  enableRateLimit?: boolean;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  enableAuditLog?: boolean;
  correlationId?: string;
}

export class TokenServiceClient {
  private circuitBreaker: CircuitBreaker | null = null;
  private baseURL: string;
  private signer: SignatureV4 | undefined;
  private config: Required<TokenServiceConfig>;
  private cache: Map<string, TokenCacheEntry> = new Map();
  private rateLimitState: Map<string, RateLimitState> = new Map();
  private pendingRequests: Map<string, Promise<TokenData | null>> = new Map();
  private correlationId: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(config?: TokenServiceConfig) {
    // Set defaults with proper typing
    this.config = {
      apiUrl: config?.apiUrl || process.env.TOKEN_SERVICE_URL || 'http://localhost:4001',
      timeout: config?.timeout || 30000,
      maxRetries: config?.maxRetries || 3,
      retryDelay: config?.retryDelay || 1000,
      cacheTTL: config?.cacheTTL || 300, // 5 minutes default
      enableCache: config?.enableCache ?? true,
      enableRateLimit: config?.enableRateLimit ?? true,
      rateLimit: config?.rateLimit || {
        maxRequests: 100,
        windowMs: 60000, // 1 minute
      },
      enableAuditLog: config?.enableAuditLog ?? true,
      correlationId: config?.correlationId || crypto.randomUUID(),
    };

    this.baseURL = this.config.apiUrl;
    this.correlationId = this.config.correlationId;

    // Initialize asynchronously to handle service discovery properly
    this.initPromise = this.initialize();

    // Set up cache cleanup
    if (this.config.enableCache) {
      setInterval(() => this.cleanupCache(), 60000); // Clean every minute
    }
  }

  private async initialize(): Promise<void> {
    // Initialize service discovery first (async operation)
    await this.initializeWithServiceDiscovery();

    // Initialize AWS SigV4 signer for IAM authentication
    this.initializeSigner();

    // Initialize circuit breaker with enhanced configuration
    this.initializeCircuitBreaker();

    this.initialized = true;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    throw new Error('TokenServiceClient not properly initialized');
  }

  private async initializeWithServiceDiscovery(): Promise<void> {
    if (shouldUseServiceDiscovery(this.baseURL, this.config.apiUrl)) {
      try {
        const discovery = getServiceDiscovery();
        const tokenServiceUrl = await discovery.getServiceUrl('token-service');
        this.baseURL = tokenServiceUrl;
        this.logInfo('Token Service discovered via Cloud Map', {
          url: tokenServiceUrl,
        });
      } catch (error) {
        this.logWarn('Token Service discovery failed, using fallback URL', {
          fallbackUrl: this.baseURL,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private initializeSigner(): void {
    if (process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID) {
      try {
        this.signer = new SignatureV4({
          service: 'execute-api',
          region: process.env.AWS_REGION || 'us-east-1',
          credentials: defaultProvider(),
          sha256: Sha256,
        });
      } catch (error) {
        this.logWarn('Failed to initialize AWS SigV4 signer', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private initializeCircuitBreaker(): void {
    const options = {
      timeout: this.config.timeout,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'TokenServiceClient',
      volumeThreshold: 10, // Minimum requests before opening
      capacity: 100, // Rolling window size
    };

    this.circuitBreaker = new CircuitBreaker(
      async (operation: () => Promise<unknown>) => operation(),
      options
    );

    this.circuitBreaker!.on('open', () => {
      this.logError('Circuit breaker OPEN - failing fast', {
        stats: this.circuitBreaker!.stats,
      });
    });

    this.circuitBreaker!.on('halfOpen', () => {
      this.logInfo('Circuit breaker HALF-OPEN - testing recovery');
    });

    this.circuitBreaker!.on('close', () => {
      this.logInfo('Circuit breaker CLOSED - service healthy');
    });
  }

  /**
   * Get a token with caching and deduplication
   */
  async getToken(userId: string, brandId: string, platform: string): Promise<TokenData | null> {
    // Ensure initialization is complete
    await this.ensureInitialized();

    const cacheKey = `token:${userId}:${brandId}:${platform}`;

    // Check cache first
    if (this.config.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logDebug('Cache hit', { cacheKey });
        return cached;
      }
    }

    // Check for pending request (deduplication)
    const pendingKey = `get:${cacheKey}`;
    if (this.pendingRequests.has(pendingKey)) {
      this.logDebug('Request deduplication', { pendingKey });
      const existing = this.pendingRequests.get(pendingKey);
      if (existing) return existing;
    }

    // Check rate limit
    if (this.config.enableRateLimit) {
      await this.checkRateLimit('getToken');
    }

    // Make the request
    const promise = this.circuitBreaker!.fire(async () => {
      const path = `/tokens/${userId}/${platform}/${brandId}`;
      const response = await this.makeRequest(path, 'GET');

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const error = await response.text();
        throw new TokenServiceError(
          `Failed to get token: ${error}`,
          'TOKEN_GET_FAILED',
          response.status,
          response.status >= 500
        );
      }

      const data = (await response.json()) as TokenData;

      // Cache the result
      if (this.config.enableCache && data) {
        this.setInCache(cacheKey, data);
      }

      // Audit log
      if (this.config.enableAuditLog) {
        await this.auditLog('GET_TOKEN', { userId, brandId, platform });
      }

      return data;
    }) as Promise<TokenData | null>;

    // Store pending request
    this.pendingRequests.set(pendingKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up pending request
      this.pendingRequests.delete(pendingKey);
    }
  }

  /**
   * Store a token with validation
   */
  async storeToken(params: StoreTokenParams): Promise<void> {
    // Ensure initialization is complete
    await this.ensureInitialized();

    // Validate input
    this.validateStoreTokenParams(params);

    // Check rate limit
    if (this.config.enableRateLimit) {
      await this.checkRateLimit('storeToken');
    }

    await this.circuitBreaker!.fire(async () => {
      const path = `/tokens/${params.userId}/${params.platform}/${params.brandId}`;
      const response = await this.makeRequest(path, 'PUT', {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt: params.expiresAt,
        metadata: params.metadata,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new TokenServiceError(
          `Failed to store token: ${error}`,
          'TOKEN_STORE_FAILED',
          response.status,
          response.status >= 500
        );
      }

      // Invalidate cache
      if (this.config.enableCache) {
        const cacheKey = `token:${params.userId}:${params.brandId}:${params.platform}`;
        this.cache.delete(cacheKey);
      }

      // Audit log
      if (this.config.enableAuditLog) {
        await this.auditLog('STORE_TOKEN', {
          userId: params.userId,
          brandId: params.brandId,
          platform: params.platform,
        });
      }
    });
  }

  /**
   * Enhanced request with proper typing and error handling
   */
  private async makeRequest(
    path: string,
    method: string,
    body?: unknown,
    retries = this.config.maxRetries
  ): Promise<Response> {
    const url = new URL(`${this.baseURL}${path}`);
    const requestId = crypto.randomUUID();

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const headers: RequestHeaders = {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
          'X-Correlation-ID': this.correlationId,
        };

        // Sign request if we have a signer
        let finalHeaders = headers as Record<string, string>;
        if (this.signer) {
          const request = {
            method,
            headers: {
              ...headers,
              host: url.hostname,
            },
            hostname: url.hostname,
            path: url.pathname + url.search,
            protocol: url.protocol,
            body: body ? JSON.stringify(body) : undefined,
          };

          const signedRequest = await this.signer.sign(request);
          finalHeaders = signedRequest.headers as Record<string, string>;
        }

        const fetchOptions: {
          method: string;
          headers: Record<string, string>;
          body?: string;
        } = {
          method,
          headers: finalHeaders,
        };

        if (body) {
          fetchOptions.body = JSON.stringify(body);
        }

        const startTime = Date.now();
        const response = await fetch(url.toString(), fetchOptions);
        const duration = Date.now() - startTime;

        // Log request metrics
        this.logDebug('Request completed', {
          method,
          path,
          status: response.status,
          duration,
          attempt: attempt + 1,
          requestId,
        });

        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          return response;
        }

        // Retry on server errors (5xx) with exponential backoff + jitter
        if (response.status >= 500 && attempt < retries - 1) {
          const baseDelay = this.config.retryDelay;
          const exponentialDelay = baseDelay * Math.pow(2, attempt);
          const jitter = Math.random() * exponentialDelay * 0.1; // 10% jitter
          const delay = Math.min(exponentialDelay + jitter, 30000);

          this.logWarn('Retrying request', {
            method,
            path,
            status: response.status,
            attempt: attempt + 1,
            retryAfter: delay,
          });

          await this.sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        // Network error - retry with backoff
        if (attempt < retries - 1) {
          const baseDelay = this.config.retryDelay;
          const exponentialDelay = baseDelay * Math.pow(2, attempt);
          const jitter = Math.random() * exponentialDelay * 0.1;
          const delay = Math.min(exponentialDelay + jitter, 30000);

          this.logWarn('Network error, retrying', {
            method,
            path,
            error: error instanceof Error ? error.message : 'Unknown error',
            attempt: attempt + 1,
            retryAfter: delay,
          });

          await this.sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw new TokenServiceError(
      `Failed after ${retries} attempts`,
      'MAX_RETRIES_EXCEEDED',
      undefined,
      false
    );
  }

  // Cache management
  private getFromCache(key: string): TokenData | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private setInCache(key: string, data: TokenData): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: this.config.cacheTTL,
    });
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > entry.ttl * 1000) {
        this.cache.delete(key);
      }
    }
  }

  // Rate limiting
  private async checkRateLimit(operation: string): Promise<void> {
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

    state.count++;
    this.rateLimitState.set(operation, state);
  }

  // Validation
  private validateStoreTokenParams(params: StoreTokenParams): void {
    if (!params.userId || !params.brandId || !params.platform || !params.accessToken) {
      throw new ValidationError('Missing required parameters');
    }

    if (params.expiresAt && new Date(params.expiresAt) < new Date()) {
      throw new ValidationError('Token already expired');
    }
  }

  // Audit logging
  private async auditLog(action: string, data: Record<string, unknown>): Promise<void> {
    try {
      const redis = getRedisClient();
      if (redis) {
        const logEntry = {
          action,
          data,
          timestamp: new Date().toISOString(),
          correlationId: this.correlationId,
        };
        await redis.lpush('token-service:audit', JSON.stringify(logEntry));
        await redis.ltrim('token-service:audit', 0, 10000); // Keep last 10k entries
      }
    } catch (error) {
      this.logWarn('Failed to write audit log', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Structured logging
  private logDebug(message: string, context?: Record<string, unknown>): void {
    if (process.env.LOG_LEVEL === 'debug') {
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
  }

  private logInfo(message: string, context?: Record<string, unknown>): void {
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

  private logWarn(message: string, context?: Record<string, unknown>): void {
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

  private logError(message: string, context?: Record<string, unknown>): void {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Get circuit breaker statistics
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

  // Get cache statistics
  getCacheStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }

  // Health check endpoint
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

  // Get service metrics
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
}

// Export default client instance
export const tokenServiceClient = new TokenServiceClient();
