import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { usePostDetail } from '@/hooks/usePostDetail';
import { brand as brandApi, content as contentApi, httpGet } from '@/lib/api';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import { getEnabledPlatforms, type Platform } from '@/lib/platform-config';
import { formatSocialAccountLabel } from '@/lib/social-account-label';
import {
  parseContentGroupTemplate,
  useContentGroupSchedule,
  useGroupDestinationPreviewData,
  type ContentGroupTemplate,
} from './use-post-editor-data-content-group';

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

type ScheduleAheadLimits = { tier: string; maxAllowed: number; currentCount: number };

function getEnabledPlatformSet(multiDestinationEnabled: boolean): Set<Platform> {
  const enabledPlatforms = multiDestinationEnabled
    ? getEnabledPlatforms().map((platform) => platform.id)
    : (['instagram'] as const);
  return new Set<Platform>(enabledPlatforms as Platform[]);
}

function isEnabledConnectedAccount(account: any, enabledSet: Set<Platform>): boolean {
  return Boolean(
    account &&
    account.disconnected !== true &&
    typeof account.platform === 'string' &&
    enabledSet.has(account.platform as Platform)
  );
}

function compareSocialAccountsForPicker(a: any, b: any): number {
  const aOrder = typeof a?.sortOrder === 'number' ? a.sortOrder : 0;
  const bOrder = typeof b?.sortOrder === 'number' ? b.sortOrder : 0;
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  const aCreated = typeof a?.createdAt === 'string' ? a.createdAt : '';
  const bCreated = typeof b?.createdAt === 'string' ? b.createdAt : '';
  if (aCreated !== bCreated) {
    return aCreated.localeCompare(bCreated);
  }
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function mapToSocialAccountPickerOption(account: any): SocialAccountsPickerOption {
  const platform = account.platform as Platform;
  return {
    id: String(account.id),
    platform,
    label: formatSocialAccountLabel({
      platform,
      username: account.username ?? null,
      displayName: account.displayName ?? null,
    }),
    avatarName: account.username || account.displayName || platform,
    avatarUrl: account.profilePictureUrl || null,
    disabled: false,
  } satisfies SocialAccountsPickerOption;
}

function usePlatformPickerOptions(
  multiDestinationEnabled: boolean,
  socialAccountsData: any
): SocialAccountsPickerOption[] {
  return useMemo(() => {
    const enabledSet = getEnabledPlatformSet(multiDestinationEnabled);
    const accounts = (socialAccountsData?.socialAccounts || [])
      .filter((account: any) => isEnabledConnectedAccount(account, enabledSet))
      .slice()
      .sort(compareSocialAccountsForPicker);

    return accounts.map((account: any) => mapToSocialAccountPickerOption(account));
  }, [multiDestinationEnabled, socialAccountsData?.socialAccounts]);
}

function useContentGroupDestinations(contentGroupData: any): GroupDestination[] {
  return useMemo(() => {
    const destinations = Array.isArray(contentGroupData?.destinations)
      ? (contentGroupData.destinations as any[])
      : [];

    return destinations
      .map((entry) => toGroupDestination(entry))
      .filter(Boolean) as GroupDestination[];
  }, [contentGroupData]);
}

function toGroupDestination(entry: any): GroupDestination | null {
  const context = resolveGroupDestinationContext(entry);
  if (!context) {
    return null;
  }

  return {
    contentId: context.contentId,
    socialAccountId: context.socialAccountId,
    status: resolveGroupDestinationStatus(entry?.content),
    platform: context.platform,
    label: formatSocialAccountLabel({
      platform: context.platform,
      username: context.username,
      displayName: context.displayName,
    }),
    avatarName: resolveGroupDestinationAvatarName(
      context.username,
      context.displayName,
      context.platform
    ),
    avatarUrl: context.avatarUrl,
    disconnected: context.disconnected,
  };
}

function resolveGroupDestinationContext(entry: any): {
  contentId: string;
  socialAccountId: string;
  platform: Platform;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  disconnected: boolean;
} | null {
  const contentId = readOptionalString(entry?.content?.id);
  const social = entry?.socialAccount;
  const socialAccountId = readOptionalString(social?.id);
  const platformValue = readOptionalString(social?.platform);
  if (!contentId || !socialAccountId || !platformValue) {
    return null;
  }
  const platform = platformValue as Platform;

  return {
    contentId,
    socialAccountId,
    platform,
    username: readOptionalString(social?.username),
    displayName: readOptionalString(social?.displayName),
    avatarUrl: readOptionalString(social?.profilePictureUrl),
    disconnected: social?.disconnected === true,
  };
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function resolveGroupDestinationStatus(content: any): string {
  if (typeof content?.status === 'string' && content.status.trim()) {
    return content.status.trim();
  }
  return 'draft';
}

function resolveGroupDestinationAvatarName(
  username: string | null,
  displayName: string | null,
  platform: Platform
): string {
  if (username) {
    return username;
  }
  if (displayName) {
    return displayName;
  }
  return platform;
}

function useMultiDestinationState(params: {
  multiDestinationEnabled: boolean;
  isCreating: boolean;
  id?: string;
  contentGroupId: string | null;
  groupDestinations: GroupDestination[];
}) {
  const { contentGroupId, groupDestinations, id, isCreating, multiDestinationEnabled } = params;

  const isMultiDestinationGroup =
    multiDestinationEnabled &&
    !isCreating &&
    Boolean(id) &&
    groupDestinations.length > 1 &&
    Boolean(contentGroupId);

  const groupDestinationSocialAccountIds = useMemo(() => {
    if (!isMultiDestinationGroup) {
      return new Set<string>();
    }
    return new Set(groupDestinations.map((destination) => destination.socialAccountId));
  }, [groupDestinations, isMultiDestinationGroup]);

  const groupHasPublishedDestinations = useMemo(() => {
    return (
      isMultiDestinationGroup &&
      groupDestinations.some((destination) => destination.status === 'published')
    );
  }, [groupDestinations, isMultiDestinationGroup]);

  const groupPlatforms = useMemo(() => {
    if (!isMultiDestinationGroup) {
      return [] as Platform[];
    }
    return Array.from(new Set(groupDestinations.map((destination) => destination.platform)));
  }, [groupDestinations, isMultiDestinationGroup]);

  return {
    isMultiDestinationGroup,
    groupDestinationSocialAccountIds,
    groupHasPublishedDestinations,
    groupPlatforms,
  };
}

function useTemplateAssets(contentGroupTemplate: ContentGroupTemplate | null) {
  const templateAssetIds = useMemo(
    () => contentGroupTemplate?.assetIds ?? [],
    [contentGroupTemplate]
  );
  const { data: templateAssetsById } = useAssetsByIds(templateAssetIds);
  const templateCarouselAssets = useMemo(() => {
    if (!contentGroupTemplate) {
      return [] as AssetReference[];
    }
    return templateAssetIds.map((assetId) => {
      const asset = templateAssetsById?.[assetId] ?? null;
      return {
        id: assetId,
        url: asset?.url || '',
        type: asset?.fileType === 'video' ? ('video' as const) : ('image' as const),
      };
    });
  }, [contentGroupTemplate, templateAssetIds, templateAssetsById]);

  return { templateAssetIds, templateAssetsById, templateCarouselAssets };
}

function useScheduleAheadLimits() {
  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: async () => httpGet('/api/account/limits/schedule-ahead'),
    staleTime: 60 * 1000,
  });
  const limits = limitsQuery.data?.data as ScheduleAheadLimits | undefined;
  const atCapacity = Boolean(
    limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed
  );

  return {
    atCapacity,
    limitMessage: atCapacity
      ? `Scheduling limit reached (${limits?.currentCount}/${limits?.maxAllowed}). Upgrade to add more.`
      : '',
  };
}

function useContentGroupData(params: {
  post: any;
  id?: string;
  isCreating: boolean;
  multiDestinationEnabled: boolean;
}) {
  const contentGroupId =
    typeof params.post?.contentGroupId === 'string' && params.post.contentGroupId.trim()
      ? params.post.contentGroupId.trim()
      : null;

  const contentGroupQuery = useQuery({
    queryKey: ['content-group', contentGroupId],
    enabled: Boolean(contentGroupId) && params.multiDestinationEnabled,
    queryFn: () => contentApi.getContentGroup(contentGroupId!),
    staleTime: CACHE_TIMES.MEDIUM,
    gcTime: GC_TIMES.STANDARD,
    refetchOnWindowFocus: false,
  });

  const groupDestinations = useContentGroupDestinations(contentGroupQuery.data);
  const multiDestinationState = useMultiDestinationState({
    multiDestinationEnabled: params.multiDestinationEnabled,
    isCreating: params.isCreating,
    id: params.id,
    contentGroupId,
    groupDestinations,
  });

  const contentGroupTemplate = useMemo(
    () => parseContentGroupTemplate(contentGroupQuery.data),
    [contentGroupQuery.data]
  );
  const templateAssets = useTemplateAssets(contentGroupTemplate);
  const contentGroupSchedule = useContentGroupSchedule(
    multiDestinationState.isMultiDestinationGroup,
    contentGroupQuery.data
  );
  const groupDestinationPreviewData = useGroupDestinationPreviewData(
    multiDestinationState.isMultiDestinationGroup,
    contentGroupQuery.data
  );

  return {
    contentGroupId,
    contentGroupQuery,
    groupDestinations,
    multiDestinationState,
    contentGroupTemplate,
    templateAssets,
    contentGroupSchedule,
    groupDestinationPreviewData,
  };
}

function usePostAssets(post: any, selectedBrandId: string | null) {
  const brandIdForAssets = post?.brand?.id ?? selectedBrandId ?? null;
  const postAssetIds = useMemo(
    () => (post?.mediaAssets || []).map((asset: any) => asset.assetId),
    [post?.mediaAssets]
  );
  const { data: mediaAssetsById } = useAssetsByIds(postAssetIds);
  return { brandIdForAssets, postAssetIds, mediaAssetsById };
}

export function usePostEditorData(params: {
  id?: string;
  selectedBrandId: string | null;
  multiDestinationEnabled: boolean;
}) {
  const isCreating = !params.id;
  const { data: post, isLoading: isPostLoading } = usePostDetail(params.id);

  const brandIdForSocialAccounts = post?.brand?.id ?? params.selectedBrandId ?? null;
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandIdForSocialAccounts],
    enabled: Boolean(brandIdForSocialAccounts),
    queryFn: () => brandApi.getConnectedAccounts(brandIdForSocialAccounts!),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

  const platformPickerOptions = usePlatformPickerOptions(
    params.multiDestinationEnabled,
    socialAccountsQuery.data
  );
  const contentGroupData = useContentGroupData({
    post,
    id: params.id,
    isCreating,
    multiDestinationEnabled: params.multiDestinationEnabled,
  });
  const postAssets = usePostAssets(post, params.selectedBrandId);
  const limits = useScheduleAheadLimits();

  return {
    post,
    isPostLoading,
    brandIdForSocialAccounts,
    socialAccountsQuery,
    platformPickerOptions,
    contentGroupId: contentGroupData.contentGroupId,
    contentGroupQuery: contentGroupData.contentGroupQuery,
    groupDestinations: contentGroupData.groupDestinations,
    groupDestinationSocialAccountIds:
      contentGroupData.multiDestinationState.groupDestinationSocialAccountIds,
    groupHasPublishedDestinations:
      contentGroupData.multiDestinationState.groupHasPublishedDestinations,
    groupPlatforms: contentGroupData.multiDestinationState.groupPlatforms,
    isMultiDestinationGroup: contentGroupData.multiDestinationState.isMultiDestinationGroup,
    contentGroupTemplate: contentGroupData.contentGroupTemplate,
    templateAssetIds: contentGroupData.templateAssets.templateAssetIds,
    templateAssetsById: contentGroupData.templateAssets.templateAssetsById,
    templateCarouselAssets: contentGroupData.templateAssets.templateCarouselAssets,
    contentGroupSchedule: contentGroupData.contentGroupSchedule,
    groupDestinationPreviewData: contentGroupData.groupDestinationPreviewData,
    brandIdForAssets: postAssets.brandIdForAssets,
    postAssetIds: postAssets.postAssetIds,
    mediaAssetsById: postAssets.mediaAssetsById,
    atCapacity: limits.atCapacity,
    limitMessage: limits.limitMessage,
  };
}
