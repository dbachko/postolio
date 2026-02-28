import type { FastifyInstance } from 'fastify';
import type { AssetRecord } from '@postolio/assets-client';
import { validateContentPayload } from '@postolio/content-validation';
import { getAssetsClient } from '../../../services/assets-media.js';
import { toValidationPlatform } from '../../../utils/platform.js';
import {
  ensureAssetsBelongToBrand,
  isDisconnected,
  prisma,
  resetGenerationParamsForDestination,
} from './shared.js';

export type ResolvedAccount = { id: string; platform: string; metadata: unknown };

export async function resolveAccountsToAdd(params: {
  group: { brandId: string; contents: Array<{ targetSocialAccountId?: string | null }> };
  targetSocialAccountIds: string[];
}) {
  const destinations = params.group.contents.filter((entry) => entry.targetSocialAccountId);
  const existingIds = new Set(
    destinations
      .map((entry) =>
        typeof entry.targetSocialAccountId === 'string' ? entry.targetSocialAccountId.trim() : ''
      )
      .filter((id) => id.length > 0)
  );
  const uniqueRequestedIds = Array.from(new Set(params.targetSocialAccountIds));
  const toAdd = uniqueRequestedIds.filter((id) => !existingIds.has(id));
  if (toAdd.length === 0) {
    return { toAdd, invalid: [] as string[], resolvedAccounts: [] as ResolvedAccount[] };
  }
  const accounts = await prisma.socialAccount.findMany({
    where: { brandId: params.group.brandId, id: { in: toAdd } },
    select: { id: true, platform: true, metadata: true },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const invalid: string[] = [];
  const resolvedAccounts: ResolvedAccount[] = [];
  for (const id of toAdd) {
    const account = byId.get(id);
    if (!account || isDisconnected(account.metadata)) {
      invalid.push(id);
      continue;
    }
    resolvedAccounts.push({
      id: account.id,
      platform: String(account.platform),
      metadata: account.metadata,
    });
  }
  return { toAdd, invalid, resolvedAccounts };
}

export async function resolveTemplateAssets(params: {
  request: { log: { error: (ctx: unknown, message: string) => void } };
  contentGroupId: string;
  brandId: string;
  templateAssetIds: string[];
}): Promise<{ ok: true; assets: AssetRecord[] } | { ok: false; status: number; error: string }> {
  if (params.templateAssetIds.length === 0) {
    return { ok: true, assets: [] };
  }
  let assets: Array<AssetRecord | null>;
  try {
    assets = await getAssetsClient().getBatchAssets(params.templateAssetIds);
  } catch (error) {
    params.request.log.error(
      { err: error, contentGroupId: params.contentGroupId },
      'Failed to fetch template media assets'
    );
    return { ok: false, status: 400, error: 'Failed to fetch media assets. Please try again.' };
  }
  const ownership = await ensureAssetsBelongToBrand(
    params.templateAssetIds,
    params.brandId,
    assets
  );
  if (!ownership.ok) {
    return {
      ok: false,
      status: ownership.error.startsWith('Assets not found:') ? 404 : 400,
      error: ownership.error,
    };
  }
  return { ok: true, assets: ownership.assets };
}

export function validateResolvedAccounts(params: {
  resolvedAccounts: ResolvedAccount[];
  contentType: string;
  caption: string;
  mediaAssetsForValidation: Array<{ key: string; type: 'image' | 'video' }>;
}) {
  const mediaTypeHint =
    params.contentType === 'reel' ||
    params.mediaAssetsForValidation.some((asset) => asset.type === 'video')
      ? 'video'
      : params.mediaAssetsForValidation.length > 0
        ? 'image'
        : undefined;
  for (const account of params.resolvedAccounts) {
    const validationPlatform = toValidationPlatform(account.platform);
    if (!validationPlatform) {
      return {
        ok: false as const,
        error: 'unsupported_platform',
        message: `Platform ${account.platform} is not supported for content creation yet`,
      };
    }
    const validation = validateContentPayload({
      platform: validationPlatform,
      contentType: params.contentType as any,
      mediaType: mediaTypeHint as any,
      caption: params.contentType === 'story' ? '' : params.caption,
      mediaAssets: params.mediaAssetsForValidation,
    });
    if (!validation.ok) {
      return {
        ok: false as const,
        error: 'invalid_content',
        message: validation.errors[0]?.message || 'Invalid content payload',
        platform: account.platform,
        details: validation.errors,
      };
    }
  }
  return { ok: true as const };
}

export function resolveScheduledAtToApply(
  destinations: Array<{ scheduledAt?: Date | null }>
): string | null {
  const scheduledValues = destinations.map((entry) =>
    entry.scheduledAt ? entry.scheduledAt.toISOString() : null
  );
  const nonNull = scheduledValues.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  if (scheduledValues.length === 0 || nonNull.length !== scheduledValues.length) {
    return null;
  }
  return nonNull.every((value) => value === nonNull[0]) ? nonNull[0] : null;
}

export async function createDestinationRows(params: {
  group: { brandId: string; id: string };
  resolvedAccounts: ResolvedAccount[];
  caption: string;
  hashtags: string[];
  contentType: string;
  shareToFeed: boolean | null;
  thumbOffset: number | null;
  firstComment: string | null;
  resolvedAssets: AssetRecord[];
}) {
  const created: Array<{ contentId: string; targetSocialAccountId: string }> = [];
  const createdIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const account of params.resolvedAccounts) {
      const row = await tx.content.create({
        data: {
          caption: params.caption,
          hashtags: params.hashtags,
          status: 'draft',
          brandId: params.group.brandId,
          contentGroupId: params.group.id,
          scheduledAt: null,
          postedAt: null,
          contentType: params.contentType || 'post',
          shareToFeed: params.shareToFeed,
          thumbOffset: params.thumbOffset,
          firstComment: params.firstComment,
          targetSocialAccountId: account.id,
          generationParams: resetGenerationParamsForDestination(),
        },
        select: { id: true },
      });
      created.push({ contentId: row.id, targetSocialAccountId: account.id });
      createdIds.push(row.id);
    }
    if (params.resolvedAssets.length > 0 && createdIds.length > 0) {
      await tx.contentMediaAsset.createMany({
        data: createdIds.flatMap((contentId) =>
          params.resolvedAssets.map((asset, idx) => ({
            contentId,
            assetId: asset.id,
            displayOrder: idx,
          }))
        ),
      });
    }
  });
  return { created, createdIds };
}

export async function applySchedulingToCreatedDestinations(params: {
  fastify: FastifyInstance;
  contentIds: string[];
  headers: Record<string, string>;
  scheduledAtToApply: string;
}) {
  const results: Array<{ contentId: string; ok: boolean; statusCode: number; error?: unknown }> =
    [];
  for (const contentId of params.contentIds) {
    const response = await params.fastify.inject({
      method: 'PUT',
      url: `/api/content/${encodeURIComponent(contentId)}`,
      headers: params.headers,
      payload: { scheduledAt: params.scheduledAtToApply },
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      results.push({ contentId, ok: true, statusCode: response.statusCode });
      continue;
    }
    let errorPayload: unknown = null;
    try {
      errorPayload = response.json();
    } catch {
      errorPayload = response.payload || null;
    }
    results.push({ contentId, ok: false, statusCode: response.statusCode, error: errorPayload });
  }
  return results;
}
