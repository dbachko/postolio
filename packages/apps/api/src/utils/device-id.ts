import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProductionEnv } from '../utils/env-mode.js';
import { randomBytes } from 'crypto';

/**
 * Resolve a stable device identifier and ensure the durable cookie is set.
 * Priority: cookie `device_id` > provided fingerprint > derived from user-agent.
 * Returns the resolved device id (string).
 */
export function ensureDeviceId(
  request: FastifyRequest,
  reply: FastifyReply,
  providedFingerprint?: string
): string {
  let deviceId = request.cookies?.device_id || providedFingerprint;

  if (!deviceId) {
    // Generate a durable, cryptographically-strong device identifier
    // This avoids collisions from user-agent–derived values on mobile
    deviceId = randomBytes(16).toString('hex'); // 32 hex chars
  }

  if (!request.cookies?.device_id && deviceId) {
    reply.setCookie('device_id', deviceId, {
      httpOnly: true,
      secure: isProductionEnv(),
      sameSite: 'lax',
      path: '/',
      maxAge: 365 * 24 * 60 * 60, // 1 year
    });
  }

  return deviceId;
}
