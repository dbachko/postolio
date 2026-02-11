import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { brand as brandApi, content as contentApi, httpGet } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { usePostDetail } from '@/hooks/usePostDetail';
import { getEnabledPlatforms, type Platform } from '@/lib/platform-config';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostPreviewAccount } from '@/components/post-preview/types';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import type { InstagramContentType } from '@postolio/content-validation';

import { normalizePreviewContentType } from '../utils';

type ContentGroupTemplate = {
  initialized: boolean;
  caption: string;
  contentType: InstagramContentType;
  shareToFeed: boolean | null;
  firstComment: string | null;
  thumbOffset: number | null;
  assetIds: string[];
};

type ContentGroupSchedule =
  | { kind: 'none'; scheduledAt: null }
  | { kind: 'uniform'; scheduledAt: string }
  | { kind: 'mixed'; scheduledAt: null };

type GroupDestination = {
  contentId: string;
  socialAccountId: string;
  status: string;
  platform: Platform;
  label: string;
  avatarName: string;
  avatarUrl: string | null;
  disconnected: boolean;
};

type GroupDestinationPreviewData = {
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

type ScheduleAheadLimits = { tier: string; maxAllowed: number; currentCount: number };

export function usePostEditorData(params: { id?: string; selectedBrandId: string | null }) {
  const { id, selectedBrandId } = params;

  const isCreating = !id;
  const { data: post, isLoading: isPostLoading } = usePostDetail(id);

  const brandIdForSocialAccounts = post?.brand?.id ?? selectedBrandId ?? null;
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandIdForSocialAccounts],
    enabled: Boolean(brandIdForSocialAccounts),
    queryFn: () => brandApi.getConnectedAccounts(brandIdForSocialAccounts!),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const platformPickerOptions = useMemo((): SocialAccountsPickerOption[] => {
    const enabledPlatforms = getEnabledPlatforms().map((p) => p.id);
    const enabledSet = new Set<Platform>(enabledPlatforms as Platform[]);
    const accounts = (socialAccountsQuery.data?.socialAccounts || [])
      .filter(
        (account) =>
          account &&
          account.disconnected !== true &&
          typeof account.platform === 'string' &&
          enabledSet.has(account.platform as Platform)
      )
      .slice()
      .sort((a: any, b: any) => {
        const aOrder = typeof a?.sortOrder === 'number' ? a.sortOrder : 0;
        const bOrder = typeof b?.sortOrder === 'number' ? b.sortOrder : 0;
        if (aOrder !== bOrder) return aOrder - bOrder;
        const aCreated = typeof a?.createdAt === 'string' ? a.createdAt : '';
        const bCreated = typeof b?.createdAt === 'string' ? b.createdAt : '';
        if (aCreated !== bCreated) return aCreated.localeCompare(bCreated);
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });

    return accounts.map((account) => {
      const platform = account.platform as Platform;
      const label = formatSocialAccountLabel({
        platform,
        username: account.username ?? null,
        displayName: account.displayName ?? null,
      });
      const avatarName = account.username || account.displayName || platform;
      return {
        id: String(account.id),
        platform,
        label,
        avatarName,
        avatarUrl: account.profilePictureUrl || null,
        disabled: false,
      } satisfies SocialAccountsPickerOption;
    });
  }, [socialAccountsQuery.data?.socialAccounts]);

  const contentGroupId = useMemo(() => {
    const raw = (post as any)?.contentGroupId;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length ? trimmed : null;
  }, [post]);

  const contentGroupQuery = useQuery({
    queryKey: ['content-group', contentGroupId],
    enabled: Boolean(contentGroupId),
    queryFn: () => contentApi.getContentGroup(contentGroupId!),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const groupDestinations = useMemo<GroupDestination[]>(() => {
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? (raw.destinations as any[]) : [];
    return destinations
      .map((entry) => {
        const contentId = entry?.content?.id;
        const contentStatus = entry?.content?.status;
        const social = entry?.socialAccount;
        const socialAccountId = social?.id;
        const platform = social?.platform as Platform | undefined;
        if (typeof contentId !== 'string' || !contentId.trim()) return null;
        if (typeof socialAccountId !== 'string' || !socialAccountId.trim()) return null;
        if (!platform || typeof platform !== 'string') return null;
        const status =
          typeof contentStatus === 'string' && contentStatus.trim()
            ? contentStatus.trim()
            : 'draft';
        const username = typeof social?.username === 'string' ? social.username : null;
        const displayName = typeof social?.displayName === 'string' ? social.displayName : null;
        const label = formatSocialAccountLabel({ platform, username, displayName });
        const avatarName = username || displayName || platform;
        const avatarUrl =
          typeof social?.profilePictureUrl === 'string' ? social.profilePictureUrl : null;
        const disconnected = social?.disconnected === true;
        return {
          contentId,
          socialAccountId,
          status,
          platform,
          label,
          avatarName,
          avatarUrl,
          disconnected,
        } satisfies GroupDestination;
      })
      .filter(Boolean) as GroupDestination[];
  }, [contentGroupQuery.data]);

  const isMultiDestinationGroup = Boolean(
    !isCreating && id && groupDestinations.length > 1 && contentGroupId
  );

  const groupDestinationSocialAccountIds = useMemo(() => {
    if (!isMultiDestinationGroup) return new Set<string>();
    return new Set(groupDestinations.map((d) => d.socialAccountId));
  }, [groupDestinations, isMultiDestinationGroup]);

  const groupHasPublishedDestinations = useMemo(() => {
    if (!isMultiDestinationGroup) return false;
    return groupDestinations.some((dest) => dest.status === 'published');
  }, [groupDestinations, isMultiDestinationGroup]);

  const groupPlatforms = useMemo(() => {
    if (!isMultiDestinationGroup) return [] as Platform[];
    const out = new Set<Platform>();
    for (const destination of groupDestinations) {
      out.add(destination.platform);
    }
    return Array.from(out);
  }, [groupDestinations, isMultiDestinationGroup]);

  const contentGroupTemplate = useMemo<ContentGroupTemplate | null>(() => {
    const raw = contentGroupQuery.data as any;
    const template = raw?.contentGroup?.template;
    if (!template || typeof template !== 'object') return null;

    const caption = typeof template.caption === 'string' ? template.caption : '';
    const contentType = (() => {
      const rawValue =
        typeof template.contentType === 'string' ? template.contentType.trim().toLowerCase() : '';
      if (rawValue === 'post' || rawValue === 'reel' || rawValue === 'story') {
        return rawValue as InstagramContentType;
      }
      return 'post';
    })();

    const shareToFeed = typeof template.shareToFeed === 'boolean' ? template.shareToFeed : null;
    const firstComment = typeof template.firstComment === 'string' ? template.firstComment : null;
    const thumbOffset =
      typeof template.thumbOffset === 'number' && Number.isFinite(template.thumbOffset)
        ? template.thumbOffset
        : null;
    const rawAssetIds: unknown[] = Array.isArray(template.assetIds) ? template.assetIds : [];
    const assetIds = rawAssetIds
      .filter((v: unknown): v is string => typeof v === 'string')
      .map((v: string) => v.trim())
      .filter((v: string) => v.length > 0);

    return {
      initialized: template.initialized === true,
      caption,
      contentType,
      shareToFeed,
      firstComment,
      thumbOffset,
      assetIds,
    };
  }, [contentGroupQuery.data]);

  const templateAssetIds = useMemo<string[]>(
    () => contentGroupTemplate?.assetIds ?? [],
    [contentGroupTemplate]
  );
  const { data: templateAssetsById } = useAssetsByIds(templateAssetIds);

  const templateCarouselAssets = useMemo((): AssetReference[] => {
    if (!contentGroupTemplate) return [];
    return templateAssetIds.map((assetId) => {
      const asset = templateAssetsById?.[assetId] ?? null;
      const type = asset?.fileType === 'video' ? ('video' as const) : ('image' as const);
      return {
        id: assetId,
        url: asset?.url || '',
        type,
      };
    });
  }, [contentGroupTemplate, templateAssetIds, templateAssetsById]);

  const contentGroupSchedule = useMemo<ContentGroupSchedule>(() => {
    if (!isMultiDestinationGroup) {
      return { kind: 'none', scheduledAt: null };
    }
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? (raw.destinations as any[]) : [];
    const normalized = destinations.map((entry) => {
      const value = entry?.content?.scheduledAt;
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
      }
      return null;
    });

    const nonNull = normalized.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (nonNull.length === 0) return { kind: 'none', scheduledAt: null };
    const first = nonNull[0]!;
    const allEqual = normalized.every((v) => (v === null ? false : v === first));
    if (allEqual && destinations.length > 0 && nonNull.length === destinations.length) {
      return { kind: 'uniform', scheduledAt: first };
    }
    return { kind: 'mixed', scheduledAt: null };
  }, [contentGroupQuery.data, isMultiDestinationGroup]);

  const groupDestinationPreviewData = useMemo<GroupDestinationPreviewData[]>(() => {
    if (!isMultiDestinationGroup) return [];
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? raw.destinations : [];
    return destinations
      .map((entry: any) => {
        const content = entry?.content ?? {};
        const social = entry?.socialAccount ?? {};
        const accountId = typeof social?.id === 'string' ? social.id : null;
        const platform =
          typeof social?.platform === 'string' ? (social.platform as Platform) : null;
        if (!accountId || !platform) return null;
        const label = formatSocialAccountLabel({
          platform,
          username: typeof social.username === 'string' ? String(social.username) : null,
          displayName: typeof social.displayName === 'string' ? String(social.displayName) : null,
        });
        const avatarName = String(social.username || social.displayName || platform);
        const avatarUrl =
          typeof social.profilePictureUrl === 'string' ? social.profilePictureUrl : null;
        const assetIds = Array.isArray(content?.mediaAssets)
          ? content.mediaAssets.map((asset: any) => asset?.assetId).filter(Boolean)
          : [];
        const contentType = normalizePreviewContentType(content?.contentType);
        return {
          contentId: typeof content?.id === 'string' ? content.id : '',
          account: {
            id: accountId,
            platform,
            label,
            avatarName,
            avatarUrl,
            disconnected: social?.disconnected === true,
          } satisfies PostPreviewAccount,
          content: {
            caption: typeof content?.caption === 'string' ? content.caption : '',
            contentType,
            shareToFeed: typeof content?.shareToFeed === 'boolean' ? content.shareToFeed : null,
            firstComment: typeof content?.firstComment === 'string' ? content.firstComment : null,
            assetIds,
          },
        } satisfies GroupDestinationPreviewData;
      })
      .filter(Boolean) as GroupDestinationPreviewData[];
  }, [contentGroupQuery.data, isMultiDestinationGroup]);

  const brandIdForAssets = post?.brand?.id ?? selectedBrandId ?? null;
  const postAssetIds = useMemo(
    () => (post?.mediaAssets || []).map((asset) => asset.assetId),
    [post?.mediaAssets]
  );
  const { data: mediaAssetsById } = useAssetsByIds(postAssetIds);

  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    staleTime: 60 * 1000,
  });
  const limits = limitsQuery.data?.data as ScheduleAheadLimits | undefined;
  const atCapacity =
    !!limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed;
  const limitMessage = atCapacity
    ? `Scheduling limit reached (${limits?.currentCount}/${limits?.maxAllowed}). Upgrade to add more.`
    : '';

  return {
    post,
    isPostLoading,
    brandIdForSocialAccounts,
    socialAccountsQuery,
    platformPickerOptions,
    contentGroupId,
    contentGroupQuery,
    groupDestinations,
    groupDestinationSocialAccountIds,
    groupHasPublishedDestinations,
    groupPlatforms,
    isMultiDestinationGroup,
    contentGroupTemplate,
    templateAssetIds,
    templateAssetsById,
    templateCarouselAssets,
    contentGroupSchedule,
    groupDestinationPreviewData,
    brandIdForAssets,
    postAssetIds,
    mediaAssetsById,
    atCapacity,
    limitMessage,
  };
}
