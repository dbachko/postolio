import { useMemo } from 'react';

import type { InstagramContentType } from '@postolio/content-validation';
import type { PostPreviewAccount } from '@/components/post-preview/types';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import type { Platform } from '@/lib/platform-config';

import { normalizePreviewContentType } from '../utils';

export type ContentGroupTemplate = {
  initialized: boolean;
  caption: string;
  contentType: InstagramContentType;
  shareToFeed: boolean | null;
  firstComment: string | null;
  thumbOffset: number | null;
  assetIds: string[];
};

export type ContentGroupSchedule =
  | { kind: 'none'; scheduledAt: null }
  | { kind: 'uniform'; scheduledAt: string }
  | { kind: 'mixed'; scheduledAt: null };

export type GroupDestinationPreviewData = {
  contentId: string;
  account: PostPreviewAccount;
  content: {
    caption: string;
    contentType: InstagramContentType;
    shareToFeed: boolean | null;
    firstComment: string | null;
    assetIds: string[];
  };
};

export function parseContentGroupTemplate(contentGroupData: any): ContentGroupTemplate | null {
  const template = contentGroupData?.contentGroup?.template;
  if (!template || typeof template !== 'object') {
    return null;
  }
  const rawValue =
    typeof template.contentType === 'string' ? template.contentType.trim().toLowerCase() : '';
  const contentType =
    rawValue === 'post' || rawValue === 'reel' || rawValue === 'story'
      ? (rawValue as InstagramContentType)
      : 'post';
  const rawAssetIds: unknown[] = Array.isArray(template.assetIds) ? template.assetIds : [];

  return {
    initialized: template.initialized === true,
    caption: typeof template.caption === 'string' ? template.caption : '',
    contentType,
    shareToFeed: typeof template.shareToFeed === 'boolean' ? template.shareToFeed : null,
    firstComment: typeof template.firstComment === 'string' ? template.firstComment : null,
    thumbOffset:
      typeof template.thumbOffset === 'number' && Number.isFinite(template.thumbOffset)
        ? template.thumbOffset
        : null,
    assetIds: rawAssetIds
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function useContentGroupSchedule(
  isMultiDestinationGroup: boolean,
  contentGroupData: any
): ContentGroupSchedule {
  return useMemo(() => {
    if (!isMultiDestinationGroup) {
      return { kind: 'none', scheduledAt: null };
    }
    const destinations = Array.isArray(contentGroupData?.destinations)
      ? (contentGroupData.destinations as any[])
      : [];
    const normalized = destinations.map((entry) => {
      const value = entry?.content?.scheduledAt;
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (typeof value === 'string') {
        return value.trim() || null;
      }
      return null;
    });

    const nonNull = normalized.filter((value): value is string => Boolean(value));
    if (nonNull.length === 0) {
      return { kind: 'none', scheduledAt: null };
    }
    const first = nonNull[0]!;
    const allEqual = normalized.every((value) => (value === null ? false : value === first));
    if (allEqual && destinations.length > 0 && nonNull.length === destinations.length) {
      return { kind: 'uniform', scheduledAt: first };
    }
    return { kind: 'mixed', scheduledAt: null };
  }, [contentGroupData, isMultiDestinationGroup]);
}

function toGroupDestinationPreviewData(entry: any): GroupDestinationPreviewData | null {
  const context = resolveDestinationPreviewContext(entry);
  if (!context) {
    return null;
  }

  const assetIds = resolveDestinationAssetIds(context.content);
  return {
    contentId: typeof context.content?.id === 'string' ? context.content.id : '',
    account: buildDestinationPreviewAccount(context.social, context.accountId, context.platform),
    content: buildDestinationPreviewContent(context.content, assetIds),
  };
}

function resolveDestinationPreviewContext(entry: any): {
  content: any;
  social: any;
  accountId: string;
  platform: Platform;
} | null {
  const content = entry?.content ?? {};
  const social = entry?.socialAccount ?? {};
  const accountId = typeof social?.id === 'string' ? social.id : null;
  const platform = typeof social?.platform === 'string' ? (social.platform as Platform) : null;
  if (!accountId || !platform) {
    return null;
  }
  return { content, social, accountId, platform };
}

function resolveDestinationAssetIds(content: any): string[] {
  if (!Array.isArray(content?.mediaAssets)) {
    return [];
  }
  return content.mediaAssets.map((asset: any) => asset?.assetId).filter(Boolean);
}

function buildDestinationPreviewAccount(
  social: any,
  accountId: string,
  platform: Platform
): PostPreviewAccount {
  return {
    id: accountId,
    platform,
    label: formatSocialAccountLabel({
      platform,
      username: typeof social.username === 'string' ? social.username : null,
      displayName: typeof social.displayName === 'string' ? social.displayName : null,
    }),
    avatarName: String(social.username || social.displayName || platform),
    avatarUrl: typeof social.profilePictureUrl === 'string' ? social.profilePictureUrl : null,
    disconnected: social?.disconnected === true,
  };
}

function buildDestinationPreviewContent(content: any, assetIds: string[]) {
  return {
    caption: typeof content?.caption === 'string' ? content.caption : '',
    contentType: normalizePreviewContentType(content?.contentType),
    shareToFeed: typeof content?.shareToFeed === 'boolean' ? content.shareToFeed : null,
    firstComment: typeof content?.firstComment === 'string' ? content.firstComment : null,
    assetIds,
  };
}

export function useGroupDestinationPreviewData(
  isMultiDestinationGroup: boolean,
  contentGroupData: any
): GroupDestinationPreviewData[] {
  return useMemo(() => {
    if (!isMultiDestinationGroup) {
      return [];
    }
    const destinations = Array.isArray(contentGroupData?.destinations)
      ? contentGroupData.destinations
      : [];
    return destinations
      .map((entry: any) => toGroupDestinationPreviewData(entry))
      .filter(Boolean) as GroupDestinationPreviewData[];
  }, [contentGroupData, isMultiDestinationGroup]);
}
