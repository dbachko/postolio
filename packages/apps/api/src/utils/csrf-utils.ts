/**
 * CSRF Utilities
 * 
 * Helper functions for CSRF protection with performance optimizations.
 */

import { createHmac, randomBytes } from 'crypto';
import { FastifyRequest } from 'fastify';

// Cache for performance
const signatureCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

/**
 * Generate secure random token with caching
 */
export async function generateSecureToken(length: number = 32): Promise<string> {
  return new Promise((resolve, reject) => {
    randomBytes(length, (err, buffer) => {
      if (err) reject(err);
      else resolve(buffer.toString('base64url'));
    });
  });
}

/**
 * Create HMAC signature with caching
 */
export function createSignature(data: string, secret: string): string {
  const cacheKey = `${data}:${secret.substring(0, 8)}`; // Use partial secret for cache key
  
  // Check cache
  const cached = signatureCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Generate signature
  const signature = createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  
  // Cache with LRU eviction
  if (signatureCache.size >= MAX_CACHE_SIZE) {
    const firstKey = signatureCache.keys().next().value;
    if (firstKey) {
      signatureCache.delete(firstKey);
    }
  }
  
  signatureCache.set(cacheKey, signature);
  return signature;
}

/**
 * Extract client fingerprint for additional validation
 */
export function getClientFingerprint(request: FastifyRequest): string {
  const components = [
    request.ip || 'unknown',
    request.headers['user-agent'] || 'unknown',
    request.headers['accept-language'] || 'unknown',
    request.headers['accept-encoding'] || 'unknown',
  ];
  
  return createHmac('sha256', 'fingerprint-salt')
    .update(components.join(':'))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Validate request origin against whitelist
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return false;
  
  // Exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  
  // Wildcard subdomain match (*.example.com)
  for (const allowed of allowedOrigins) {
    if (allowed.startsWith('*.')) {
      const domain = allowed.substring(2);
      if (origin.endsWith(domain)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Circuit breaker for external dependencies
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private readonly threshold: number = 5,
    private readonly timeout: number = 60000,
    private readonly resetTimeout: number = 30000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    // Check if circuit is open
    if (this.state === 'open') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      
      if (timeSinceFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        return null; // Circuit is open, fail fast
      }
    }
    
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), this.timeout)
        ),
      ]);
      
      // Success - reset if in half-open state
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failureCount = 0;
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      
      if (this.state === 'half-open') {
        this.state = 'open';
      }
      
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'open';
    }
  }
  
  getState(): string {
    return this.state;
  }
}

/**
 * Performance timer utility
 */
export class PerformanceTimer {
  private timers = new Map<string, number>();
  
  start(label: string): void {
    this.timers.set(label, Date.now());
  }
  
  end(label: string): number {
    const start = this.timers.get(label);
    if (!start) return 0;
    
    const duration = Date.now() - start;
    this.timers.delete(label);
    return duration;
  }
  
  async measure<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
    this.start(label);
    const result = await fn();
    const duration = this.end(label);
    return [result, duration];
  }
}

/**
 * Exponential backoff retry mechanism
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Sanitize error messages for client response
 */
export function sanitizeError(error: Error): { message: string; code: string } {
  // Map internal errors to safe client messages
  const errorMap: Record<string, { message: string; code: string }> = {
    'Token expired': { message: 'Security token has expired', code: 'TOKEN_EXPIRED' },
    'Invalid signature': { message: 'Invalid security token', code: 'TOKEN_INVALID' },
    'Rate limit exceeded': { message: 'Too many requests', code: 'RATE_LIMITED' },
    'Origin mismatch': { message: 'Request origin not allowed', code: 'ORIGIN_INVALID' },
  };
  
  for (const [key, value] of Object.entries(errorMap)) {
    if (error.message.includes(key)) {
      return value;
    }
  }
  
  // Generic error for unknown issues
  return {
    message: 'Request validation failed',
    code: 'VALIDATION_ERROR',
  };
}