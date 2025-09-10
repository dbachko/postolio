import { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { randomBytes } from "crypto";
import Redis from "ioredis";
import { getRedisUrl } from "../utils/redis-url.js";

const redis = new Redis(getRedisUrl());

interface CSRFOptions {
  secret?: string;
  cookieName?: string;
  headerName?: string;
  sessionKey?: string;
  tokenLength?: number;
  ignoreMethods?: string[];
  expiryTime?: number;
}

/**
 * CSRF Protection Middleware
 * Implements double-submit cookie pattern for CSRF protection
 */
const csrfPlugin: FastifyPluginAsync<CSRFOptions> = async (
  fastify,
  options = {},
) => {
  const {
    cookieName = "csrf-token",
    headerName = "x-csrf-token",
    tokenLength = 32,
    ignoreMethods = ["GET", "HEAD", "OPTIONS"],
    expiryTime = 3600, // 1 hour in seconds
  } = options;

  // Generate CSRF token
  function generateToken(): string {
    return randomBytes(tokenLength).toString("hex");
  }

  // Store token in Redis with expiry
  async function storeToken(sessionId: string, token: string): Promise<void> {
    const key = `csrf:${sessionId}`;
    await redis.setex(key, expiryTime, token);
  }

  // Validate token from Redis
  async function validateToken(
    sessionId: string,
    token: string,
  ): Promise<boolean> {
    const key = `csrf:${sessionId}`;
    const storedToken = await redis.get(key);

    // Constant-time comparison to prevent timing attacks
    if (!storedToken || storedToken.length !== token.length) {
      return false;
    }

    let valid = true;
    for (let i = 0; i < storedToken.length; i++) {
      if (storedToken[i] !== token[i]) {
        valid = false;
      }
    }

    return valid;
  }

  // Get or create session ID
  function getSessionId(request: FastifyRequest): string {
    // Try to get from JWT if authenticated
    if ((request as FastifyRequest & { user?: { id?: string } }).user?.id) {
      return `user:${request.user.id}`;
    }

    // Try to get from session
    const withSession = request as FastifyRequest & {
      session?: { id?: string };
    };
    if (withSession.session?.id) {
      return `session:${withSession.session.id}`;
    }

    // Fallback to IP-based session
    const ip = request.ip || "unknown";
    return `ip:${ip}`;
  }

  // Add CSRF token generation endpoint
  fastify.get("/api/csrf-token", async (request, reply) => {
    const sessionId = getSessionId(request);
    const token = generateToken();

    // Store token in Redis
    await storeToken(sessionId, token);

    // Set cookie with token
    reply.setCookie(cookieName, token, {
      httpOnly: false, // Must be accessible to JavaScript
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: expiryTime,
    });

    return { token };
  });

  // Add CSRF validation hook
  fastify.addHook("preHandler", async (request, reply) => {
    // Skip CSRF check for ignored methods
    if (ignoreMethods.includes(request.method)) {
      return;
    }

    // Skip CSRF check for auth endpoints that don't have sessions yet
    const skipPaths = [
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/google/callback",
      "/api/auth/facebook/callback",
      "/api/auth/magic-link/request",
      "/api/auth/magic-link/verify",
      "/api/csrf-token",
    ];

    if (skipPaths.some((path) => request.url.startsWith(path))) {
      return;
    }

    // Get session ID
    const sessionId = getSessionId(request);

    // Get token from header or body
    const headerToken = request.headers[headerName] as string;
    const bodyToken = (request.body as { _csrf?: string } | undefined)?._csrf;
    const token = headerToken || bodyToken;

    if (!token) {
      return reply.code(403).send({
        error: "CSRF token missing",
        code: "CSRF_TOKEN_MISSING",
      });
    }

    // Validate token
    const valid = await validateToken(sessionId, token);

    if (!valid) {
      return reply.code(403).send({
        error: "Invalid CSRF token",
        code: "CSRF_TOKEN_INVALID",
      });
    }
  });

  // Decorate request with CSRF token generation method
  fastify.decorateRequest(
    "generateCSRFToken",
    async function (this: FastifyRequest) {
      const sessionId = getSessionId(this as FastifyRequest);
      const token = generateToken();
      await storeToken(sessionId, token);
      return token;
    },
  );
};

export default fp(csrfPlugin, {
  name: "csrf-protection",
  fastify: "5.x",
});

// TypeScript declaration merging
declare module "fastify" {
  interface FastifyRequest {
    generateCSRFToken(): Promise<string>;
  }
}
