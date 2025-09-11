/**
 * CSRF Token Manager
 * Handles token generation, validation, and storage strategies
 */

import { randomBytes, createHmac } from 'crypto';
import Redis from 'ioredis';
import { FastifyRequest } from 'fastify';
import { csrfConfig } from '../config/csrf.config.js';

export interface TokenData {
  token: string;
  createdAt: number;
  sessionId: string;
  userId?: string;
}

export class CSRFTokenManager {
  private redis: Redis | null = null;
  private memoryStore: Map<string, TokenData> = new Map();
  private readonly secret: string;

  constructor(redis?: Redis) {
    this.redis = redis || null;
    this.secret = process.env.CSRF_SECRET || randomBytes(32).toString('hex');
    
    // Cleanup expired tokens from memory every 5 minutes
    if (!this.redis) {
      setInterval(() => this.cleanupMemoryStore(), 5 * 60 * 1000);
    }
  }

  /**
   * Generate a new CSRF token
   */
  generateToken(): string {
    return randomBytes(csrfConfig.tokenLength).toString('hex');
  }

  /**
   * Generate a signed token (more secure)
   */
  generateSignedToken(sessionId: string): string {
    const token = this.generateToken();
    const signature = this.sign(token, sessionId);
    return `${token}.${signature}`;
  }

  /**
   * Verify a signed token
   */
  verifySignedToken(signedToken: string, sessionId: string): boolean {
    const parts = signedToken.split('.');
    if (parts.length !== 2) return false;
    
    const [token, signature] = parts;
    const expectedSignature = this.sign(token, sessionId);
    
    // Constant-time comparison
    return this.timingSafeEqual(signature, expectedSignature);
  }

  /**
   * Store token with session binding
   */
  async storeToken(sessionId: string, token: string, userId?: string): Promise<void> {
    const tokenData: TokenData = {
      token,
      createdAt: Date.now(),
      sessionId,
      userId,
    };

    if (this.redis && csrfConfig.useRedis) {
      // Redis storage
      const key = this.getRedisKey(sessionId);
      await this.redis.setex(
        key,
        csrfConfig.tokenExpiry,
        JSON.stringify(tokenData)
      );
    } else {
      // Fallback to memory storage
      this.memoryStore.set(sessionId, tokenData);
    }
  }

  /**
   * Validate token against stored value
   */
  async validateToken(sessionId: string, token: string): Promise<boolean> {
    let storedData: TokenData | null = null;

    if (this.redis && csrfConfig.useRedis) {
      // Redis lookup
      const key = this.getRedisKey(sessionId);
      const data = await this.redis.get(key);
      if (data) {
        storedData = JSON.parse(data) as TokenData;
      }
    } else {
      // Memory lookup
      storedData = this.memoryStore.get(sessionId) || null;
    }

    if (!storedData) return false;

    // Check expiry
    const age = Date.now() - storedData.createdAt;
    if (age > csrfConfig.tokenExpiry * 1000) {
      await this.deleteToken(sessionId);
      return false;
    }

    // Constant-time comparison
    return this.timingSafeEqual(storedData.token, token);
  }

  /**
   * Delete token (used on logout or rotation)
   */
  async deleteToken(sessionId: string): Promise<void> {
    if (this.redis && csrfConfig.useRedis) {
      const key = this.getRedisKey(sessionId);
      await this.redis.del(key);
    } else {
      this.memoryStore.delete(sessionId);
    }
  }

  /**
   * Rotate token (generate new, delete old)
   */
  async rotateToken(sessionId: string, userId?: string): Promise<string> {
    await this.deleteToken(sessionId);
    const newToken = this.generateToken();
    await this.storeToken(sessionId, newToken, userId);
    return newToken;
  }

  /**
   * Get session ID from request
   */
  getSessionId(request: FastifyRequest): string {
    // Priority order:
    // 1. Authenticated user ID
    // 2. Session ID from cookie/header
    // 3. Fingerprint from IP + User-Agent
    
    const user = (request as any).user;
    if (user?.id) {
      return `user:${user.id}`;
    }

    const sessionCookie = (request as any).cookies?.['session-id'];
    if (sessionCookie) {
      return `session:${sessionCookie}`;
    }

    // Fallback to fingerprint
    const ip = request.ip || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const fingerprint = this.hash(`${ip}:${userAgent}`);
    return `fp:${fingerprint}`;
  }

  /**
   * Check if tokens should be enforced for this request
   */
  shouldEnforceToken(request: FastifyRequest): boolean {
    // Don't enforce for:
    // - Disabled CSRF
    // - Skipped methods/paths
    // - Missing authentication (for certain operations)
    
    const method = request.method;
    const path = request.url;
    
    // Use centralized skip logic
    const { shouldSkipCSRF } = require('../config/csrf.config.js');
    return !shouldSkipCSRF(method, path);
  }

  // Private helper methods

  private sign(token: string, sessionId: string): string {
    return createHmac('sha256', this.secret)
      .update(`${token}:${sessionId}`)
      .digest('hex');
  }

  private hash(input: string): string {
    return createHmac('sha256', this.secret)
      .update(input)
      .digest('hex')
      .substring(0, 16); // Use first 16 chars for brevity
  }

  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  private getRedisKey(sessionId: string): string {
    return `csrf:${sessionId}`;
  }

  private cleanupMemoryStore(): void {
    const now = Date.now();
    const expiry = csrfConfig.tokenExpiry * 1000;
    
    for (const [sessionId, data] of this.memoryStore.entries()) {
      if (now - data.createdAt > expiry) {
        this.memoryStore.delete(sessionId);
      }
    }
  }

  /**
   * Get statistics for monitoring
   */
  getStats(): {
    storageType: 'redis' | 'memory';
    tokenCount: number;
    memoryUsage?: number;
  } {
    return {
      storageType: this.redis && csrfConfig.useRedis ? 'redis' : 'memory',
      tokenCount: this.memoryStore.size,
      memoryUsage: this.memoryStore.size * 200, // Rough estimate: 200 bytes per token
    };
  }
}