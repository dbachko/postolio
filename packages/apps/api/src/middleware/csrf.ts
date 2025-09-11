import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import csrfProtection from "@fastify/csrf-protection";

const csrf: FastifyPluginAsync = async (fastify) => {
  const DISABLE_CSRF = process.env.DISABLE_CSRF === 'true';
  
  if (DISABLE_CSRF) {
    fastify.log.warn('CSRF protection is disabled');
    return;
  }

  // Register the official CSRF protection plugin
  await fastify.register(csrfProtection, {
    cookieKey: 'csrf-token',
    cookieOpts: {
      httpOnly: false, // Must be false so JS can read it for double-submit
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 3600000 // 1 hour
    },
    getToken: (req: any) => {
      // Support token in header (primary) or body
      return req.headers['x-csrf-token'] || req.body?._csrf;
    }
  });

  // Skip paths that don't need CSRF protection
  const skipPaths = [
    '/api/csrf-token',
    '/api/health',
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/google/authorize',
    '/api/auth/instagram/authorize',
    '/api/auth/instagram/callback',
    '/api/auth/refresh',
    '/api/auth/verify',
    '/api/auth/oauth/google',
    '/api/auth/oauth/google/callback',
    '/api/auth/magic-link',
    '/api/auth/magic-link/verify',
  ];

  // Apply CSRF protection to state-changing methods
  fastify.addHook('preHandler', async (request, reply) => {
    // Skip for safe methods
    if (request.method === 'GET' || 
        request.method === 'HEAD' || 
        request.method === 'OPTIONS') {
      return;
    }

    // Skip for exempted paths
    if (skipPaths.some(path => request.url.startsWith(path))) {
      return;
    }

    // Apply CSRF protection
    try {
      await (fastify as any).csrfProtection(request, reply, () => {});
    } catch (err) {
      return reply.code(403).send({ 
        error: 'Invalid CSRF token',
        code: 'CSRF_TOKEN_INVALID'
      });
    }
  });

  // CSRF token generation endpoint
  fastify.get("/api/csrf-token", async (request, reply) => {
    const token = await reply.generateCsrf();
    
    // Token is automatically set in cookie by the plugin
    // Return it for the client to use in headers
    return { 
      token,
      expiresIn: 3600 // seconds
    };
  });
};

export default fp(csrf, {
  name: "csrf",
  fastify: "5.x",
});