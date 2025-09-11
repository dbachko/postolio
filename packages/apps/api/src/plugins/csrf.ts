/**
 * CSRF Plugin Decorator
 * 
 * Adds CSRF protection methods to the Fastify instance
 * for easy use in route handlers.
 */

import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

// Type declarations are provided by @fastify/csrf-protection
// No need to redeclare them here

/**
 * Helper function to determine if a route should be protected
 * @param path - The request path
 * @returns true if the route should skip CSRF protection
 */
export function shouldSkipCSRF(path: string): boolean {
  const skipPaths = [
    "/api/health",
    "/api/metrics",
    "/api/csrf-token",
    "/api/auth/refresh",
    "/api/auth/magic-link/verify",
    "/api/auth/google/callback",
    "/api/auth/facebook/callback",
    "/api/auth/instagram/authorize",
    "/api/auth/instagram/callback",
  ];
  
  return skipPaths.some(skipPath => path.startsWith(skipPath));
}

const csrfPlugin: FastifyPluginAsync = async () => {
  // The @fastify/csrf-protection plugin already adds these methods
  // This plugin just provides TypeScript declarations and helper functions
  
  // Optional: Add a global hook for CSRF protection on all POST/PUT/DELETE/PATCH routes
  // Uncomment if you want automatic protection for all state-changing routes
  /*
  fastify.addHook("preHandler", async (request, reply) => {
    const isStateChanging = ["POST", "PUT", "DELETE", "PATCH"].includes(request.method);
    const shouldProtect = isStateChanging && !shouldSkipCSRF(request.url);
    
    if (shouldProtect && fastify.csrfProtection) {
      await fastify.csrfProtection(request, reply);
    }
  });
  */
};

export default fp(csrfPlugin, {
  name: "csrf-decorator",
  dependencies: ["@fastify/csrf-protection"],
});