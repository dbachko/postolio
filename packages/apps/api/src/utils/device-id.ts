import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProductionEnv } from '../utils/env-mode.js';
import { getUserAgent } from './request-info.js';

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
    const ua = getUserAgent(request) || '';
    // Deterministic derivation matching existing logic
    deviceId = Buffer.from(ua).toString('hex').slice(0, 32);
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
