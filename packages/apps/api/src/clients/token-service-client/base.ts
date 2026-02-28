import CircuitBreaker from 'opossum';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { resolveAwsServiceTarget } from '@postolio/aws';
import { ParameterManager, getCurrentEnvironment } from '@postolio/service-parameters';
import crypto from 'crypto';

import type { TokenData } from '../../types/token-service.js';

export interface RequestHeaders extends Record<string, string> {
  'Content-Type': string;
  'X-Request-ID': string;
  'X-Correlation-ID': string;
}

export interface TokenCacheEntry {
  data: TokenData;
  timestamp: number;
  ttl: number;
}

export interface RateLimitState {
  count: number;
  resetTime: number;
}

export interface TokenServiceConfig {
  apiUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  cacheTTL?: number;
  enableCache?: boolean;
  enableRateLimit?: boolean;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  enableAuditLog?: boolean;
  correlationId?: string;
}

export abstract class TokenServiceClientBase {
  protected circuitBreaker: CircuitBreaker | null = null;
  protected baseURL: string;
  protected signer: SignatureV4 | undefined;
  protected parameterManager: ParameterManager;
  protected config: Required<TokenServiceConfig>;
  protected cache: Map<string, TokenCacheEntry> = new Map();
  protected rateLimitState: Map<string, RateLimitState> = new Map();
  protected pendingRequests: Map<string, Promise<TokenData | null>> = new Map();
  protected correlationId: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private disposed = false;

  protected abstract logInfo(message: string, context?: Record<string, unknown>): void;
  protected abstract logWarn(message: string, context?: Record<string, unknown>): void;
  protected abstract logError(message: string, context?: Record<string, unknown>): void;
  protected abstract cleanupCache(): void;

  constructor(config?: TokenServiceConfig) {
    this.config = {
      apiUrl: config?.apiUrl || process.env.TOKEN_SERVICE_URL || 'http://localhost:4001',
      timeout: config?.timeout || 30000,
      maxRetries: config?.maxRetries || 3,
      retryDelay: config?.retryDelay || 1000,
      cacheTTL: config?.cacheTTL || 300,
      enableCache: config?.enableCache ?? true,
      enableRateLimit: config?.enableRateLimit ?? true,
      rateLimit: config?.rateLimit || {
        maxRequests: 100,
        windowMs: 60000,
      },
      enableAuditLog: config?.enableAuditLog ?? true,
      correlationId: config?.correlationId || crypto.randomUUID(),
    };

    this.baseURL = this.config.apiUrl;
    this.correlationId = this.config.correlationId;
    this.parameterManager = new ParameterManager(process.env.AWS_REGION || 'us-east-1');
    this.initPromise = this.initialize();

    if (this.config.enableCache) {
      this.cleanupInterval = setInterval(() => {
        if (!this.disposed) {
          this.cleanupCache();
        }
      }, 60000);
      this.cleanupInterval.unref();
    }
  }

  protected async initialize(): Promise<void> {
    await this.initializeServiceUrl();
    this.initializeSigner();
    this.initializeCircuitBreaker();
    this.initialized = true;
  }

  protected async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    throw new Error('TokenServiceClient not properly initialized');
  }

  private async initializeServiceUrl(): Promise<void> {
    try {
      const environment = getCurrentEnvironment();
      this.baseURL = await this.parameterManager.getServiceUrl('TOKEN_SERVICE_URL', environment);
      this.logInfo('Token Service URL retrieved from parameter store', {
        url: this.baseURL,
        environment,
      });
      return;
    } catch (error) {
      this.logWarn('Failed to get Token Service URL from centralized parameter manager', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (process.env.TOKEN_SERVICE_FUNCTION_URL) {
      this.baseURL = process.env.TOKEN_SERVICE_FUNCTION_URL;
      this.logInfo('Using Token Service URL from environment variable', { url: this.baseURL });
      return;
    }

    if (this.config.apiUrl && !this.config.apiUrl.includes('localhost')) {
      this.baseURL = this.config.apiUrl;
      this.logInfo('Using Token Service URL from config', { url: this.baseURL });
      return;
    }

    this.logWarn('Token Service URL not properly configured - using localhost fallback', {
      fallbackUrl: this.baseURL,
    });
  }

  private initializeSigner(): void {
    if (!(process.env.AWS_REGION || process.env.AWS_ACCESS_KEY_ID)) {
      return;
    }

    try {
      const { service, region } = resolveAwsServiceTarget(this.baseURL);
      this.signer = new SignatureV4({
        service,
        region,
        credentials: defaultProvider(),
        sha256: Sha256,
      });

      this.logInfo('Initialized AWS SigV4 signer', { service, region, baseURL: this.baseURL });
    } catch (error) {
      this.logWarn('Failed to initialize AWS SigV4 signer', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private initializeCircuitBreaker(): void {
    const options = {
      timeout: this.config.timeout,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      name: 'TokenServiceClient',
      volumeThreshold: 10,
      capacity: 100,
    };

    this.circuitBreaker = new CircuitBreaker(
      async (operation: () => Promise<unknown>) => operation(),
      options
    );

    this.circuitBreaker.on('open', () => {
      this.logError('Circuit breaker OPEN - failing fast', { stats: this.circuitBreaker!.stats });
    });

    this.circuitBreaker.on('halfOpen', () => {
      this.logInfo('Circuit breaker HALF-OPEN - testing recovery');
    });

    this.circuitBreaker.on('close', () => {
      this.logInfo('Circuit breaker CLOSED - service healthy');
    });
  }

  dispose(): void {
    this.disposed = true;

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.parameterManager.dispose();
    this.cache.clear();
    this.rateLimitState.clear();
    this.pendingRequests.clear();

    this.initialized = false;
    this.initPromise = null;
  }
}
