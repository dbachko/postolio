import { getDatabaseClient } from '../../config/database.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export type TokenStatus = 'healthy' | 'expiring' | 'expired' | 'unknown' | 'disconnected';

export function normalizePreferences(preferences: unknown): Record<string, unknown> {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return {};
  }
  return preferences as Record<string, unknown>;
}

export function normalizeDefaultPostSocialAccountIds(
  preferences: Record<string, unknown>
): string[] {
  const raw = (preferences as { defaultPostSocialAccountIds?: unknown })
    .defaultPostSocialAccountIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') {
      continue;
    }
    const id = value.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const id = item.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }
  return (metadata as { disconnected?: unknown }).disconnected === true;
}

function extractTokenExpiresAt(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const direct = (metadata as { tokenExpiresAt?: unknown }).tokenExpiresAt;
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  const nested = (metadata as { token?: { expiresAt?: unknown } }).token?.expiresAt;
  if (typeof nested === 'string' && nested.trim()) {
    return nested.trim();
  }
  return null;
}

export function computeTokenStatus(metadata: unknown): {
  tokenExpiresAt: string | null;
  tokenStatus: TokenStatus;
} {
  const tokenExpiresAt = extractTokenExpiresAt(metadata);
  if (isDisconnected(metadata)) {
    return { tokenExpiresAt, tokenStatus: 'disconnected' };
  }
  if (!tokenExpiresAt) {
    return { tokenExpiresAt: null, tokenStatus: 'unknown' };
  }
  const expiryDate = new Date(tokenExpiresAt);
  if (Number.isNaN(expiryDate.getTime())) {
    return { tokenExpiresAt, tokenStatus: 'unknown' };
  }
  const now = Date.now();
  const expiresAtMs = expiryDate.getTime();
  if (expiresAtMs <= now) {
    return { tokenExpiresAt, tokenStatus: 'expired' };
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  if (expiresAtMs - now <= sevenDaysMs) {
    return { tokenExpiresAt, tokenStatus: 'expiring' };
  }
  return { tokenExpiresAt, tokenStatus: 'healthy' };
}

export function resolveProfilePictureUrl(metadata: unknown) {
  const meta =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const profileData =
    meta.profileData && typeof meta.profileData === 'object' && !Array.isArray(meta.profileData)
      ? (meta.profileData as Record<string, unknown>)
      : null;
  const direct = meta.profile_picture_url;
  if (typeof direct === 'string' && direct) {
    return direct;
  }
  const nested = profileData?.profile_picture_url;
  if (typeof nested === 'string' && nested) {
    return nested;
  }
  return null;
}

export function resolveParentOrigin(headers: { origin?: string; referer?: string }) {
  if (typeof headers.origin === 'string' && headers.origin.trim()) {
    try {
      return new URL(headers.origin).origin;
    } catch {
      // ignore invalid origin
    }
  }
  if (typeof headers.referer === 'string' && headers.referer.trim()) {
    try {
      return new URL(headers.referer).origin;
    } catch {
      // ignore invalid referer
    }
  }
  return null;
}
