/**
 * Centralized Service Parameter Management
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

/**
 * Service parameter identifiers
 * These correspond to the actual services in the Postolio platform
 */
export type ServiceParameterKey =
  | 'TOKEN_SERVICE_URL'
  | 'CONTENT_SCHEDULER_URL'
  | 'PUBLISHER_SERVICE_URL'
  | 'DLQ_PROCESSOR_URL'
  | 'RETRY_HANDLER_URL'
  | 'STATUS_SYNC_URL'
  | 'SCHEDULE_CLEANUP_URL';

/**
 * Environment types supported by the platform
 */
export type Environment = 'dev' | 'staging' | 'prod';

/**
 * Service parameter configuration interface
 */
export interface ServiceParameters {
  readonly TOKEN_SERVICE_URL: string;
  readonly CONTENT_SCHEDULER_URL: string;
  readonly PUBLISHER_SERVICE_URL: string;
  readonly DLQ_PROCESSOR_URL: string;
  readonly RETRY_HANDLER_URL: string;
  readonly STATUS_SYNC_URL: string;
  readonly SCHEDULE_CLEANUP_URL: string;
}

/**
 * Centralized parameter name generator
 * Provides consistent parameter naming across infrastructure and client code
 */
export class ParameterNames {
  private static readonly BASE_PATH = '/postolio';

  /**
   * Generate all parameter names for a specific environment
   */
  public static forEnvironment(env: Environment): ServiceParameters {
    return {
      TOKEN_SERVICE_URL: `${this.BASE_PATH}/${env}/services/token-service/url`,
      CONTENT_SCHEDULER_URL: `${this.BASE_PATH}/${env}/services/content-scheduler/url`,
      PUBLISHER_SERVICE_URL: `${this.BASE_PATH}/${env}/services/publisher/url`,
      DLQ_PROCESSOR_URL: `${this.BASE_PATH}/${env}/services/dlq-processor/url`,
      RETRY_HANDLER_URL: `${this.BASE_PATH}/${env}/services/retry-handler/url`,
      STATUS_SYNC_URL: `${this.BASE_PATH}/${env}/services/status-sync/url`,
      SCHEDULE_CLEANUP_URL: `${this.BASE_PATH}/${env}/services/schedule-cleanup/url`,
    };
  }

  /**
   * Get a specific parameter name for a service and environment
   */
  public static getParameterName(service: ServiceParameterKey, env: Environment): string {
    return this.forEnvironment(env)[service];
  }

  /**
   * Validate environment string and convert to type-safe Environment
   * Now only accepts standardized values: dev, staging, prod
   */
  public static validateEnvironment(env: string): Environment {
    if (env === 'dev' || env === 'staging' || env === 'prod') {
      return env;
    }
    throw new Error(`Invalid environment: ${env}. Must be one of: dev, staging, prod`);
  }
}

/**
 * Cache entry for parameter values
 */
interface CacheEntry {
  value: string;
  timestamp: number;
  ttl: number;
}

/**
 * Metrics for parameter manager performance monitoring
 */
interface ParameterMetrics {
  cacheHits: number;
  cacheMisses: number;
  retrievalErrors: number;
  totalRequests: number;
  averageResponseTime: number;
}

/**
 * Enhanced parameter manager with caching and error handling
 * Provides runtime parameter retrieval with optimal performance
 */
export class ParameterManager {
  private ssm: SSMClient;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly DEFAULT_TTL = 300000; // 5 minutes in milliseconds
  private cleanupInterval: NodeJS.Timeout | null = null;
  private disposed = false;
  private metrics: ParameterMetrics = {
    cacheHits: 0,
    cacheMisses: 0,
    retrievalErrors: 0,
    totalRequests: 0,
    averageResponseTime: 0,
  };

  constructor(region?: string) {
    this.ssm = new SSMClient({
      region: region || process.env.AWS_REGION || 'us-east-1',
    });

    // Start cleanup interval
    this.startCleanupInterval();
  }

  /**
   * Start automatic cache cleanup to prevent memory leaks
   */
  private startCleanupInterval(): void {
    // Clean up expired entries every 2 minutes
    this.cleanupInterval = setInterval(() => {
      if (!this.disposed) {
        this.cleanupExpiredEntries();
      }
    }, 120000);

    // Unref to not block process exit
    this.cleanupInterval.unref();
  }

  /**
   * Dispose of resources and clean up intervals
   */
  dispose(): void {
    this.disposed = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.cache.clear();
  }

  /**
   * Get service URL from SSM Parameter Store with caching and monitoring
   */
  async getServiceUrl(
    service: ServiceParameterKey,
    environment: Environment,
    options?: {
      ttl?: number;
      bypassCache?: boolean;
    }
  ): Promise<string> {
    const startTime = Date.now();
    const parameterName = ParameterNames.getParameterName(service, environment);
    const ttl = options?.ttl || this.DEFAULT_TTL;

    this.metrics.totalRequests++;

    // Check cache first (unless bypassing)
    if (!options?.bypassCache) {
      const cached = this.getFromCache(parameterName);
      if (cached) {
        this.metrics.cacheHits++;
        this.updateAverageResponseTime(Date.now() - startTime);
        return cached;
      }
    }

    this.metrics.cacheMisses++;

    try {
      const response = await this.ssm.send(
        new GetParameterCommand({
          Name: parameterName,
        })
      );

      if (!response.Parameter?.Value) {
        this.metrics.retrievalErrors++;
        throw new Error(`Parameter ${parameterName} not found or has empty value`);
      }

      const value = response.Parameter.Value;

      // Cache the result
      this.setInCache(parameterName, value, ttl);

      this.updateAverageResponseTime(Date.now() - startTime);
      return value;
    } catch (error) {
      this.metrics.retrievalErrors++;
      this.updateAverageResponseTime(Date.now() - startTime);

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to retrieve parameter ${parameterName}: ${message}`);
    }
  }

  /**
   * Get service URL with automatic environment detection
   */
  async getServiceUrlForCurrentEnvironment(
    service: ServiceParameterKey,
    options?: {
      ttl?: number;
      bypassCache?: boolean;
    }
  ): Promise<string> {
    const envString = process.env.NODE_ENV || 'dev';
    const environment = ParameterNames.validateEnvironment(envString);
    return this.getServiceUrl(service, environment, options);
  }

  /**
   * Batch retrieve multiple service URLs
   */
  async getMultipleServiceUrls(
    services: ServiceParameterKey[],
    environment: Environment,
    options?: {
      ttl?: number;
      bypassCache?: boolean;
    }
  ): Promise<Record<ServiceParameterKey, string>> {
    const promises = services.map(async (service) => {
      const url = await this.getServiceUrl(service, environment, options);
      return [service, url] as const;
    });

    const results = await Promise.all(promises);
    return Object.fromEntries(results) as Record<ServiceParameterKey, string>;
  }

  /**
   * Clear cache for specific parameter or all parameters
   */
  clearCache(parameterName?: string): void {
    if (parameterName) {
      this.cache.delete(parameterName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    entries: Array<{ key: string; age: number; ttl: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.timestamp,
      ttl: entry.ttl,
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Get performance metrics
   */
  getMetrics(): ParameterMetrics & { cacheHitRate: number } {
    const cacheHitRate =
      this.metrics.totalRequests > 0
        ? (this.metrics.cacheHits / this.metrics.totalRequests) * 100
        : 0;

    return {
      ...this.metrics,
      cacheHitRate,
    };
  }

  /**
   * Reset metrics counters
   */
  resetMetrics(): void {
    this.metrics = {
      cacheHits: 0,
      cacheMisses: 0,
      retrievalErrors: 0,
      totalRequests: 0,
      averageResponseTime: 0,
    };
  }

  /**
   * Update average response time using rolling average
   */
  private updateAverageResponseTime(responseTime: number): void {
    if (this.metrics.totalRequests === 1) {
      this.metrics.averageResponseTime = responseTime;
    } else {
      // Simple rolling average
      this.metrics.averageResponseTime =
        this.metrics.averageResponseTime * 0.9 + responseTime * 0.1;
    }
  }

  /**
   * Get cached value if still valid and update access time for LRU
   */
  private getFromCache(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Update timestamp for LRU tracking (mark as recently accessed)
    entry.timestamp = now;
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Store value in cache with TTL
   */
  private setInCache(key: string, value: string, ttl: number): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });

    // Prevent unbounded cache growth
    this.cleanupExpiredEntries();
  }

  /**
   * Remove expired entries from cache and implement LRU eviction
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    // Implement LRU eviction for size management
    const MAX_CACHE_SIZE = 50; // Reduced for better memory management
    if (this.cache.size > MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries());

      // Sort by last access (LRU) - remove least recently used entries
      entries
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, this.cache.size - MAX_CACHE_SIZE)
        .forEach(([key]) => this.cache.delete(key));
    }
  }
}

/**
 * Default parameter manager instance for convenient usage
 */
export const parameterManager = new ParameterManager();

/**
 * Convenience function to get current environment as type-safe Environment
 * Expects NODE_ENV to be standardized as dev/staging/prod
 */
export function getCurrentEnvironment(): Environment {
  const envString = process.env.NODE_ENV || 'dev';
  return ParameterNames.validateEnvironment(envString);
}

/**
 * Convenience function to get service URL with current environment
 */
export async function getServiceUrl(service: ServiceParameterKey): Promise<string> {
  return parameterManager.getServiceUrlForCurrentEnvironment(service);
}

// Re-export types for convenience
export type { CacheEntry };
