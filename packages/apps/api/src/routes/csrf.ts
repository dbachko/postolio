/**
 * CSRF Token Management Routes
 *
 * Provides endpoints for CSRF token generation and validation.
 */

import { FastifyPluginAsync } from 'fastify';

const csrfRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Generate CSRF token endpoint
   * Frontend calls this to get a fresh CSRF token
   */
  fastify.get('/csrf-token', async (request, reply) => {
    const token = reply.generateCsrf();

    return {
      token,
      expiresIn: 3600, // 1 hour (this is informational, actual expiry is managed by the plugin)
    };
  });

  /**
   * Verify CSRF token endpoint (optional, for testing)
   * This endpoint is automatically protected by CSRF
   */
  fastify.post('/csrf-verify', async () => {
    return {
      success: true,
      message: 'CSRF token is valid',
    };
  });
};

export default csrfRoutes;
