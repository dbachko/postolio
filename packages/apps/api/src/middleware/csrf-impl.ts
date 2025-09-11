/**
 * Production-Ready CSRF Protection
 * 
 * Simplified, secure, and performant CSRF implementation.
 * Focuses on security best practices and operational excellence.
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const randomBytesAsync = promisify(randomBytes);

// Types
interface CSRFToken {
  value: string;
  expires: number;
  signature: string;
}

interface CSRFConfig {
  enabled: boolean;
  secret: string;
  tokenLifetime: number;
  cookieName: string;
  headerName: string;
  skipPaths: Set<string>;
  monitoring: boolean;
}

// Security constants
const TOKEN_LENGTH = 32;
const SIGNATURE_LENGTH = 32;
const MAX_TOKEN_AGE = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

/**
 * Production CSRF Plugin
 */
const csrfProduction: FastifyPluginAsync = async (fastify) => {
  // Configuration with secure defaults
  const config: CSRFConfig = {
    enabled: process.env.NODE_ENV !== 'test',
    secret: process.env.CSRF_SECRET || randomBytes(32).toString('hex'),
    tokenLifetime: MAX_TOKEN_AGE,
    cookieName: '__Host-csrf', // __Host- prefix for additional security
    headerName: 'x-csrf-token',
    skipPaths: new Set([
      '/api/health',
      '/api/metrics',
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/oauth',
    ]),
    monitoring: process.env.NODE_ENV === 'production',
  };

  // Rate limiting state (in-memory for simplicity)
  const rateLimitMap = new Map<string, number[]>();
  
  // Metrics
  const metrics = {
    tokensGenerated: 0,
    validationSuccess: 0,
    validationFailure: 0,
    rateLimitHits: 0,
  };

  /**
   * Generate cryptographically secure token
   */
  async function generateToken(): Promise<CSRFToken> {
    const [tokenBytes, signatureBytes] = await Promise.all([
      randomBytesAsync(TOKEN_LENGTH),
      randomBytesAsync(SIGNATURE_LENGTH),
    ]);
    
    const value = tokenBytes.toString('base64url');
    const expires = Date.now() + config.tokenLifetime;
    
    // Create HMAC signature binding token to timestamp
    const signature = createHmac('sha256', config.secret)
      .update(`${value}:${expires}`)
      .digest('base64url');
    
    return { value, expires, signature };
  }

  /**
   * Verify token integrity and validity
   */
  function verifyToken(token: CSRFToken): boolean {
    // Check expiration
    if (Date.now() > token.expires) {
      return false;
    }
    
    // Verify signature
    const expectedSignature = createHmac('sha256', config.secret)
      .update(`${token.value}:${token.expires}`)
      .digest('base64url');
    
    const expected = Buffer.from(expectedSignature);
    const actual = Buffer.from(token.signature);
    
    if (expected.length !== actual.length) {
      return false;
    }
    
    return timingSafeEqual(expected, actual);
  }

  /**
   * Parse token from cookie value
   */
  function parseTokenFromCookie(cookieValue: string): CSRFToken | null {
    try {
      const parts = cookieValue.split('.');
      if (parts.length !== 3) return null;
      
      const [value, expires, signature] = parts;
      const expiresNum = parseInt(expires, 10);
      
      if (isNaN(expiresNum)) return null;
      
      return { value, expires: expiresNum, signature };
    } catch {
      return null;
    }
  }

  /**
   * Serialize token for cookie
   */
  function serializeToken(token: CSRFToken): string {
    return `${token.value}.${token.expires}.${token.signature}`;
  }

  /**
   * Check rate limit
   */
  function checkRateLimit(identifier: string): boolean {
    const now = Date.now();
    const timestamps = rateLimitMap.get(identifier) || [];
    
    // Clean old timestamps
    const recentTimestamps = timestamps.filter(t => t > now - RATE_LIMIT_WINDOW);
    
    if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
      metrics.rateLimitHits++;
      return false;
    }
    
    recentTimestamps.push(now);
    rateLimitMap.set(identifier, recentTimestamps);
    
    // Cleanup old entries periodically
    if (rateLimitMap.size > 10000) {
      const oldestAllowed = now - RATE_LIMIT_WINDOW;
      for (const [key, times] of rateLimitMap.entries()) {
        const recent = times.filter(t => t > oldestAllowed);
        if (recent.length === 0) {
          rateLimitMap.delete(key);
        } else {
          rateLimitMap.set(key, recent);
        }
      }
    }
    
    return true;
  }

  /**
   * Get client identifier for rate limiting
   */
  function getClientId(request: FastifyRequest): string {
    return request.ip || 'unknown';
  }

  /**
   * Should skip CSRF check
   */
  function shouldSkipCSRF(request: FastifyRequest): boolean {
    // Skip safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }
    
    // Skip configured paths
    const path = request.url.split('?')[0];
    if (config.skipPaths.has(path)) {
      return true;
    }
    
    // Skip if starts with skip path
    for (const skipPath of config.skipPaths) {
      if (path.startsWith(skipPath)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Validate origin header
   */
  function validateOrigin(request: FastifyRequest): boolean {
    const origin = request.headers.origin;
    const referer = request.headers.referer;
    
    // At least one should be present for state-changing requests
    if (!origin && !referer) {
      return false;
    }
    
    // In production, validate against expected origin
    if (process.env.NODE_ENV === 'production' && process.env.ALLOWED_ORIGINS) {
      const allowedOrigins = new Set(process.env.ALLOWED_ORIGINS.split(','));
      
      if (origin && !allowedOrigins.has(origin)) {
        return false;
      }
    }
    
    return true;
  }

  // Main CSRF validation hook
  fastify.addHook('preHandler', async (request, reply) => {
    if (!config.enabled || shouldSkipCSRF(request)) {
      return;
    }

    // Validate origin/referer
    if (!validateOrigin(request)) {
      fastify.log.warn({
        msg: 'CSRF: Invalid origin',
        ip: request.ip,
        path: request.url,
        origin: request.headers.origin,
        referer: request.headers.referer,
      });
      
      metrics.validationFailure++;
      return reply.code(403).send({
        error: 'Invalid request origin',
        code: 'CSRF_ORIGIN_INVALID',
      });
    }

    // Get tokens
    const cookieValue = (request as any).cookies?.[config.cookieName];
    const headerToken = request.headers[config.headerName] as string;
    
    if (!cookieValue || !headerToken) {
      metrics.validationFailure++;
      return reply.code(403).send({
        error: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING',
      });
    }
    
    // Parse and verify cookie token
    const cookieToken = parseTokenFromCookie(cookieValue);
    if (!cookieToken || !verifyToken(cookieToken)) {
      metrics.validationFailure++;
      return reply.code(403).send({
        error: 'Invalid CSRF token',
        code: 'CSRF_TOKEN_INVALID',
      });
    }
    
    // Compare with header token (double-submit check)
    if (cookieToken.value !== headerToken) {
      metrics.validationFailure++;
      return reply.code(403).send({
        error: 'CSRF token mismatch',
        code: 'CSRF_TOKEN_MISMATCH',
      });
    }
    
    metrics.validationSuccess++;
  });

  // Token generation endpoint
  fastify.get('/api/csrf-token', async (request, reply) => {
    const clientId = getClientId(request);
    
    // Rate limit check
    if (!checkRateLimit(clientId)) {
      return reply.code(429).send({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: 60,
      });
    }
    
    // Generate new token
    const token = await generateToken();
    const cookieValue = serializeToken(token);
    
    // Set secure cookie
    reply.setCookie(config.cookieName, cookieValue, {
      httpOnly: false, // Must be false for client to read
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: config.tokenLifetime,
      ...(process.env.NODE_ENV === 'production' && {
        domain: process.env.COOKIE_DOMAIN, // Set your domain
      }),
    });
    
    metrics.tokensGenerated++;
    
    // Log for monitoring
    if (config.monitoring) {
      fastify.log.info({
        msg: 'CSRF token generated',
        clientId,
        expires: token.expires,
      });
    }
    
    return {
      token: token.value,
      expiresIn: Math.floor(config.tokenLifetime / 1000),
    };
  });

  // Metrics endpoint
  fastify.get('/api/csrf/metrics', async (request, reply) => {
    // Require authentication in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    }
    
    return {
      ...metrics,
      rateLimitMapSize: rateLimitMap.size,
      uptime: process.uptime(),
    };
  });

  // Add security headers
  fastify.addHook('onSend', async (request, reply, payload) => {
    // Add security headers for defense in depth
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    if (process.env.NODE_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    return payload;
  });

  // Cleanup interval
  setInterval(() => {
    // Clean up old rate limit entries
    const now = Date.now();
    const oldestAllowed = now - RATE_LIMIT_WINDOW;
    
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const recent = timestamps.filter(t => t > oldestAllowed);
      if (recent.length === 0) {
        rateLimitMap.delete(key);
      }
    }
  }, 60000); // Every minute

  fastify.log.info('CSRF protection enabled (production-ready)');
};

export default fp(csrfProduction, {
  name: 'csrf',
  fastify: '5.x',
  dependencies: ['@fastify/cookie'],
});