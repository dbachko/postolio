import type { FastifyReply, FastifyRequest } from 'fastify';
import { EventBridge } from '@aws-sdk/client-eventbridge';
import { captureException, captureMessage } from '@postolio/observability';

import { getDatabaseClient } from '../../config/database.js';
import { TokenServiceClient } from '../../clients/token-service-client.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();
export const tokenServiceClient = new TokenServiceClient();
export const eventBridge = new EventBridge({});

export const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'default';
export const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
export const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
export const REDIRECT_URI =
  process.env.INSTAGRAM_REDIRECT_URI || 'http://localhost:3000/api/auth/instagram/callback';
export const FB_OAUTH_DEBUG_ENABLED = (process.env.FB_OAUTH_DEBUG || '').toLowerCase() === 'true';

export interface AuthorizeQuery {
  brandId: string;
  redirectUri?: string;
}

export interface CallbackQuery {
  code: string;
  state: string;
  error?: string;
  error_description?: string;
}

export interface FacebookPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string };
  connected_instagram_account?: { id: string };
}

export interface PagesResponse {
  data?: FacebookPage[];
  paging?: {
    next?: string;
  };
}

export interface InstagramProfile extends Record<string, unknown> {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  account_type?: string;
}

export interface ParsedFacebookGraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
}

export function ensureAuth(
  request: FastifyRequest,
  reply: FastifyReply
): request is FastifyRequest & { user: { id: string } } {
  if (!request.user?.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

export function summarizeFacebookPages(pages: FacebookPage[]) {
  const maxPages = 50;
  const items = pages.slice(0, maxPages).map((page) => ({
    id: page.id,
    name: page.name,
    hasAccessToken: !!page.access_token,
    instagramBusinessAccountId: page.instagram_business_account?.id || null,
    connectedInstagramAccountId: page.connected_instagram_account?.id || null,
  }));

  return {
    count: pages.length,
    items,
    truncated: pages.length > maxPages,
  };
}

export function redactOauthSensitiveDetails(value: string): string {
  return String(value || '')
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
    .replace(/client_secret=[^&\s"]+/gi, 'client_secret=[REDACTED]');
}

export function parseFacebookGraphError(raw: string): ParsedFacebookGraphError | null {
  try {
    const parsed = JSON.parse(raw) as { error?: ParsedFacebookGraphError };
    if (!parsed?.error || typeof parsed.error !== 'object') {
      return null;
    }
    return parsed.error;
  } catch {
    return null;
  }
}

export function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

export function captureOauthMessage(message: string, context: Record<string, unknown>) {
  captureMessage(message, { module: 'instagram-oauth', ...context });
}

export function captureOauthException(error: unknown, context: Record<string, unknown>) {
  captureException(error, { module: 'instagram-oauth', ...context });
}

export function classifyFacebookGraphError(err: ParsedFacebookGraphError | null, fallback: string) {
  const description =
    err?.error_user_msg || err?.message || redactOauthSensitiveDetails(fallback) || 'Unknown error';

  const messageLower = description.toLowerCase();
  const code = err?.code;

  if (
    code === 10 ||
    code === 200 ||
    messageLower.includes('permission') ||
    messageLower.includes('permissions')
  ) {
    return { code: 'missing_permissions', description };
  }

  if (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 613 ||
    messageLower.includes('rate limit') ||
    messageLower.includes('too many')
  ) {
    return { code: 'rate_limited', description };
  }

  if (messageLower.includes('restricted') || messageLower.includes('violation')) {
    return { code: 'account_restricted', description };
  }

  return { code: 'default', description };
}
