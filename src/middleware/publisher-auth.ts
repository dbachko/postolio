/**
 * Publisher Authentication Middleware
 * Provides secure authentication for Lambda-to-API communication
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';

export interface PublisherAuthOptions {
  apiKey: string;
  allowedIPs?: string[];
  requireHttps?: boolean;
}

/**
 * Create publisher authentication middleware
 */
export function createPublisherAuth(options: PublisherAuthOptions) {
  return async function authenticatePublisher(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    // 1. Require HTTPS in production
    if (options.requireHttps && request.protocol !== 'https') {
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'HTTPS required'
      });
    }

    // 2. Check API key
    const providedKey = request.headers['x-api-key'] as string;
    
    if (!providedKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'API key required'
      });
    }

    // 3. Constant-time comparison to prevent timing attacks
    const providedKeyBuffer = Buffer.from(providedKey);
    const expectedKeyBuffer = Buffer.from(options.apiKey);
    
    if (providedKeyBuffer.length !== expectedKeyBuffer.length) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
    }

    const isValid = crypto.timingSafeEqual(providedKeyBuffer, expectedKeyBuffer);
    
    if (!isValid) {
      // Log failed attempts for security monitoring
      request.log.warn({
        event: 'publisher_auth_failed',
        ip: request.ip,
        timestamp: new Date().toISOString()
      });
      
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key'
      });
    }

    // 4. Optional IP allowlist
    if (options.allowedIPs && options.allowedIPs.length > 0) {
      const clientIP = request.ip;
      if (!options.allowedIPs.includes(clientIP)) {
        request.log.warn({
          event: 'publisher_ip_blocked',
          ip: clientIP,
          timestamp: new Date().toISOString()
        });
        
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'IP not allowed'
        });
      }
    }

    // Authentication successful
    request.log.info({
      event: 'publisher_auth_success',
      ip: request.ip,
      timestamp: new Date().toISOString()
    });
  };
}