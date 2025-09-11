/**
 * CSRF Auto-Protection Plugin
 * 
 * Automatically protects all state-changing routes with CSRF validation,
 * except for explicitly skipped paths (OAuth callbacks, health checks, etc.)
 */

import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

// Routes that should NEVER have CSRF protection
// These are typically external callbacks or health endpoints
const CSRF_SKIP_PATHS = [
  '/api/health',
  '/api/metrics',
  '/api/csrf-token',
  '/api/auth/refresh',
  '/api/auth/magic-link/verify',
  '/api/auth/google/callback',
  '/api/auth/facebook/callback', 
  '/api/auth/instagram/authorize',
  '/api/auth/instagram/callback',
  '/api/webhook',  // External webhooks
];

const csrfAutoProtectPlugin: FastifyPluginAsync = async (fastify) => {
  // Track which routes we've protected for logging
  const protectedRoutes: string[] = [];
  const skippedRoutes: string[] = [];

  // Add CSRF protection to all state-changing routes automatically
  fastify.addHook('onRoute', (routeOptions) => {
    // Only protect POST, PUT, DELETE, PATCH methods
    const needsProtection = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(
      Array.isArray(routeOptions.method) ? routeOptions.method[0] : routeOptions.method
    );

    if (!needsProtection) return;

    // Check if this path should be skipped
    const shouldSkip = CSRF_SKIP_PATHS.some(skipPath => 
      routeOptions.url.startsWith(skipPath) || 
      routeOptions.path.startsWith(skipPath)
    );

    if (shouldSkip) {
      skippedRoutes.push(`${routeOptions.method} ${routeOptions.path}`);
      return;
    }

    // Check if route already has preHandler
    const existingPreHandler = routeOptions.preHandler;
    
    // Add CSRF protection
    if (!existingPreHandler) {
      routeOptions.preHandler = fastify.csrfProtection;
    } else if (Array.isArray(existingPreHandler)) {
      // Don't add if already present
      if (!existingPreHandler.includes(fastify.csrfProtection)) {
        existingPreHandler.unshift(fastify.csrfProtection);
      }
    } else {
      // Convert single handler to array with CSRF first
      routeOptions.preHandler = [fastify.csrfProtection, existingPreHandler];
    }

    protectedRoutes.push(`${routeOptions.method} ${routeOptions.path}`);
  });

  // Add error handler for CSRF failures with logging
  fastify.setErrorHandler((error, request, reply) => {
    // Check if this is a CSRF error
    if (error.message?.includes('csrf') || error.message?.includes('CSRF')) {
      // Log the failure for security monitoring
      fastify.log.warn({
        type: 'CSRF_FAILURE',
        ip: request.ip,
        path: request.url,
        method: request.method,
        userAgent: request.headers['user-agent'],
        referer: request.headers.referer,
        origin: request.headers.origin,
        timestamp: new Date().toISOString(),
      }, 'CSRF validation failed - possible attack');

      return reply.code(403).send({
        error: 'Invalid or missing CSRF token',
        code: 'CSRF_VALIDATION_FAILED'
      });
    }

    // Pass through other errors
    return reply.send(error);
  });

  // Log protected routes on startup
  fastify.addHook('onReady', async () => {
    fastify.log.info({
      protectedCount: protectedRoutes.length,
      skippedCount: skippedRoutes.length,
      protected: protectedRoutes,
      skipped: skippedRoutes
    }, 'CSRF protection applied to routes');
  });
};

export default fp(csrfAutoProtectPlugin, {
  name: 'csrf-auto-protect',
  dependencies: ['@fastify/csrf-protection'],
});