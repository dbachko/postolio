import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AssetRecord } from '@postolio/assets-client';
import { Prisma } from '@postolio/database';
import { getDatabaseClient } from '../../../config/database.js';
import { isMultiDestinationEnabledForUser } from '../../../utils/feature-flags.js';
import { extractHashtagsFromCaption } from '../../../utils/hashtag-extractor.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export type AuthenticatedRequest = FastifyRequest & {
  user?: {
    id?: string;
    email?: string | null;
  };
};

export function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as any).disconnected);
}

export function getProfilePictureUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const meta = metadata as Record<string, unknown>;
  const direct = meta.profile_picture_url;
  if (typeof direct === 'string' && direct) {
    return direct;
  }
  const profileData =
    meta.profileData && typeof meta.profileData === 'object' && !Array.isArray(meta.profileData)
      ? (meta.profileData as Record<string, unknown>)
      : null;
  const nested = profileData?.profile_picture_url;
  return typeof nested === 'string' && nested ? nested : null;
}

export function sendMultiDestinationDisabled(reply: FastifyReply) {
  return reply.code(403).send({
    error: 'feature_disabled',
    code: 'MULTI_DESTINATION_DISABLED',
    message: 'Multiple destinations are not enabled for this account',
  });
}

export function ensureMultiDestinationEnabled(
  request: AuthenticatedRequest,
  reply: FastifyReply
): boolean {
  const enabled = isMultiDestinationEnabledForUser({
    userId: request.user?.id,
    email: request.user?.email,
  });
  if (enabled) {
    return true;
  }
  void sendMultiDestinationDisabled(reply);
  return false;
}

export function parseTargetSocialAccountIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((value: unknown): value is string => typeof value === 'string')
    .map((value: string) => value.trim())
    .filter((value: string) => value.length > 0);
}

export function buildForwardAuthHeaders(
  headers: FastifyRequest['headers']
): Record<string, string> {
  const next: Record<string, string> = {};
  if (typeof headers.cookie === 'string') {
    next.cookie = headers.cookie;
  }
  if (typeof headers.authorization === 'string') {
    next.authorization = headers.authorization;
  }
  if (typeof headers['csrf-token'] === 'string') {
    next['csrf-token'] = headers['csrf-token'];
  }
  return next;
}

export type GroupTemplate = {
  caption: string;
  contentType: string;
  shareToFeed: boolean | null;
  firstComment: string | null;
  thumbOffset: number | null;
  assetIds: string[];
  initialized: boolean;
};

export function resolveTemplateFromGroup(group: {
  templateInitialized: boolean | null;
  templateCaption: string | null;
  templateContentType: string | null;
  templateShareToFeed: boolean | null;
  templateFirstComment: string | null;
  templateThumbOffset: number | null;
  templateAssetIds: string[] | null;
}): GroupTemplate {
  return {
    initialized: group.templateInitialized === true,
    caption: group.templateCaption ?? '',
    contentType: group.templateContentType ?? 'post',
    shareToFeed: group.templateShareToFeed ?? null,
    firstComment: group.templateFirstComment ?? null,
    thumbOffset: group.templateThumbOffset ?? null,
    assetIds: Array.isArray(group.templateAssetIds) ? group.templateAssetIds : [],
  };
}

export function deriveTemplateFromDestination(params: {
  templateInitialized: boolean | null;
  templateCaption: string | null;
  templateContentType: string | null;
  templateShareToFeed: boolean | null;
  templateFirstComment: string | null;
  templateThumbOffset: number | null;
  templateAssetIds: string[] | null;
  destination: {
    caption: string | null;
    contentType: string | null;
    shareToFeed: boolean | null;
    firstComment: string | null;
    thumbOffset: number | null;
    mediaAssets: Array<{ assetId: string; displayOrder: number | null }>;
  };
}): GroupTemplate {
  if (params.templateInitialized === true) {
    return resolveTemplateFromGroup(params);
  }
  return {
    initialized: false,
    caption: params.destination.caption ?? '',
    contentType: params.destination.contentType ?? 'post',
    shareToFeed: params.destination.shareToFeed ?? null,
    firstComment: params.destination.firstComment ?? null,
    thumbOffset: params.destination.thumbOffset ?? null,
    assetIds: params.destination.mediaAssets
      .slice()
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((asset) => asset.assetId),
  };
}

export async function ensureAssetsBelongToBrand(
  assetIds: string[],
  brandId: string,
  assets: Array<AssetRecord | null>
): Promise<{ ok: true; assets: AssetRecord[] } | { ok: false; error: string }> {
  const missing = assets
    .map((asset, idx) => (!asset ? assetIds[idx] : null))
    .filter((id): id is string => Boolean(id));
  if (missing.length > 0) {
    return { ok: false, error: `Assets not found: ${missing.join(', ')}` };
  }
  const resolved = assets.filter(Boolean) as AssetRecord[];
  const invalid = resolved.filter((asset) => asset.brandId !== brandId);
  if (invalid.length > 0) {
    return {
      ok: false,
      error: 'All media assets must belong to the same brand as the content group',
    };
  }
  return { ok: true, assets: resolved };
}

export function normalizeThumbOffset(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, value);
}

export function toFirstComment(value: unknown, contentType: string): string | null {
  if (contentType === 'story') {
    return null;
  }
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function toCaptionAndHashtags(caption: string, contentType: string) {
  const normalizedCaption = contentType === 'story' ? '' : caption.trim();
  return {
    caption: normalizedCaption,
    hashtags: extractHashtagsFromCaption(normalizedCaption),
  };
}

export function resetGenerationParamsForDestination() {
  return Prisma.JsonNull;
}
