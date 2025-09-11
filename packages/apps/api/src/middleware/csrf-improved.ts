/**
 * Improved CSRF Protection Middleware
 * Implements double-submit cookie pattern with enhanced security
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import Redis from "ioredis";
import { CSRFTokenManager } from "../services/csrf-token-manager.js";
import { csrfConfig, shouldSkipCSRF } from "../config/csrf.config.js";
import { getRedisUrl } from "../utils/redis-url.js";

// Initialize Redis connection if configured
const redis = csrfConfig.useRedis ? new Redis(getRedisUrl()) : null;

// Initialize token manager
const tokenManager = new CSRFTokenManager(redis);

/**
 * CSRF Protection Plugin
 */
const csrfProtection: FastifyPluginAsync = async (fastify) => {
  // Add CSRF token generation endpoint
  fastify.get("/api/csrf-token", async (request, reply) => {
    const sessionId = tokenManager.getSessionId(request);
    const token = tokenManager.generateToken();
    
    // Store token if using stateful mode
    if (csrfConfig.useRedis) {
      await tokenManager.storeToken(sessionId, token);
    }
    
    // Set cookie with proper security attributes
    reply.setCookie(csrfConfig.cookieName, token, {
      httpOnly: csrfConfig.httpOnly,
      secure: csrfConfig.secure,
      sameSite: csrfConfig.sameSite,
      path: "/",
      maxAge: csrfConfig.tokenExpiry,
    });
    
    // Also return in response for SPA compatibility
    return { 
      token,
      expiresIn: csrfConfig.tokenExpiry,
    };
  });

  // Add CSRF validation hook
  fastify.addHook("preHandler", async (request, reply) => {
    // Skip if CSRF is disabled
    if (!csrfConfig.enabled) return;
    
    // Check if this request should skip CSRF
    if (shouldSkipCSRF(request.method, request.url)) return;
    
    // Get tokens from cookie and header
    const cookieToken = (request as any).cookies?.[csrfConfig.cookieName];
    const headerToken = request.headers[csrfConfig.headerName] as string;
    
    // Check for missing tokens
    if (!cookieToken || !headerToken) {
      return reply.code(403).send({
        error: "CSRF token missing",
        code: "CSRF_TOKEN_MISSING",
        details: {
          hasCookie: !!cookieToken,
          hasHeader: !!headerToken,
        }
      });
    }
    
    // Validate tokens match (double-submit pattern)
    const tokensMatch = tokenManager.timingSafeEqual(cookieToken, headerToken);
    
    if (!tokensMatch) {
      return reply.code(403).send({
        error: "CSRF token mismatch",
        code: "CSRF_TOKEN_MISMATCH",
      });
    }
    
    // Additional validation if using stateful storage
    if (csrfConfig.useRedis) {
      const sessionId = tokenManager.getSessionId(request);
      const isValid = await tokenManager.validateToken(sessionId, headerToken);
      
      if (!isValid) {
        return reply.code(403).send({
          error: "Invalid CSRF token",
          code: "CSRF_TOKEN_INVALID",
        });
      }
    }
  });

  // Add token rotation on authentication events
  if (csrfConfig.rotateOnAuth) {
    fastify.addHook("onRequest", async (request, reply) => {
      // Rotate token on login/logout
      if (request.url === "/api/auth/login" || request.url === "/api/auth/logout") {
        request.headers['x-rotate-csrf'] = 'true';
      }
    });
    
    fastify.addHook("onSend", async (request, reply, payload) => {
      if (request.headers['x-rotate-csrf'] === 'true') {
        const sessionId = tokenManager.getSessionId(request);
        const user = (request as any).user;
        const newToken = await tokenManager.rotateToken(sessionId, user?.id);
        
        // Set new cookie
        reply.setCookie(csrfConfig.cookieName, newToken, {
          httpOnly: csrfConfig.httpOnly,
          secure: csrfConfig.secure,
          sameSite: csrfConfig.sameSite,
          path: "/",
          maxAge: csrfConfig.tokenExpiry,
        });
      }
    });
  }

  // Add monitoring endpoint
  fastify.get("/api/csrf/stats", {
    preHandler: fastify.authenticate, // Require auth for stats
  }, async (request, reply) => {
    const stats = tokenManager.getStats();
    return {
      ...stats,
      config: {
        enabled: csrfConfig.enabled,
        useRedis: csrfConfig.useRedis,
        tokenExpiry: csrfConfig.tokenExpiry,
      },
    };
  });

  // Decorate request with CSRF utilities
  fastify.decorateRequest("csrfToken", null);
  fastify.decorateRequest("generateCSRFToken", async function(this: FastifyRequest) {
    const sessionId = tokenManager.getSessionId(this);
    const token = tokenManager.generateToken();
    
    if (csrfConfig.useRedis) {
      await tokenManager.storeToken(sessionId, token);
    }
    
    return token;
  });
};

export default fp(csrfProtection, {
  name: "csrf-protection-improved",
  fastify: "5.x",
});

// TypeScript declaration merging
declare module "fastify" {
  interface FastifyRequest {
    csrfToken: string | null;
    generateCSRFToken(): Promise<string>;
  }
}