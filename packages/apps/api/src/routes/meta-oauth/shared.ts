import type { FastifyReply, FastifyRequest } from 'fastify';

import { captureException, captureMessage } from '@postolio/observability';

import { getDatabaseClient } from '../../config/database.js';
import { redisService } from '../../services/redis.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();
export { redisService };

export const FB_GRAPH_API_VERSION = process.env.FB_GRAPH_API_VERSION || 'v24.0';
export const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || '';
export const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET || '';
export const META_REDIRECT_URI =
  process.env.META_REDIRECT_URI || 'http://localhost:3000/api/auth/meta/callback';
export const CONNECT_SESSION_TTL_SECONDS = 15 * 60;

export const fbGraph = (path: string) =>
  `https://graph.facebook.com/${FB_GRAPH_API_VERSION}/${path}`;

export interface AuthorizeQuery {
  brandId: string;
  parentOrigin?: string;
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export interface CandidatesQuery {
  connectSessionId: string;
}

export interface FinalizeBody {
  connectSessionId: string;
  candidateIds: string[];
}

export type MetaPlatform = 'instagram' | 'facebook';

export interface MetaConnectSession {
  connectSessionId: string;
  userId: string;
  brandId: string;
  state: string;
  parentOrigin?: string | null;
  createdAt: string;
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
  paging?: { next?: string };
}

export interface InstagramProfile extends Record<string, unknown> {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}

export interface MetaConnectCandidate {
  candidateId: string;
  platform: MetaPlatform;
  externalAccountId: string;
  externalPageId?: string | null;
  username?: string | null;
  displayName?: string | null;
  profilePictureUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface MetaConnectCandidateToken {
  accessToken: string;
  expiresAt: string;
  metadata?: Record<string, unknown>;
}

export type AuthedRequest = FastifyRequest & { user: { id: string; email?: string | null } };

export function ensureAuth(request: FastifyRequest, reply: FastifyReply): request is AuthedRequest {
  if (!request.user?.id) {
    reply.code(401).send({ error: 'Authentication required' });
    return false;
  }
  return true;
}

export function redactOauthSensitiveDetails(value: string): string {
  return String(value || '')
    .replace(/access_token=[^&\s"]+/gi, 'access_token=[REDACTED]')
    .replace(/client_secret=[^&\s"]+/gi, 'client_secret=[REDACTED]');
}

export function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}…`;
}

export function isMetadataDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as { disconnected?: unknown }).disconnected === true;
}

export function captureOauthMessage(message: string, context: Record<string, unknown>) {
  captureMessage(message, { module: 'meta-oauth', ...context });
}

export function captureOauthException(error: unknown, context: Record<string, unknown>) {
  captureException(error, { module: 'meta-oauth', ...context });
}

export function getPopupParentOrigin() {
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  try {
    return new URL(appUrl).origin;
  } catch {
    return '*';
  }
}

export function sendMetaPopupSuccessPage(
  reply: FastifyReply,
  payload: { connectSessionId: string },
  parentOriginOverride?: string | null
) {
  const parentOrigin = parentOriginOverride || getPopupParentOrigin();
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/brands`;
  const html = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Connected - Postolio</title></head>
    <body>
      <p>Connected. You can close this window.</p>
      <script>
        const parentOrigin = ${JSON.stringify(parentOrigin)};
        const fallbackUrl = ${JSON.stringify(fallbackUrl)};
        const payload = ${JSON.stringify(payload)};
        try { if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'META_OAUTH_SUCCESS', data: payload }, parentOrigin); } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(() => { if (!window.closed) window.location.href = fallbackUrl; }, 150);
      </script>
    </body>
  </html>`;
  reply.type('text/html').send(html);
}

export function sendMetaPopupErrorPage(
  reply: FastifyReply,
  payload: { error: string; errorDescription?: string },
  parentOriginOverride?: string | null
) {
  const parentOrigin = parentOriginOverride || getPopupParentOrigin();
  const appUrl = (process.env.APP_URL || 'https://postolio.example').replace(/\/+$/, '');
  const fallbackUrl = `${appUrl}/brands`;
  const html = `<!doctype html>
  <html lang="en">
    <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Connection Error - Postolio</title></head>
    <body>
      <p>Connection failed. You can close this window.</p>
      <script>
        const parentOrigin = ${JSON.stringify(parentOrigin)};
        const fallbackUrl = ${JSON.stringify(fallbackUrl)};
        const payload = ${JSON.stringify(payload)};
        try { if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'META_OAUTH_ERROR', data: payload }, parentOrigin); } catch (e) {}
        try { window.close(); } catch (e) {}
        setTimeout(() => { if (!window.closed) window.location.href = fallbackUrl; }, 150);
      </script>
    </body>
  </html>`;
  reply.type('text/html').send(html);
}

export function buildRedisKeys(connectSessionId: string, state?: string) {
  return {
    sessionKey: `meta:connect-session:${connectSessionId}`,
    candidatesKey: `meta:connect-candidates:${connectSessionId}`,
    tokensKey: `meta:connect-tokens:${connectSessionId}`,
    stateKey: state ? `meta:connect-state:${state}` : null,
  };
}

export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const origin = new URL(trimmed).origin;
    if (origin === 'null' || !/^https?:\/\//.test(origin)) {
      return null;
    }
    return origin;
  } catch {
    return null;
  }
}

export async function loadConnectSessionByState(state: string): Promise<MetaConnectSession | null> {
  const key = buildRedisKeys('unused', state).stateKey!;
  const raw = await redisService.get(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as MetaConnectSession;
  } catch {
    return null;
  }
}

export async function exchangeCodeForAccessToken(code: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const response = await fetch(
    `${fbGraph('oauth/access_token')}?${new URLSearchParams({
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      redirect_uri: META_REDIRECT_URI,
      code,
    }).toString()}`
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta token exchange failed: ${redactOauthSensitiveDetails(text)}`);
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Meta token exchange did not return access_token');
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const response = await fetch(
    `${fbGraph('oauth/access_token')}?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: FACEBOOK_APP_ID,
      client_secret: FACEBOOK_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    }).toString()}`
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Meta long-lived token exchange failed: ${redactOauthSensitiveDetails(text)}`);
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Meta long-lived token exchange did not return access_token');
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

export async function listAllPages(userAccessToken: string): Promise<FacebookPage[]> {
  const pages: FacebookPage[] = [];
  let nextUrl: string | undefined = fbGraph(
    `me/accounts?fields=id,name,access_token,instagram_business_account,connected_instagram_account&limit=100&access_token=${encodeURIComponent(
      userAccessToken
    )}`
  );

  let fetches = 0;
  while (nextUrl && fetches < 20) {
    const response = await fetch(nextUrl);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Meta pages fetch failed: ${redactOauthSensitiveDetails(text)}`);
    }
    const data = (await response.json()) as PagesResponse;
    if (Array.isArray(data.data)) {
      pages.push(...data.data);
    }
    nextUrl = data.paging?.next;
    fetches += 1;
  }

  return pages;
}

export async function fetchInstagramProfile(
  instagramAccountId: string,
  pageAccessToken: string
): Promise<InstagramProfile | null> {
  const response = await fetch(
    fbGraph(
      `${instagramAccountId}?fields=id,username,name,biography,followers_count,media_count,profile_picture_url&access_token=${encodeURIComponent(
        pageAccessToken
      )}`
    )
  );
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as InstagramProfile;
}
