import type { FastifyRequest } from 'fastify';
import { AuditLogger, AuditEventType } from './audit-logger.js';

export type OAuthPlatform = 'instagram' | 'facebook' | 'google';

export type OAuthEventType =
  'authorize_started' | 'callback_received' | 'connection_success' | 'connection_error';

export interface OAuthAuditEvent {
  platform: OAuthPlatform;
  event: OAuthEventType;
  userId?: string;
  email?: string;
  brandId?: string;
  error?: string;
  errorCode?: string;
  errorDescription?: string;
  metadata?: Record<string, unknown>;
}

export class OAuthAuditService {
  static async trackEvent(params: {
    event: OAuthAuditEvent;
    request?: FastifyRequest;
  }): Promise<void> {
    const { event, request } = params;
    const {
      platform,
      event: phase,
      userId,
      email,
      brandId,
      error,
      errorCode,
      errorDescription,
    } = event;

    const metadata: Record<string, unknown> = {
      platform,
      phase,
      brandId,
      error,
      errorCode,
      errorDescription,
      ...(event.metadata || {}),
    };

    const success = phase === 'connection_success';

    await AuditLogger.log({
      userId,
      email,
      eventType: AuditEventType.OAUTH_LINK,
      request,
      metadata,
      success,
      errorMessage: success ? undefined : errorDescription || error,
    });
  }
}
