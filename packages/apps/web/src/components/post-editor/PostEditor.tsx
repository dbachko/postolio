import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { brand as brandApi, content as contentApi, campaign as campaignApi } from '@/lib/api';
import type { Campaign } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AssetReference } from '@/components/MultiImageUploader';
import type { PostStatus } from '@/components/PostStatusCard';
import { PostStatusBadge } from '@/components/PostStatusBadge';
import { useTimezone } from '@/contexts/TimezoneContext';
import { toUTCFromInput, getUserTimezone } from '@/lib/timezone';
import { formatInTimeZone } from 'date-fns-tz';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { usePostDetail, type PostDetailData } from '@/hooks/usePostDetail';
import {
  PostEditorMainBody,
  type PostEditorFormState,
} from '@/components/post-editor/PostEditorMainBody';
import { WriteItBar } from '@/components/post-editor/WriteItBar';
import { Check, CircleHelp, Eye, EyeOff, Instagram, LayoutTemplate, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useBrandStore } from '@/stores/brandStore';
import { cn } from '@/lib/utils';
import { SocialAccountAvatar } from '@/components/social/SocialAccountAvatar';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { useRightSidebarLayout } from '@/right-sidebar/right-sidebar-context';
import {
  validateContentPayload,
  type InstagramContentType,
  type InstagramMediaType,
  type Platform as ValidationPlatform,
} from '@postolio/content-validation';
import type { SocialAccountsPickerOption } from '@/components/social/SocialAccountsPicker';
import { getEnabledPlatforms, getPlatformConfig, type Platform } from '@/lib/platform-config';
import { PostPreviewPanel } from '@/components/post-preview/PostPreviewPanel';
import type {
  PostPreviewAccount,
  PostPreviewContent,
  PostPreviewItem,
  PreviewMedia,
} from '@/components/post-preview/types';
import AssetPicker from '@/features/assets/components/AssetPicker';
import { assetsApi } from '@/features/assets/api/client';
import { useAssetsByIds } from '@/features/assets/hooks/useAssetsByIds';
import { CACHE_TIMES, GC_TIMES } from '@/lib/cache-config';
import {
  ContentGroupTemplateEditor,
  type ContentGroupTemplateFormState,
} from '@/components/post-editor/ContentGroupTemplateEditor';
import { DestinationsRail, DestinationsRailItem } from '@/components/post-editor/DestinationsRail';

function toValidationPlatform(platform: Platform): ValidationPlatform | null {
  if (platform === 'x') return 'twitter';
  if (platform === 'tiktok') return null;
  return platform;
}

function getScheduleBlockerMessage(params: {
  atCapacity: boolean;
  limitMessage: string;
  validationOk: boolean;
  validationError: string | null;
  hasScheduleTime: boolean;
  pausedCampaign: boolean;
  hasSelectedPlatforms: boolean;
  schedulingSupported: boolean;
}): string | null {
  const {
    atCapacity,
    limitMessage,
    validationOk,
    validationError,
    hasScheduleTime,
    pausedCampaign,
    hasSelectedPlatforms,
    schedulingSupported,
  } = params;
  if (!hasSelectedPlatforms) {
    return 'Select at least one social account before continuing.';
  }
  if (!schedulingSupported) {
    return 'Scheduling is not available for one or more selected destinations. Save as a draft instead.';
  }
  if (pausedCampaign) {
    return 'This campaign is paused. Resume it before scheduling new posts.';
  }
  if (atCapacity) return limitMessage || 'You have reached your scheduling limit.';
  if (!validationOk) return validationError || 'Please fix validation errors before continuing.';
  if (!hasScheduleTime) return 'Pick a time before scheduling.';
  return null;
}

const createEmptyPostFormState = (): PostEditorFormState => ({
  caption: '',
  carouselAssets: [],
  contentType: 'post',
  scheduledAt: '',
  shareToFeed: true,
  firstComment: '',
});

const createEmptyTemplateFormState = (): ContentGroupTemplateFormState => ({
  caption: '',
  carouselAssets: [],
  contentType: 'post',
  shareToFeed: true,
  firstComment: '',
});

const formatScheduledInput = (value?: string | null, timezone?: string) => {
  if (!value) return '';
  const effectiveTimezone = timezone || getUserTimezone();
  return formatInTimeZone(new Date(value), effectiveTimezone, "yyyy-MM-dd'T'HH:mm");
};

const deriveMediaTypeFromAssets = (
  assets: AssetReference[],
  contentType: InstagramContentType
): InstagramMediaType => {
  if (contentType === 'reel') return 'video';
  if (assets.length > 1) return 'image';
  if (assets.length === 1) {
    return assets[0]?.type === 'video' ? 'video' : 'image';
  }
  return 'image';
};

function mergeUniqueAssets(items: AssetReference[], limit: number): AssetReference[] {
  const seen = new Set<string>();
  const result: AssetReference[] = [];
  for (const item of items) {
    const key = item.id || item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

const PREVIEW_PANEL_WIDTH = 360;

const normalizePreviewContentType = (value: unknown): InstagramContentType => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'post' || normalized === 'reel' || normalized === 'story') {
    return normalized as InstagramContentType;
  }
  return 'post';
};

const mapAssetReferencesToPreviewMedia = (assets: AssetReference[]): PreviewMedia[] => {
  return assets
    .filter((asset) => typeof asset?.url === 'string' && asset.url.trim().length > 0)
    .map((asset) => ({
      url: asset.url,
      type: asset.type === 'video' ? 'video' : 'image',
    }));
};

const toPreviewAccountFromOption = (option: SocialAccountsPickerOption): PostPreviewAccount => {
  const platformConfig = getPlatformConfig(option.platform);
  const label = option.label?.trim() || platformConfig.displayName;
  const avatarName = option.avatarName?.trim() || label || platformConfig.displayName;
  return {
    id: option.id,
    platform: option.platform,
    label,
    avatarName,
    avatarUrl: option.avatarUrl ?? null,
    disconnected: option.disabled === true,
  };
};

type PostEditorLayout = 'sidebar' | 'page';

interface PostEditorProps {
  id?: string;
  layout?: PostEditorLayout;
  showHeader?: boolean;
  onRequestClose?: () => void;
}

export function PostEditor({
  id,
  layout = 'sidebar',
  showHeader = true,
  onRequestClose,
}: PostEditorProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { openSidebar } = useRightSidebarRouter();
  const rightSidebarLayout = useRightSidebarLayout();
  const { timezone, getBrandTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const [brandTimezone, setBrandTimezone] = useState<string>(timezone);
  const queryClient = useQueryClient();

  // Determine if we're in creation mode
  const isCreating = !id;
  const isCreateWithRail = isCreating;

  const { data: post, isLoading } = usePostDetail(id);

  const brandIdForSocialAccounts = post?.brand?.id ?? selectedBrand?.id ?? null;
  const socialAccountsQuery = useQuery({
    queryKey: ['brand-social-accounts', brandIdForSocialAccounts],
    enabled: Boolean(brandIdForSocialAccounts),
    queryFn: () => brandApi.getConnectedAccounts(brandIdForSocialAccounts!),
    staleTime: CACHE_TIMES.LONG,
    gcTime: GC_TIMES.LONG,
    refetchOnWindowFocus: false,
  });

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

  const groupDestinations = useMemo(() => {
    const raw = contentGroupQuery.data as any;
    const destinations = Array.isArray(raw?.destinations) ? (raw.destinations as any[]) : [];
    const out = destinations
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
        const label = username ? `@${username}` : displayName || platform;
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
        };
      })
      .filter(Boolean) as Array<{
      contentId: string;
      socialAccountId: string;
      status: string;
      platform: Platform;
      label: string;
      avatarName: string;
      avatarUrl: string | null;
      disconnected: boolean;
    }>;

    return out;
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

  type ContentGroupTemplate = {
    initialized: boolean;
    caption: string;
    contentType: InstagramContentType;
    shareToFeed: boolean | null;
    firstComment: string | null;
    thumbOffset: number | null;
    assetIds: string[];
  };

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

  const contentGroupSchedule = useMemo(() => {
    if (!isMultiDestinationGroup) {
      return { kind: 'none' as const, scheduledAt: null as string | null };
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
    if (nonNull.length === 0) return { kind: 'none' as const, scheduledAt: null as string | null };
    const first = nonNull[0]!;
    const allEqual = normalized.every((v) => (v === null ? false : v === first));
    if (allEqual && destinations.length > 0 && nonNull.length === destinations.length) {
      return { kind: 'uniform' as const, scheduledAt: first };
    }
    return { kind: 'mixed' as const, scheduledAt: null as string | null };
  }, [contentGroupQuery.data, isMultiDestinationGroup]);

  useEffect(() => {
    let mounted = true;
    const resolveBrandTimezone = async () => {
      const brandId = post?.brand?.id;
      if (!brandId) return;
      try {
        const tz = await getBrandTimezone(brandId);
        if (mounted && tz) setBrandTimezone(tz);
      } catch {
        if (mounted) setBrandTimezone(timezone);
      }
    };
    void resolveBrandTimezone();
    return () => {
      mounted = false;
    };
  }, [post?.brand?.id, getBrandTimezone, timezone]);

  const [formData, setFormData] = useState<PostEditorFormState>(() => createEmptyPostFormState());
  const [hasChanges, setHasChanges] = useState(false);
  const formInitializedRef = useRef(false);
  const hasScheduleTime = Boolean(formData.scheduledAt);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [assetPickerTarget, setAssetPickerTarget] = useState<'destination' | 'template'>(
    'destination'
  );
  const [firstCommentOpen, setFirstCommentOpen] = useState(false);
  const [templateFirstCommentOpen, setTemplateFirstCommentOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [selectedPlatformAccountIds, setSelectedPlatformAccountIds] = useState<string[]>([]);
  const platformsInitializedRef = useRef(false);
  const [createDestinationsPopoverOpen, setCreateDestinationsPopoverOpen] = useState(false);
  const [createDestinationsHelpOpen, setCreateDestinationsHelpOpen] = useState(false);
  const [editDestinationsPopoverOpen, setEditDestinationsPopoverOpen] = useState(false);
  const [editDestinationsHelpOpen, setEditDestinationsHelpOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [templateFormData, setTemplateFormData] = useState<ContentGroupTemplateFormState>(() =>
    createEmptyTemplateFormState()
  );
  const [templateHasChanges, setTemplateHasChanges] = useState(false);
  const templateInitializedRef = useRef(false);
  const [isTemplateTab, setIsTemplateTab] = useState(false);

  const [showDestinationsRequiredError, setShowDestinationsRequiredError] = useState(false);

  const platformPickerOptions = useMemo(() => {
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

    const options = accounts.map((account) => {
      const platform = account.platform as Platform;
      const label = account.username ? `@${account.username}` : account.displayName || undefined;
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

    return options;
  }, [socialAccountsQuery.data?.socialAccounts]);

  const handlePlatformAccountsChange = useCallback(
    (next: string[]) => {
      if (!platformPickerOptions.length) {
        setSelectedPlatformAccountIds([]);
        return;
      }

      const byId = new Set(platformPickerOptions.map((opt) => opt.id));
      const deduped = Array.from(new Set(next)).filter((id) => byId.has(id));
      setSelectedPlatformAccountIds(deduped);
    },
    [platformPickerOptions]
  );

  const createSelectedDestinations = useMemo(() => {
    if (!isCreateWithRail) return [] as SocialAccountsPickerOption[];
    if (!platformPickerOptions.length || !selectedPlatformAccountIds.length) return [];
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    const out: SocialAccountsPickerOption[] = [];
    for (const id of selectedPlatformAccountIds) {
      const opt = byId.get(id);
      if (opt) out.push(opt);
    }
    return out;
  }, [isCreateWithRail, platformPickerOptions, selectedPlatformAccountIds]);

  const toggleCreateDestination = useCallback(
    (accountId: string) => {
      if (!accountId) return;
      const next = selectedPlatformAccountIds.includes(accountId)
        ? selectedPlatformAccountIds.filter((id) => id !== accountId)
        : [...selectedPlatformAccountIds, accountId];
      handlePlatformAccountsChange(next);
    },
    [handlePlatformAccountsChange, selectedPlatformAccountIds]
  );

  const selectedTargetSocialAccountId = useMemo(() => {
    const first = selectedPlatformAccountIds[0];
    if (!first) return null;
    return first;
  }, [selectedPlatformAccountIds]);

  const selectedPlatforms = useMemo(() => {
    if (!platformPickerOptions.length || !selectedPlatformAccountIds.length) return [];
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt.platform]));
    const out = new Set<Platform>();
    for (const id of selectedPlatformAccountIds) {
      const platform = byId.get(id);
      if (platform) out.add(platform);
    }
    return Array.from(out);
  }, [platformPickerOptions, selectedPlatformAccountIds]);

  const schedulingSupported = useMemo(() => {
    if (selectedPlatforms.length === 0) return false;
    return selectedPlatforms.every((p) => getPlatformConfig(p).features.scheduling);
  }, [selectedPlatforms]);

  const effectiveSchedulingSupported = useMemo(() => {
    if (!isMultiDestinationGroup) return schedulingSupported;
    if (groupDestinations.length === 0) return false;
    return groupDestinations.every(
      (dest) => dest.disconnected !== true && getPlatformConfig(dest.platform).features.scheduling
    );
  }, [groupDestinations, isMultiDestinationGroup, schedulingSupported]);

  const finalMediaType = useMemo<InstagramMediaType>(() => {
    return deriveMediaTypeFromAssets(formData.carouselAssets, formData.contentType);
  }, [formData.carouselAssets, formData.contentType]);

  const templateMediaType = useMemo<InstagramMediaType>(() => {
    return deriveMediaTypeFromAssets(templateFormData.carouselAssets, templateFormData.contentType);
  }, [templateFormData.carouselAssets, templateFormData.contentType]);

  const validation = useMemo(() => {
    const isStory = formData.contentType === 'story';
    const mediaAssets: { key: string; type: InstagramMediaType }[] = (formData.carouselAssets || [])
      .filter((asset) => typeof asset.id === 'string' && asset.id.trim().length > 0)
      .map((asset) => ({
        key: asset.id,
        type: asset.type === 'video' ? 'video' : 'image',
      }));

    const platformsForValidation: Platform[] =
      selectedPlatforms.length > 0 ? selectedPlatforms : ['instagram'];

    const validations = platformsForValidation.map((platform) => {
      const validationPlatform = toValidationPlatform(platform);
      if (!validationPlatform) {
        return {
          platform,
          result: {
            ok: false,
            errors: [
              {
                field: 'platform',
                message: `Unsupported platform: ${platform}`,
                code: 'UNSUPPORTED_PLATFORM',
              },
            ],
          },
        };
      }

      return {
        platform,
        result: validateContentPayload({
          platform: validationPlatform,
          contentType: formData.contentType,
          mediaType: mediaAssets.length > 0 ? finalMediaType : undefined,
          caption: isStory ? '' : formData.caption,
          mediaAssets,
        }),
      };
    });

    const firstFail = validations.find((v) => !v.result.ok);
    if (!firstFail) {
      return { ok: true, errors: [] };
    }

    return {
      ok: false,
      errors: firstFail.result.errors.map((e) => ({
        ...e,
        message: `${firstFail.platform}: ${e.message}`,
      })),
    };
  }, [
    finalMediaType,
    formData.caption,
    formData.carouselAssets,
    formData.contentType,
    selectedPlatforms,
  ]);

  const validationError = validation.ok ? null : validation.errors[0]?.message;
  const hasSelectedPlatforms = selectedPlatformAccountIds.length > 0;

  const templateValidation = useMemo(() => {
    if (!isMultiDestinationGroup) return { ok: true, errors: [] as any[] };

    const isStory = templateFormData.contentType === 'story';
    const mediaAssets: { key: string; type: InstagramMediaType }[] = (
      templateFormData.carouselAssets || []
    )
      .filter((asset) => typeof asset.id === 'string' && asset.id.trim().length > 0)
      .map((asset) => ({
        key: asset.id,
        type: asset.type === 'video' ? 'video' : 'image',
      }));

    const platformsForValidation: Platform[] =
      groupPlatforms.length > 0 ? groupPlatforms : ['instagram'];
    const validations = platformsForValidation.map((platform) => {
      const validationPlatform = toValidationPlatform(platform);
      if (!validationPlatform) {
        return {
          platform,
          result: {
            ok: false,
            errors: [
              {
                field: 'platform',
                message: `Unsupported platform: ${platform}`,
                code: 'UNSUPPORTED_PLATFORM',
              },
            ],
          },
        };
      }

      return {
        platform,
        result: validateContentPayload({
          platform: validationPlatform,
          contentType: templateFormData.contentType,
          mediaType: mediaAssets.length > 0 ? templateMediaType : undefined,
          caption: isStory ? '' : templateFormData.caption,
          mediaAssets,
        }),
      };
    });

    const firstFail = validations.find((v) => !v.result.ok);
    if (!firstFail) {
      return { ok: true, errors: [] };
    }

    return {
      ok: false,
      errors: firstFail.result.errors.map((e) => ({
        ...e,
        message: `${firstFail.platform}: ${e.message}`,
      })),
    };
  }, [
    groupPlatforms,
    isMultiDestinationGroup,
    templateFormData.caption,
    templateFormData.carouselAssets,
    templateFormData.contentType,
    templateMediaType,
  ]);

  const templateValidationError = templateValidation.ok
    ? null
    : templateValidation.errors[0]?.message;

  const groupDestinationPreviewData = useMemo(() => {
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
        const label = social.username
          ? `@${String(social.username)}`
          : String(social.displayName || platform);
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
        };
      })
      .filter(Boolean) as Array<{
      contentId: string;
      account: PostPreviewAccount;
      content: {
        caption: string;
        contentType: InstagramContentType;
        shareToFeed: boolean | null;
        firstComment: string | null;
        assetIds: string[];
      };
    }>;
  }, [contentGroupQuery.data, isMultiDestinationGroup]);

  const brandIdForAssets = post?.brand?.id ?? selectedBrand?.id ?? null;
  const postAssetIds = useMemo(
    () => (post?.mediaAssets || []).map((asset) => asset.assetId),
    [post?.mediaAssets]
  );
  const { data: mediaAssetsById } = useAssetsByIds(postAssetIds);

  const destinationsErrorDelayEnabled =
    (isCreateWithRail || (layout === 'sidebar' && Boolean(id) && !isMultiDestinationGroup)) &&
    platformsInitializedRef.current;

  useEffect(() => {
    if (!destinationsErrorDelayEnabled) {
      setShowDestinationsRequiredError(false);
      return;
    }

    if (selectedPlatformAccountIds.length > 0) {
      setShowDestinationsRequiredError(false);
      return;
    }

    const timer = window.setTimeout(() => setShowDestinationsRequiredError(true), 500);
    return () => window.clearTimeout(timer);
  }, [destinationsErrorDelayEnabled, selectedPlatformAccountIds.length]);

  // Scheduling capacity (plan limits)
  const limitsQuery = useQuery({
    queryKey: ['limits', 'schedule-ahead'],
    queryFn: () => campaignApi.getScheduleAheadLimit(),
    staleTime: 60 * 1000,
  });
  const limits = limitsQuery.data?.data as
    | { tier: string; maxAllowed: number; currentCount: number }
    | undefined;
  const atCapacity =
    !!limits && Number.isFinite(limits.maxAllowed) && limits.currentCount >= limits.maxAllowed;
  const limitMessage = atCapacity
    ? `Scheduling limit reached (${limits?.currentCount}/${limits?.maxAllowed}). Upgrade to add more.`
    : '';

  // Initialize form from post (wait for brandTimezone to be loaded)
  useEffect(() => {
    if (!post || !brandTimezone) return;
    if (postAssetIds.length > 0 && !mediaAssetsById) return;

    const normalizedContentType = (post.contentType as InstagramContentType) || 'post';
    const carouselAssetsFromPost: AssetReference[] = (post.mediaAssets || []).map((entry) => {
      const asset = mediaAssetsById?.[entry.assetId] ?? null;
      const type = asset?.fileType === 'video' ? ('video' as const) : ('image' as const);
      return {
        id: entry.assetId,
        url: asset?.url || '',
        type,
      };
    });

    setFormData({
      caption: post.caption || '',
      carouselAssets: carouselAssetsFromPost,
      contentType: normalizedContentType,
      scheduledAt: formatScheduledInput(post.scheduledAt, brandTimezone),
      shareToFeed: normalizedContentType === 'reel' ? (post.shareToFeed ?? true) : true,
      firstComment: (post as any).firstComment || '',
    });
    // Automatically expand the First Comment section when a saved firstComment exists
    setFirstCommentOpen(Boolean((post as any).firstComment));
    setSelectedCampaign(post.campaign?.id || post.campaignId || null);
    const candidate =
      typeof post.targetSocialAccountId === 'string' ? post.targetSocialAccountId.trim() : '';
    setSelectedPlatformAccountIds(candidate ? [candidate] : []);
    platformsInitializedRef.current = true;
    setHasChanges(false);
    formInitializedRef.current = true;
  }, [brandTimezone, mediaAssetsById, post, postAssetIds.length]);

  // Initialize template form from content group (wait for template media to resolve)
  useEffect(() => {
    if (!isMultiDestinationGroup) {
      templateInitializedRef.current = false;
      setTemplateHasChanges(false);
      return;
    }
    if (!contentGroupTemplate) return;
    if (templateAssetIds.length > 0 && !templateAssetsById) return;

    const normalizedContentType =
      (contentGroupTemplate.contentType as InstagramContentType) || 'post';
    setTemplateFormData({
      caption: contentGroupTemplate.caption || '',
      carouselAssets: templateCarouselAssets,
      contentType: normalizedContentType,
      shareToFeed:
        normalizedContentType === 'reel' ? (contentGroupTemplate.shareToFeed ?? true) : true,
      firstComment: contentGroupTemplate.firstComment || '',
    });
    setTemplateFirstCommentOpen(Boolean(contentGroupTemplate.firstComment));
    templateInitializedRef.current = true;
    setTemplateHasChanges(false);
  }, [
    contentGroupTemplate,
    isMultiDestinationGroup,
    templateAssetIds.length,
    templateAssetsById,
    templateCarouselAssets,
  ]);

  // Default account selection in create mode:
  // 1) Brand default social accounts (if configured)
  // 2) Brand primary (top ordered) account
  useEffect(() => {
    if (!isCreating) return;
    if (platformsInitializedRef.current) return;
    if (!socialAccountsQuery.data) return;

    const rawDefaults = (socialAccountsQuery.data as any)?.defaultPostSocialAccountIds;
    if (Array.isArray(rawDefaults)) {
      const byId = new Set(platformPickerOptions.map((o) => o.id));
      const filtered = rawDefaults
        .filter((id: unknown) => typeof id === 'string')
        .map((id: string) => id.trim())
        .filter((id: string) => Boolean(id) && byId.has(id));

      if (filtered.length > 0) {
        setSelectedPlatformAccountIds(Array.from(new Set(filtered)));
        platformsInitializedRef.current = true;
        return;
      }
    }

    const fallbackId = platformPickerOptions[0]?.id || null;

    const next: string[] = [];
    if (fallbackId) next.push(fallbackId);

    setSelectedPlatformAccountIds(next);
    platformsInitializedRef.current = true;
  }, [isCreating, platformPickerOptions, socialAccountsQuery.data]);

  const disabled = post?.status === 'published' || Boolean(post?.postedAt);
  const isScheduled = isMultiDestinationGroup
    ? contentGroupSchedule.kind !== 'none'
    : post?.status === 'scheduled';

  const minScheduleInput = useMemo(
    () => formatInTimeZone(new Date(), brandTimezone, "yyyy-MM-dd'T'HH:mm"),
    [brandTimezone]
  );

  const getScheduleErrorMessage = (
    error: any,
    fallback: string = 'Failed to schedule post. Please try again.'
  ): string => {
    if (error?.data?.errors && Array.isArray(error.data.errors) && error.data.errors[0]) {
      return error.data.errors[0];
    }
    if (typeof error?.data?.message === 'string' && error.data.message) return error.data.message;
    if (error?.data?.error) return error.data.error;
    if (typeof error?.message === 'string' && error.message) return error.message;
    return fallback;
  };

  const { mutateAsync: mutateContentAsync, isPending: isSaving } = useMutation({
    mutationFn: async (data: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      campaignId?: string | null;
      firstComment?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean;
      targetSocialAccountId?: string | null;
    }) => contentApi.updateContent(data),
    onSuccess: (response) => {
      queryClient.setQueryData(['post', id], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          // keep status in case server omits it
          status: response.content?.status || oldData.status,
        } as PostDetailData;
      });
      setHasChanges(false);
    },
    onError: () => toast.error('Failed to save changes'),
  });

  const { mutateAsync: saveTemplateAsync, isPending: isSavingTemplate } = useMutation({
    mutationFn: async (payload: {
      caption: string;
      contentType: InstagramContentType;
      shareToFeed?: boolean | null;
      firstComment?: string | null;
      thumbOffset?: number | null;
      assetIds?: string[];
    }) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.updateContentGroupTemplate(contentGroupId, payload);
    },
    onSuccess: (response: any) => {
      if (!contentGroupId) return;
      queryClient.setQueryData(['content-group', contentGroupId], (oldData: any) => {
        if (!oldData) return oldData;
        const nextTemplate = response?.contentGroup?.template;
        if (!nextTemplate) return oldData;
        return {
          ...oldData,
          contentGroup: {
            ...oldData.contentGroup,
            ...response.contentGroup,
            template: nextTemplate,
          },
        };
      });
      setTemplateHasChanges(false);
      toast.success('Template saved');
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to save template. Please try again.')),
  });

  const { mutateAsync: applyTemplateAsync, isPending: isApplyingTemplate } = useMutation({
    mutationFn: async () => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.applyContentGroupTemplate(contentGroupId);
    },
    onSuccess: () => {
      if (!contentGroupId) return;
      toast.success('Template applied to destinations');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      for (const dest of groupDestinations) {
        queryClient.invalidateQueries({ queryKey: ['post', dest.contentId] });
      }
      const brandId = post?.brand?.id ?? selectedBrand?.id ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to apply template. Please try again.')),
  });

  const { mutateAsync: resetDestinationAsync, isPending: isResettingDestination } = useMutation({
    mutationFn: async () => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      if (!id) throw new Error('Missing contentId');
      return contentApi.resetGroupDestinationToTemplate(contentGroupId, id);
    },
    onSuccess: () => {
      if (!contentGroupId || !id) return;
      toast.success('Destination reset to template');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      queryClient.invalidateQueries({ queryKey: ['post', id] });
      const brandId = post?.brand?.id ?? selectedBrand?.id ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to reset destination. Please try again.')),
  });

  const { mutateAsync: addGroupDestinationsAsync, isPending: isAddingDestination } = useMutation({
    mutationFn: async (payload: { targetSocialAccountId: string }) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.addContentGroupDestinations(contentGroupId, [
        payload.targetSocialAccountId,
      ]);
    },
    onSuccess: () => {
      if (!contentGroupId) return;
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
    },
  });

  const { mutateAsync: addContentDestinationsAsync, isPending: isAddingContentDestination } =
    useMutation({
      mutationFn: async (payload: { targetSocialAccountId: string }) => {
        if (!id) throw new Error('Missing contentId');
        return contentApi.addContentDestinations(id, [payload.targetSocialAccountId]);
      },
      onSuccess: (response: any) => {
        const groupId =
          typeof response?.contentGroupId === 'string' && response.contentGroupId.trim()
            ? response.contentGroupId.trim()
            : null;
        if (groupId) {
          queryClient.invalidateQueries({ queryKey: ['content-group', groupId] });
        }
        if (id) {
          queryClient.invalidateQueries({ queryKey: ['post', id] });
        }
        const brandId = post?.brand?.id ?? selectedBrand?.id ?? null;
        if (brandId) {
          queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
          queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
        }
      },
    });

  const { mutate: unschedulePost, isPending: isUnscheduling } = useMutation({
    mutationFn: async (contentId: string) => {
      return contentApi.updateContent({
        contentId,
        scheduledAt: null,
      });
    },
    onSuccess: (response, contentId) => {
      toast.success('Post unscheduled and moved to Drafts');
      queryClient.setQueryData(['post', contentId], (oldData: PostDetailData | undefined) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          ...response.content,
          status: response.content?.status || 'draft',
        } as PostDetailData;
      });

      const brandId = response.content?.brandId || post?.brand?.id;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
      setHasChanges(false);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error ||
        error?.message ||
        'Failed to unschedule post. Please try again.';
      toast.error(message);
    },
  });

  const { mutateAsync: scheduleContentGroup, isPending: isSchedulingContentGroup } = useMutation({
    mutationFn: async (scheduledAt: string | null) => {
      if (!contentGroupId) throw new Error('Missing contentGroupId');
      return contentApi.scheduleContentGroup(contentGroupId, scheduledAt);
    },
    onSuccess: (_response, scheduledAt) => {
      if (!contentGroupId) return;
      toast.success(scheduledAt ? 'Destinations scheduled' : 'Destinations unscheduled');
      queryClient.invalidateQueries({ queryKey: ['content-group', contentGroupId] });
      for (const dest of groupDestinations) {
        queryClient.invalidateQueries({ queryKey: ['post', dest.contentId] });
      }
      const brandId = post?.brand?.id ?? selectedBrand?.id ?? null;
      if (brandId) {
        queryClient.invalidateQueries({ queryKey: ['calendar', brandId] });
        queryClient.invalidateQueries({ queryKey: ['drafts', brandId] });
      }
    },
    onError: (error: any) =>
      toast.error(getScheduleErrorMessage(error, 'Failed to update destination schedules.')),
  });

  // Create post mutation (for creation mode)
  const { mutate: createPost, isPending: isCreatingPost } = useMutation({
    mutationFn: async (mode: 'draft' | 'schedule') => {
      if (!selectedBrand) throw new Error('No brand selected');

      // Determine final mediaType based on contentType
      // Stories don't support captions or hashtags per Instagram API
      const isStory = formData.contentType === 'story';

      const scheduledUtc =
        mode === 'schedule' && formData.scheduledAt
          ? toUTCFromInput(formData.scheduledAt, brandTimezone)
          : null;

      if (mode === 'schedule') {
        if (!scheduledUtc) throw new Error('Scheduled time required');
        if (scheduledUtc.getTime() <= Date.now()) {
          throw new Error('Scheduled time must be in the future');
        }
      }

      return contentApi.createManualContent({
        brandId: selectedBrand.id,
        caption: isStory ? '' : formData.caption.trim(),
        assetIds: formData.carouselAssets.map((a) => a.id),
        contentType: formData.contentType,
        campaignId: selectedCampaign || undefined,
        shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : undefined,
        firstComment: formData.firstComment?.trim(),
        scheduledAt: scheduledUtc ? scheduledUtc.toISOString() : undefined,
        targetSocialAccountIds: selectedPlatformAccountIds,
      });
    },
    onSuccess: (response: any, mode) => {
      queryClient.invalidateQueries({ queryKey: ['content'] });
      queryClient.invalidateQueries({ queryKey: ['calendar'] });
      queryClient.invalidateQueries({ queryKey: ['drafts'] });

      const isScheduled = mode === 'schedule';
      const hasCampaign = !!selectedCampaign;

      let message = 'Post created successfully!';
      if (isScheduled && hasCampaign) {
        message = 'Scheduling started and added to campaign';
      } else if (isScheduled) {
        message = 'Scheduling started';
      } else if (hasCampaign) {
        message = 'Post created and added to campaign!';
      }

      toast.success(message, {
        description: isScheduled
          ? 'Scheduling started. You can keep editing while we prepare it.'
          : 'Draft created. You can keep editing it here.',
      });

      const createdContentId =
        typeof response?.content?.id === 'string'
          ? response.content.id
          : Array.isArray(response?.contents) && typeof response.contents[0]?.id === 'string'
            ? response.contents[0].id
            : null;

      if (createdContentId) {
        if (layout === 'sidebar') {
          openSidebar('post', { id: createdContentId });
          return;
        }

        navigate(`/posts/${createdContentId}`);
        return;
      }

      // Fallback: navigate to calendar where they can find the new post.
      navigate('/content');
      onRequestClose?.();
    },
    onError: (error: Error) => {
      console.error('Failed to create post:', error);
      toast.error(getScheduleErrorMessage(error, 'Failed to create post. Please try again.'));
    },
  });

  useEffect(() => {
    if (!id || !post || !formInitializedRef.current) {
      if (!id) {
        setHasChanges(false);
      }
      return;
    }

    const trimmedCaption = (formData.caption || '').trim();
    const originalCaption = (post.caption || '').trim();

    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : ''
      : formatScheduledInput(post.scheduledAt, brandTimezone);

    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);
    const originalCampaignId = post.campaign?.id || post.campaignId || null;
    const postContentType = (post.contentType as InstagramContentType) || 'post';
    const formShareToFeed = formData.shareToFeed ?? true;
    const postShareToFeed =
      (postContentType as InstagramContentType | undefined) === 'reel'
        ? (post.shareToFeed ?? true)
        : true;

    const formFirstComment = (formData.firstComment || '').trim();
    const postFirstComment = ((post as any).firstComment || '').trim();

    const postTargetSocialAccountId =
      typeof post.targetSocialAccountId === 'string' && post.targetSocialAccountId.trim()
        ? post.targetSocialAccountId
        : null;

    const changed =
      trimmedCaption !== originalCaption ||
      scheduledValue !== originalScheduled ||
      JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds) ||
      formData.contentType !== postContentType ||
      formShareToFeed !== postShareToFeed ||
      formFirstComment !== postFirstComment ||
      (selectedCampaign || null) !== originalCampaignId ||
      selectedTargetSocialAccountId !== postTargetSocialAccountId;

    setHasChanges(changed);
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    formData,
    id,
    isMultiDestinationGroup,
    post,
    selectedCampaign,
    selectedTargetSocialAccountId,
  ]);

  useEffect(() => {
    if (!isMultiDestinationGroup || !brandTimezone || !formInitializedRef.current) return;
    if (hasChanges) return;
    const next =
      contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : '';
    setFormData((s) => ({ ...s, scheduledAt: next }));
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    hasChanges,
    isMultiDestinationGroup,
  ]);

  useEffect(() => {
    if (!isMultiDestinationGroup || !contentGroupTemplate || !templateInitializedRef.current) {
      if (!isMultiDestinationGroup) setTemplateHasChanges(false);
      return;
    }

    const isStory = templateFormData.contentType === 'story';
    const normalizedContentType =
      (contentGroupTemplate.contentType as InstagramContentType) || 'post';

    const trimmedCaption = isStory ? '' : (templateFormData.caption || '').trim();
    const originalCaption = (
      normalizedContentType === 'story' ? '' : contentGroupTemplate.caption || ''
    ).trim();

    const formAssetIds = (templateFormData.carouselAssets || []).map((asset) => asset.id);
    const originalAssetIds = templateAssetIds;

    const formFirstComment = (templateFormData.firstComment || '').trim();
    const originalFirstComment = (contentGroupTemplate.firstComment || '').trim();

    const formShareToFeed = templateFormData.shareToFeed ?? true;
    const originalShareToFeed =
      normalizedContentType === 'reel' ? (contentGroupTemplate.shareToFeed ?? true) : true;

    const changed =
      trimmedCaption !== originalCaption ||
      templateFormData.contentType !== normalizedContentType ||
      formShareToFeed !== originalShareToFeed ||
      formFirstComment !== originalFirstComment ||
      JSON.stringify(formAssetIds) !== JSON.stringify(originalAssetIds);

    setTemplateHasChanges(changed);
  }, [contentGroupTemplate, isMultiDestinationGroup, templateAssetIds, templateFormData]);

  const mediaChanged = useMemo(() => {
    if (!post) return false;
    const formCarouselIds = (formData.carouselAssets || []).map((a) => a.id);
    const postCarouselIds = (post.mediaAssets || []).map((asset) => asset.assetId);

    return JSON.stringify(formCarouselIds) !== JSON.stringify(postCarouselIds);
  }, [formData.carouselAssets, post]);

  const persistMediaChanges = useCallback(async () => {
    if (!id || !mediaChanged) return;
    const assetIds = formData.carouselAssets.map((a) => a.id).filter(Boolean);
    const validAssetIds = assetIds.filter(
      (assetId) => typeof assetId === 'string' && !assetId.startsWith('http')
    );
    if (!validAssetIds.length) {
      toast.error('Media is missing asset IDs. Please re-select it from the Assets library.');
      throw new Error('Missing asset IDs for media update');
    }

    try {
      await contentApi.updateMedia(id, validAssetIds);
      await queryClient.invalidateQueries({ queryKey: ['post', id] });
    } catch (error) {
      console.error('Failed to update post media', error);
      toast.error('Failed to update post media. Please try again.');
      throw error;
    }
  }, [formData.carouselAssets, id, mediaChanged, queryClient]);

  const handleSaveChanges = async (): Promise<boolean> => {
    if (!id || !hasChanges) return true;

    if (!validation.ok) {
      toast.error(validationError || 'Please fix validation errors before saving');
      return false;
    }

    try {
      await persistMediaChanges();
    } catch {
      return false;
    }

    const hadScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind !== 'none'
      : Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);
    const scheduledValue = formData.scheduledAt || '';
    const originalScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : ''
      : formatScheduledInput(post?.scheduledAt, brandTimezone);
    const scheduleChanged = scheduledValue !== originalScheduled;

    // Respect scheduling blockers (plan limits, validation, paused campaigns) when
    // turning a non-scheduled post into a scheduled one.
    if (scheduleChanged && !hadScheduled && hasScheduledInput && scheduleBlocker) {
      toast.error(scheduleBlocker);
      return false;
    }

    let scheduledAtPayload: string | null | undefined;
    if (!scheduleChanged) {
      scheduledAtPayload = undefined;
    } else if (!hasScheduledInput) {
      scheduledAtPayload = null;
    } else {
      const utcDate = toUTCFromInput(formData.scheduledAt, brandTimezone);
      if (utcDate.getTime() <= Date.now()) {
        toast.error('Scheduled time must be in the future');
        return false;
      }
      scheduledAtPayload = utcDate.toISOString();
    }

    const payload: {
      contentId: string;
      caption?: string;
      scheduledAt?: string | null;
      campaignId?: string | null;
      firstComment?: string;
      contentType?: InstagramContentType;
      shareToFeed?: boolean;
      targetSocialAccountId?: string | null;
    } = {
      contentId: id,
      caption: formData.contentType === 'story' ? '' : (formData.caption || '').trim(),
      campaignId: selectedCampaign || null,
      firstComment: formData.firstComment?.trim(),
    };

    if (!isMultiDestinationGroup && scheduledAtPayload !== undefined) {
      payload.scheduledAt = scheduledAtPayload;
    }

    payload.contentType = formData.contentType;

    if (formData.contentType === 'reel') {
      payload.shareToFeed = formData.shareToFeed;
    }

    const postTargetSocialAccountId =
      typeof post?.targetSocialAccountId === 'string' && post.targetSocialAccountId.trim()
        ? post.targetSocialAccountId
        : null;
    if (selectedTargetSocialAccountId !== postTargetSocialAccountId) {
      payload.targetSocialAccountId = selectedTargetSocialAccountId;
    }

    try {
      await mutateContentAsync(payload);
      if (isMultiDestinationGroup && scheduledAtPayload !== undefined) {
        await scheduleContentGroup(scheduledAtPayload);
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleDestinationSwitch = useCallback(
    async (nextContentId: string) => {
      if (!nextContentId || nextContentId === id) return;

      if (!disabled && hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) return;
      }

      if (layout === 'sidebar') {
        openSidebar('post', { id: nextContentId });
        return;
      }

      navigate(`/posts/${nextContentId}`);
    },
    [disabled, handleSaveChanges, hasChanges, id, layout, navigate, openSidebar]
  );

  useEffect(() => {
    // Reset template tab when switching posts/groups.
    setIsTemplateTab(false);
  }, [contentGroupId, id]);

  const handleGroupTabChange = useCallback(
    async (value: string) => {
      if (!isMultiDestinationGroup || !id) return;

      if (value === 'template') {
        if (!disabled && hasChanges) {
          const ok = await handleSaveChanges();
          if (!ok) return;
        }
        setIsTemplateTab(true);
        return;
      }

      setIsTemplateTab(false);
      await handleDestinationSwitch(value);
    },
    [disabled, handleDestinationSwitch, handleSaveChanges, hasChanges, id, isMultiDestinationGroup]
  );

  const buildTemplatePayload = useCallback(() => {
    const isStory = templateFormData.contentType === 'story';
    const caption = isStory ? '' : (templateFormData.caption || '').trim();
    const firstComment =
      isStory || !templateFormData.firstComment?.trim()
        ? null
        : templateFormData.firstComment.trim();
    const shareToFeed =
      templateFormData.contentType === 'reel' ? templateFormData.shareToFeed : null;
    const assetIds = (templateFormData.carouselAssets || [])
      .map((asset) => asset.id)
      .filter(
        (assetId): assetId is string => typeof assetId === 'string' && assetId.trim().length > 0
      )
      .map((assetId) => assetId.trim());

    return {
      caption,
      contentType: templateFormData.contentType,
      shareToFeed,
      firstComment,
      assetIds,
    };
  }, [templateFormData]);

  const handleSaveTemplate = useCallback(async (): Promise<boolean> => {
    if (!contentGroupId) return false;
    try {
      await saveTemplateAsync(buildTemplatePayload());
      return true;
    } catch {
      return false;
    }
  }, [buildTemplatePayload, contentGroupId, saveTemplateAsync]);

  const handleApplyTemplate = useCallback(async () => {
    if (!contentGroupId) return;
    if (templateHasChanges) {
      const ok = await handleSaveTemplate();
      if (!ok) return;
    }
    await applyTemplateAsync();
  }, [applyTemplateAsync, contentGroupId, handleSaveTemplate, templateHasChanges]);

  const handleResetDestinationToTemplate = useCallback(async () => {
    if (!contentGroupId || !id) return;
    if (!disabled && hasChanges) {
      const ok = window.confirm(
        'You have unsaved changes for this destination. Resetting will discard them. Continue?'
      );
      if (!ok) return;
    }
    await resetDestinationAsync();
  }, [contentGroupId, disabled, hasChanges, id, resetDestinationAsync]);

  const handleAddDestinationToGroup = useCallback(
    async (targetSocialAccountId: string) => {
      if (!isMultiDestinationGroup || !contentGroupId) return;
      const normalized = (targetSocialAccountId || '').trim();
      if (!normalized || groupDestinationSocialAccountIds.has(normalized)) return;
      if (
        disabled ||
        groupHasPublishedDestinations ||
        isSaving ||
        isAddingDestination ||
        isResettingDestination
      )
        return;

      if (isTemplateTab && templateHasChanges) {
        if (!templateValidation.ok) {
          toast.error(
            templateValidationError || 'Complete required fields before adding a new destination.'
          );
          return;
        }
        const ok = await handleSaveTemplate();
        if (!ok) return;
      }

      if (!isTemplateTab && hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) return;
      }

      try {
        const response: any = await addGroupDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const added = Array.isArray(response?.added) ? response.added : [];
        const createdContentId =
          added.find((entry: any) => entry?.targetSocialAccountId === normalized)?.contentId ||
          added[0]?.contentId ||
          null;

        toast.success('Destination added');

        const scheduling = response?.scheduling;
        const results = Array.isArray(scheduling?.results) ? scheduling.results : [];
        const failed = results.find((r: any) => r && r.ok === false);
        if (failed) {
          const errorMessage =
            typeof failed?.error?.message === 'string'
              ? failed.error.message
              : typeof failed?.error?.error === 'string'
                ? failed.error.error
                : 'Scheduling failed for the new destination.';
          toast.error(errorMessage);
        }

        if (createdContentId) {
          setIsTemplateTab(false);
          await handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        const message =
          typeof error?.data?.message === 'string'
            ? error.data.message
            : typeof error?.data?.error === 'string'
              ? error.data.error
              : typeof error?.message === 'string'
                ? error.message
                : 'Failed to add destination';
        toast.error(message);
      }
    },
    [
      addGroupDestinationsAsync,
      contentGroupId,
      disabled,
      groupHasPublishedDestinations,
      groupDestinationSocialAccountIds,
      handleDestinationSwitch,
      handleSaveChanges,
      handleSaveTemplate,
      hasChanges,
      isAddingDestination,
      isMultiDestinationGroup,
      isResettingDestination,
      isSaving,
      isTemplateTab,
      templateHasChanges,
      templateValidation.ok,
      templateValidationError,
    ]
  );

  const handleAddDestinationToSingle = useCallback(
    async (targetSocialAccountId: string) => {
      if (!id || isMultiDestinationGroup) return;
      const normalized = (targetSocialAccountId || '').trim();
      if (!normalized) return;
      if (normalized === selectedTargetSocialAccountId) return;
      if (disabled || isSaving || isAddingContentDestination) return;

      if (hasChanges) {
        const ok = await handleSaveChanges();
        if (!ok) return;
      }

      try {
        const response: any = await addContentDestinationsAsync({
          targetSocialAccountId: normalized,
        });
        const added = Array.isArray(response?.added) ? response.added : [];
        const createdContentId =
          added.find((entry: any) => entry?.targetSocialAccountId === normalized)?.contentId ||
          added[0]?.contentId ||
          null;

        toast.success('Destination added');

        const scheduling = response?.scheduling;
        const results = Array.isArray(scheduling?.results) ? scheduling.results : [];
        const failed = results.find((r: any) => r && r.ok === false);
        if (failed) {
          const errorMessage =
            typeof failed?.error?.message === 'string'
              ? failed.error.message
              : typeof failed?.error?.error === 'string'
                ? failed.error.error
                : 'Scheduling failed for the new destination.';
          toast.error(errorMessage);
        }

        if (createdContentId) {
          await handleDestinationSwitch(createdContentId);
        }
      } catch (error: any) {
        const message =
          typeof error?.data?.message === 'string'
            ? error.data.message
            : typeof error?.data?.error === 'string'
              ? error.data.error
              : typeof error?.message === 'string'
                ? error.message
                : 'Failed to add destination';
        toast.error(message);
      }
    },
    [
      addContentDestinationsAsync,
      disabled,
      handleDestinationSwitch,
      handleSaveChanges,
      hasChanges,
      id,
      isAddingContentDestination,
      isMultiDestinationGroup,
      isSaving,
      selectedTargetSocialAccountId,
    ]
  );

  // Parse query params for prefill
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const qCaption = searchParams.get('caption');
  const qScheduledAt = searchParams.get('scheduledAt');
  const qCampaignId = searchParams.get('campaignId');
  const qAssetId = searchParams.get('assetId');
  const qAssetIdsParam = searchParams.get('assetIds');
  const prefillAssetIds = useMemo(() => {
    const ids = new Set<string>();
    if (qAssetId) ids.add(qAssetId);
    if (qAssetIdsParam) {
      qAssetIdsParam
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .forEach((id) => ids.add(id));
    }
    return Array.from(ids);
  }, [qAssetId, qAssetIdsParam]);

  // Optional asset prefill via React Query (images & videos)
  const { data: prefillAssets, isLoading: isPrefillAssetsLoading } = useQuery({
    queryKey: ['prefill-assets', prefillAssetIds.join(',')],
    enabled: isCreating && prefillAssetIds.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        prefillAssetIds.map(async (id) => {
          try {
            const { asset } = await assetsApi.getAsset(id);
            return asset;
          } catch {
            return null;
          }
        })
      );
      return results.filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    },
    retry: 0,
  });

  // Prefill from query params when creating
  const prefillAppliedRef = useRef(false);
  const wasCreatingRef = useRef<boolean>(isCreating);
  // When switching into creation mode (e.g., from viewing an existing post to creating
  // a new one from the calendar), reset the form so media/caption from the previous
  // post do not leak into the new "New Post" flow.
  useEffect(() => {
    const wasCreating = wasCreatingRef.current;
    wasCreatingRef.current = isCreating;
    if (!isCreating) return;
    if (wasCreating) return;
    setFormData(createEmptyPostFormState());
    setHasChanges(false);
    setFirstCommentOpen(false);
    setSelectedCampaign(null);
    setSelectedPlatformAccountIds([]);
    platformsInitializedRef.current = false;
    formInitializedRef.current = false;
    prefillAppliedRef.current = false;
  }, [isCreating]);

  useEffect(() => {
    if (!isCreating || prefillAppliedRef.current === true) return;
    const hasPrefillInput =
      Boolean(qCaption) ||
      Boolean(qScheduledAt) ||
      Boolean(qCampaignId) ||
      prefillAssetIds.length > 0;
    if (!hasPrefillInput) {
      return;
    }

    // If we have assetIds, wait until the query finishes (success or error)
    if (prefillAssetIds.length > 0 && isPrefillAssetsLoading) {
      return;
    }

    const normalizedAssets: AssetReference[] =
      prefillAssets?.map((asset) => ({
        id: asset.id,
        url: asset.url,
        type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
      })) ?? [];
    const nextAssets = normalizedAssets.slice(0, 10) as AssetReference[];

    setFormData((prev) => {
      return {
        ...prev,
        caption: qCaption ?? prev.caption,
        scheduledAt: qScheduledAt ? formatScheduledInput(qScheduledAt) : prev.scheduledAt,
        ...(nextAssets.length
          ? {
              carouselAssets: nextAssets,
            }
          : {}),
      };
    });
    if (qCampaignId) setSelectedCampaign(qCampaignId);
    prefillAppliedRef.current = true;
  }, [
    isCreating,
    qCaption,
    qScheduledAt,
    qCampaignId,
    prefillAssetIds,
    isPrefillAssetsLoading,
    prefillAssets,
  ]);

  // Fetch campaigns for the brand
  useEffect(() => {
    let mounted = true;
    const fetchCampaigns = async () => {
      const brandId = isCreating ? selectedBrand?.id : post?.brand?.id;
      if (!brandId) return;
      setIsLoadingCampaigns(true);
      try {
        const res = await campaignApi.listCampaigns(brandId);
        if (mounted) setCampaigns((res.campaigns || []) as Campaign[]);
      } catch (_error) {
        if (mounted) toast.error('Failed to load campaigns');
      } finally {
        if (mounted) setIsLoadingCampaigns(false);
      }
    };
    fetchCampaigns();
    return () => {
      mounted = false;
    };
  }, [isCreating, selectedBrand?.id, post?.brand?.id]);

  const selectedCampaignData = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaign) || null,
    [campaigns, selectedCampaign]
  );
  const selectedCampaignPaused = selectedCampaignData?.status === 'paused';

  const scheduleBlocker = getScheduleBlockerMessage({
    atCapacity,
    limitMessage,
    validationOk: validation.ok,
    validationError,
    hasScheduleTime,
    pausedCampaign: Boolean(selectedCampaignPaused),
    hasSelectedPlatforms,
    schedulingSupported: effectiveSchedulingSupported,
  });
  const createScheduleDisabled = isCreatingPost || Boolean(scheduleBlocker);

  const handleCloseSidebar = () => {
    if (layout === 'sidebar') {
      if (!disabled && hasChanges) {
        handleSaveChanges();
      }
      onRequestClose?.();
    }
  };

  const handleOpenCreatePage = () => {
    if (layout === 'sidebar') {
      onRequestClose?.();
    }
    navigate('/posts/create');
  };

  const containerClass = useMemo(
    () =>
      cn(
        'flex flex-col',
        layout === 'sidebar'
          ? 'h-full shadow-lg'
          : 'min-h-[60vh] w-full overflow-hidden rounded-lg border border-border bg-card'
      ),
    [layout]
  );

  const headerClass = useMemo(
    () =>
      cn(
        'bg-card flex items-center justify-between border-b px-4',
        layout === 'sidebar' ? 'sticky top-0 z-30 h-12' : 'h-14 rounded-t'
      ),
    [layout]
  );

  const bodyClass =
    layout === 'sidebar'
      ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-32'
      : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-4';

  const groupBodyClass =
    layout === 'sidebar'
      ? 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-32'
      : 'flex-1 min-h-0 min-w-0 overflow-y-auto px-4 pb-4';

  const activeDestinationLabel = useMemo(() => {
    if (!id || !isMultiDestinationGroup) return null;
    const dest = groupDestinations.find((d) => d.contentId === id);
    return dest?.label ?? null;
  }, [groupDestinations, id, isMultiDestinationGroup]);

  // Allow mixed media for all non-reel content; reels must remain video-only.
  const allowMixedMedia =
    formData.contentType !== 'reel' && !selectedPlatforms.includes('facebook');
  const isVideoMedia = finalMediaType === 'video';
  const previewLayout = layout === 'sidebar' && rightSidebarLayout?.isSmall ? 'page' : layout;
  const showPreviewAsBody = previewOpen && layout === 'sidebar';
  const showPreviewInColumn = previewOpen && previewLayout === 'sidebar' && !showPreviewAsBody;
  const showPreviewInline = previewOpen && previewLayout === 'page' && !showPreviewAsBody;

  useEffect(() => {
    if (!rightSidebarLayout) return;
    if (!showPreviewInColumn) {
      rightSidebarLayout.setExtraWidthPx(0);
      return;
    }
    rightSidebarLayout.setExtraWidthPx(PREVIEW_PANEL_WIDTH);
    return () => rightSidebarLayout.setExtraWidthPx(0);
  }, [rightSidebarLayout, showPreviewInColumn]);

  const previewToggleLabel = previewOpen ? 'Close preview' : 'Open preview';
  const previewToggleButton = !previewOpen ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setPreviewOpen((open) => !open)}
      className="shrink-0"
    >
      {previewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      <span className="hidden sm:inline">{previewOpen ? 'Hide preview' : 'Preview'}</span>
      <span className="sr-only sm:hidden">{previewOpen ? 'Hide preview' : 'Show preview'}</span>
    </Button>
  ) : null;
  const previewHandle =
    layout === 'sidebar' && !previewOpen ? (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => setPreviewOpen((open) => !open)}
              aria-label={previewToggleLabel}
              aria-pressed={previewOpen}
              className={cn(
                'bg-card border-border text-muted-foreground hover:text-foreground h-10 w-12 rounded-t-xl rounded-b-md border-b-0 shadow-sm transition-colors',
                previewOpen && 'text-foreground'
              )}
            >
              <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">
            <p className="text-sm">{previewToggleLabel}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : null;

  const formPreviewMedia = useMemo(
    () => mapAssetReferencesToPreviewMedia(formData.carouselAssets),
    [formData.carouselAssets]
  );
  const formPreviewContent = useMemo<PostPreviewContent>(
    () => ({
      caption: formData.contentType === 'story' ? '' : formData.caption,
      contentType: formData.contentType,
      shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : null,
      firstComment: formData.firstComment,
      media: formPreviewMedia,
    }),
    [
      formData.caption,
      formData.contentType,
      formData.firstComment,
      formData.shareToFeed,
      formPreviewMedia,
    ]
  );

  const templatePreviewMedia = useMemo(
    () => mapAssetReferencesToPreviewMedia(templateFormData.carouselAssets),
    [templateFormData.carouselAssets]
  );
  const templatePreviewContent = useMemo<PostPreviewContent>(
    () => ({
      caption: templateFormData.contentType === 'story' ? '' : templateFormData.caption,
      contentType: templateFormData.contentType,
      shareToFeed: templateFormData.contentType === 'reel' ? templateFormData.shareToFeed : null,
      firstComment: templateFormData.firstComment,
      media: templatePreviewMedia,
    }),
    [
      templateFormData.caption,
      templateFormData.contentType,
      templateFormData.firstComment,
      templateFormData.shareToFeed,
      templatePreviewMedia,
    ]
  );

  const previewAccounts = useMemo(() => {
    if (!platformPickerOptions.length || selectedPlatformAccountIds.length === 0) {
      return [] as PostPreviewAccount[];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    return selectedPlatformAccountIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((opt) => toPreviewAccountFromOption(opt as SocialAccountsPickerOption));
  }, [platformPickerOptions, selectedPlatformAccountIds]);

  const previewItems = useMemo<PostPreviewItem[]>(() => {
    if (isMultiDestinationGroup) {
      if (groupDestinationPreviewData.length === 0) return [];
      if (isTemplateTab) {
        return groupDestinationPreviewData.map((dest) => ({
          account: dest.account,
          content: templatePreviewContent,
          note: getPlatformConfig(dest.account.platform).displayName,
        }));
      }

      const activeDestination = groupDestinationPreviewData.find((dest) => dest.contentId === id);
      if (!activeDestination) return [];
      return [
        {
          account: activeDestination.account,
          content: formPreviewContent,
          note: hasChanges ? 'Editing' : undefined,
        },
      ];
    }

    if (previewAccounts.length === 0) return [];
    return previewAccounts.map((account) => ({
      account,
      content: formPreviewContent,
    }));
  }, [
    formPreviewContent,
    groupDestinationPreviewData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    isTemplateTab,
    previewAccounts,
    templatePreviewContent,
  ]);

  const primaryEditCtaLabel = useMemo(() => {
    if (disabled) return 'Save Changes';
    const hadScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind !== 'none'
      : Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);
    const originalScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind === 'uniform'
        ? formatScheduledInput(contentGroupSchedule.scheduledAt, brandTimezone)
        : ''
      : formatScheduledInput(post?.scheduledAt, brandTimezone);
    const scheduleChanged = (formData.scheduledAt || '') !== originalScheduled;

    if (scheduleChanged && !hadScheduled && hasScheduledInput) {
      // Turning a draft/failed post into a scheduled post
      return 'Save & Schedule';
    }
    if (scheduleChanged && hadScheduled && !hasScheduledInput) {
      // Removing the schedule time
      return 'Save as Draft';
    }
    if (scheduleChanged && hadScheduled && hasScheduledInput) {
      // Staying scheduled, possibly with a new time
      return 'Save & Update Schedule';
    }
    // Pure content changes on an unscheduled post
    return 'Save Changes';
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    disabled,
    formData.scheduledAt,
    isMultiDestinationGroup,
    post?.scheduledAt,
  ]);

  const showInlinePreviewToggle = !showHeader;
  const previewPanelLayout = showPreviewInColumn ? 'sidebar' : 'page';
  const previewPanel = previewOpen ? (
    <PostPreviewPanel
      layout={previewPanelLayout}
      open={previewOpen}
      onOpenChange={setPreviewOpen}
      items={previewItems}
      unstyled={showPreviewAsBody}
    />
  ) : null;
  const inlinePreviewPanel = showPreviewInline ? <div className="pb-3">{previewPanel}</div> : null;

  return (
    <div className={containerClass} role="complementary" aria-labelledby="right-sidebar-title">
      {showHeader ? (
        <div className={headerClass}>
          <div className="min-w-0">
            {id ? (
              <Breadcrumb aria-label="right-sidebar-title">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    {isLoading ? (
                      <BreadcrumbPage>Loading…</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link to={`/posts/${id}`}>{disabled ? 'View Post' : 'Edit Post'}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            ) : (
              <Breadcrumb aria-label="right-sidebar-title">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    {layout === 'sidebar' ? (
                      <BreadcrumbLink asChild>
                        <Link to="/posts/create" onClick={handleOpenCreatePage}>
                          Create New Post
                        </Link>
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage>Create New Post</BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            )}
          </div>
          <div className="flex items-center gap-2 whitespace-nowrap">
            {layout === 'sidebar' && id && !isLoading && post ? (
              <>
                <PostStatusBadge
                  status={(post.status as PostStatus) || 'draft'}
                  generationParams={post.generationParams}
                  schedulingError={post.schedulingError || null}
                  scheduledAt={post.scheduledAt}
                  className="shrink-0 whitespace-nowrap"
                />
                {post.status === 'published' && post.instagramPermalink ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 whitespace-nowrap"
                    onClick={() =>
                      post.instagramPermalink && window.open(post.instagramPermalink, '_blank')
                    }
                  >
                    <Instagram className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">View on Instagram</span>
                    <span className="sr-only sm:hidden">View on Instagram</span>
                  </Button>
                ) : null}
              </>
            ) : null}
            {!isMultiDestinationGroup ? previewToggleButton : null}
            {layout === 'sidebar' ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCloseSidebar}
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {isMultiDestinationGroup ? (
        <>
          <div className="flex min-h-0 flex-1">
            {/* Left rail: "folder tabs" for destinations */}
            <DestinationsRail
              title="Multi-destination group"
              footer={
                <>
                  <Popover
                    open={editDestinationsPopoverOpen}
                    onOpenChange={setEditDestinationsPopoverOpen}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              aria-label="Add destinations"
                              className="text-muted-foreground shadow-none"
                              disabled={
                                disabled ||
                                groupHasPublishedDestinations ||
                                isSaving ||
                                isAddingDestination ||
                                isResettingDestination
                              }
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-sm">
                          {groupHasPublishedDestinations
                            ? 'Cannot add destinations after publishing.'
                            : 'Add destinations'}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    <PopoverContent side="right" align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search destinations…" />
                        <CommandList>
                          <CommandEmpty>No destinations found.</CommandEmpty>
                          <CommandGroup>
                            {platformPickerOptions.map((opt) => {
                              const isAlreadyInGroup = groupDestinationSocialAccountIds.has(opt.id);
                              const platformConfig = getPlatformConfig(opt.platform);
                              const platformLabel = platformConfig.displayName;
                              const shortLabel = opt.label?.trim() || '';
                              const avatarName =
                                opt.avatarName?.trim() || shortLabel || platformLabel;
                              const searchValue =
                                `${platformLabel} ${shortLabel} ${avatarName}`.trim();

                              return (
                                <CommandItem
                                  key={opt.id}
                                  value={searchValue}
                                  onSelect={() => {
                                    if (isAlreadyInGroup) return;
                                    setEditDestinationsPopoverOpen(false);
                                    void handleAddDestinationToGroup(opt.id);
                                  }}
                                  disabled={
                                    Boolean(opt.disabled) ||
                                    disabled ||
                                    isAlreadyInGroup ||
                                    isAddingDestination
                                  }
                                  className="py-2"
                                >
                                  <SocialAccountAvatar
                                    platform={opt.platform}
                                    name={avatarName}
                                    src={opt.avatarUrl}
                                    size="sm"
                                    selected={isAlreadyInGroup}
                                    disabled={Boolean(opt.disabled) || disabled}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                      {platformLabel}
                                    </div>
                                    {shortLabel ? (
                                      <div className="text-muted-foreground truncate text-xs">
                                        {shortLabel}
                                      </div>
                                    ) : null}
                                  </div>
                                  {isAlreadyInGroup ? <Check className="ml-auto h-4 w-4" /> : null}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        aria-label="Destinations help"
                        className="text-muted-foreground shadow-none"
                        onClick={() => setEditDestinationsHelpOpen(true)}
                      >
                        <CircleHelp className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-sm">How destinations work</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              }
            >
              <DestinationsRailItem
                tooltip="Edit the base template for all destinations"
                ariaLabel="Edit template"
                selected={isTemplateTab}
                disabled={isSaving}
                onClick={() => void handleGroupTabChange('template')}
              >
                <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
              </DestinationsRailItem>

              {groupDestinations.map((dest) => {
                const selected = dest.contentId === id && !isTemplateTab;
                const tooltipLabel = dest.disconnected
                  ? `${dest.label} (disconnected)`
                  : dest.label;
                return (
                  <DestinationsRailItem
                    key={dest.contentId}
                    tooltip={tooltipLabel}
                    ariaLabel={`Switch to ${tooltipLabel}`}
                    selected={selected}
                    disabled={isSaving || dest.disconnected}
                    onClick={() => void handleGroupTabChange(dest.contentId)}
                  >
                    <SocialAccountAvatar
                      platform={dest.platform}
                      name={dest.avatarName}
                      src={dest.avatarUrl}
                      size="sm"
                      selected={selected}
                      disabled={dest.disconnected}
                    />
                  </DestinationsRailItem>
                );
              })}
            </DestinationsRail>

            {/* Right panel: editor */}
            <div className={groupBodyClass}>
              {showPreviewAsBody ? (
                previewPanel
              ) : (
                <>
                  <div className="bg-card border-border sticky top-0 z-20 -mx-4 mb-3 border-b px-4 py-2 sm:h-12 sm:py-0">
                    <div className="flex flex-col gap-2 sm:h-full sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="text-muted-foreground text-xs font-medium">
                          {isTemplateTab ? 'Template' : 'Destination'}
                        </div>
                        <div className="text-foreground truncate text-sm font-semibold">
                          {isTemplateTab ? 'Template' : activeDestinationLabel || 'Destination'}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 self-end sm:flex-nowrap sm:self-auto">
                        {isTemplateTab ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={
                                      !templateHasChanges ||
                                      isSavingTemplate ||
                                      isApplyingTemplate ||
                                      !templateValidation.ok
                                    }
                                    onClick={() => void handleSaveTemplate()}
                                  >
                                    Save Template
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {!templateValidation.ok ? (
                                <TooltipContent>
                                  <p className="text-sm">
                                    {templateValidationError ||
                                      'Complete required fields before saving the template.'}
                                  </p>
                                </TooltipContent>
                              ) : null}
                            </Tooltip>

                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={
                                      isApplyingTemplate ||
                                      isSavingTemplate ||
                                      !templateValidation.ok
                                    }
                                    onClick={() => void handleApplyTemplate()}
                                  >
                                    Apply to All
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {!templateValidation.ok ? (
                                <TooltipContent>
                                  <p className="text-sm">
                                    {templateValidationError ||
                                      'Complete required fields before applying the template.'}
                                  </p>
                                </TooltipContent>
                              ) : null}
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={disabled || isResettingDestination}
                            onClick={() => void handleResetDestinationToTemplate()}
                          >
                            Reset to Template
                          </Button>
                        )}
                        {previewToggleButton}
                      </div>
                    </div>
                  </div>

                  {inlinePreviewPanel}

                  {isTemplateTab ? (
                    contentGroupQuery.isLoading || !contentGroupTemplate ? (
                      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                        Loading template...
                      </div>
                    ) : !brandIdForAssets ? (
                      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
                        Template editor unavailable: missing brand context.
                      </div>
                    ) : (
                      <ContentGroupTemplateEditor
                        brandId={brandIdForAssets}
                        platforms={groupPlatforms}
                        value={templateFormData}
                        onChange={(updater) => setTemplateFormData((prev) => updater(prev))}
                        firstCommentOpen={templateFirstCommentOpen}
                        onFirstCommentOpenChange={setTemplateFirstCommentOpen}
                        onOpenAssetPicker={() => {
                          setAssetPickerTarget('template');
                          setShowAssetPicker(true);
                        }}
                      />
                    )
                  ) : (
                    <PostEditorMainBody
                      mode="edit"
                      allowMixedMedia={allowMixedMedia}
                      disabled={disabled}
                      isLoading={isLoading}
                      isVideoMedia={isVideoMedia}
                      post={post}
                      selectedBrand={selectedBrand}
                      formData={formData}
                      setFormData={(updater) => setFormData((prev) => updater(prev))}
                      firstCommentOpen={firstCommentOpen}
                      setFirstCommentOpen={setFirstCommentOpen}
                      campaigns={campaigns}
                      isLoadingCampaigns={isLoadingCampaigns}
                      selectedCampaign={selectedCampaign}
                      setSelectedCampaign={(campaignId) => setSelectedCampaign(campaignId)}
                      selectedCampaignPaused={Boolean(selectedCampaignPaused)}
                      onOpenAssetPicker={() => {
                        setAssetPickerTarget('destination');
                        setShowAssetPicker(true);
                      }}
                      platformOptions={platformPickerOptions}
                      selectedPlatformAccountIds={selectedPlatformAccountIds}
                      onSelectedPlatformAccountIdsChange={handlePlatformAccountsChange}
                    />
                  )}
                </>
              )}
            </div>

            {showPreviewInColumn ? previewPanel : null}
            <Dialog open={editDestinationsHelpOpen} onOpenChange={setEditDestinationsHelpOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Destinations</DialogTitle>
                  <DialogDescription>
                    Multi-destination posts let you keep one shared template while customizing each
                    destination.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">Template vs destination</div>
                    <p className="text-muted-foreground">
                      Use the template tab to edit the shared baseline. Switch destinations to
                      fine-tune per-platform details.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">Add destinations</div>
                    <p className="text-muted-foreground">
                      Use the <span className="text-foreground font-medium">+</span> button to add
                      another connected social account to this group.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : isCreating ? (
        <>
          <div className="flex min-h-0 flex-1">
            <DestinationsRail
              title="Destinations"
              required
              footer={
                <>
                  <Popover
                    open={createDestinationsPopoverOpen}
                    onOpenChange={setCreateDestinationsPopoverOpen}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              aria-label="Add destinations"
                              aria-invalid={showDestinationsRequiredError}
                              className={cn(
                                'text-muted-foreground shadow-none',
                                showDestinationsRequiredError &&
                                  'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20 dark:border-destructive dark:bg-destructive/10 dark:hover:bg-destructive/20'
                              )}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-sm">Add destinations</p>
                      </TooltipContent>
                    </Tooltip>

                    <PopoverContent side="right" align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search destinations…" />
                        <CommandList>
                          <CommandEmpty>No destinations found.</CommandEmpty>
                          <CommandGroup>
                            {platformPickerOptions.map((opt) => {
                              const isSelected = selectedPlatformAccountIds.includes(opt.id);
                              const platformConfig = getPlatformConfig(opt.platform);
                              const platformLabel = platformConfig.displayName;
                              const shortLabel = opt.label?.trim() || '';
                              const avatarName =
                                opt.avatarName?.trim() || shortLabel || platformLabel;
                              const searchValue =
                                `${platformLabel} ${shortLabel} ${avatarName}`.trim();

                              return (
                                <CommandItem
                                  key={opt.id}
                                  value={searchValue}
                                  onSelect={() => toggleCreateDestination(opt.id)}
                                  className="py-2"
                                >
                                  <SocialAccountAvatar
                                    platform={opt.platform}
                                    name={avatarName}
                                    src={opt.avatarUrl}
                                    size="sm"
                                    selected={isSelected}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                      {platformLabel}
                                    </div>
                                    {shortLabel ? (
                                      <div className="text-muted-foreground truncate text-xs">
                                        {shortLabel}
                                      </div>
                                    ) : null}
                                  </div>
                                  {isSelected ? <Check className="ml-auto h-4 w-4" /> : null}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        aria-label="Destinations help"
                        className="text-muted-foreground shadow-none"
                        onClick={() => setCreateDestinationsHelpOpen(true)}
                      >
                        <CircleHelp className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-sm">How destinations work</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              }
            >
              {createSelectedDestinations.map((opt) => {
                const platformConfig = getPlatformConfig(opt.platform);
                const platformLabel = platformConfig.displayName;
                const shortLabel = opt.label?.trim() || '';
                const tooltipLabel = shortLabel
                  ? `${platformLabel} · ${shortLabel}`
                  : platformLabel;
                const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;

                return (
                  <DestinationsRailItem
                    key={opt.id}
                    tooltip={tooltipLabel}
                    ariaLabel={`Remove ${tooltipLabel}`}
                    selected
                    onClick={() => toggleCreateDestination(opt.id)}
                  >
                    <SocialAccountAvatar
                      platform={opt.platform}
                      name={avatarName}
                      src={opt.avatarUrl}
                      size="sm"
                      selected
                    />
                  </DestinationsRailItem>
                );
              })}
            </DestinationsRail>

            <div className={bodyClass}>
              {showPreviewAsBody ? (
                previewPanel
              ) : (
                <>
                  {inlinePreviewPanel}
                  {showInlinePreviewToggle ? (
                    <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
                  ) : null}
                  <PostEditorMainBody
                    mode="create"
                    allowMixedMedia={allowMixedMedia}
                    disabled={disabled}
                    isLoading={isLoading}
                    isVideoMedia={isVideoMedia}
                    post={post}
                    selectedBrand={selectedBrand}
                    formData={formData}
                    setFormData={(updater) => setFormData((prev) => updater(prev))}
                    firstCommentOpen={firstCommentOpen}
                    setFirstCommentOpen={setFirstCommentOpen}
                    campaigns={campaigns}
                    isLoadingCampaigns={isLoadingCampaigns}
                    selectedCampaign={selectedCampaign}
                    setSelectedCampaign={(campaignId) => setSelectedCampaign(campaignId)}
                    selectedCampaignPaused={Boolean(selectedCampaignPaused)}
                    onOpenAssetPicker={() => {
                      setAssetPickerTarget('destination');
                      setShowAssetPicker(true);
                    }}
                    platformOptions={platformPickerOptions}
                    selectedPlatformAccountIds={selectedPlatformAccountIds}
                    onSelectedPlatformAccountIdsChange={handlePlatformAccountsChange}
                    showDestinationsPicker={false}
                  />
                </>
              )}
            </div>

            {showPreviewInColumn ? previewPanel : null}
            <Dialog open={createDestinationsHelpOpen} onOpenChange={setCreateDestinationsHelpOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Destinations</DialogTitle>
                  <DialogDescription>
                    Choose which social accounts this post should publish to.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">Single destination</div>
                    <p className="text-muted-foreground">
                      Creates one post for one social account.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">Multiple destinations</div>
                    <p className="text-muted-foreground">
                      Creates a grouped post. After saving, you can customize each destination in
                      tabs while keeping a shared template.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">How to select</div>
                    <p className="text-muted-foreground">
                      Use the <span className="text-foreground font-medium">+</span> button to add
                      or remove destinations.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : layout === 'sidebar' && id ? (
        <>
          <div className="flex min-h-0 flex-1">
            <DestinationsRail
              title="Destinations"
              required
              footer={
                <>
                  <Popover
                    open={editDestinationsPopoverOpen}
                    onOpenChange={setEditDestinationsPopoverOpen}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-lg"
                              aria-label="Add destinations"
                              aria-invalid={showDestinationsRequiredError}
                              className={cn(
                                'text-muted-foreground shadow-none',
                                showDestinationsRequiredError &&
                                  'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20 dark:border-destructive dark:bg-destructive/10 dark:hover:bg-destructive/20'
                              )}
                              disabled={disabled || isSaving || isAddingContentDestination}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </PopoverTrigger>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-sm">
                          {disabled
                            ? 'Cannot add destinations after publishing.'
                            : 'Add destinations'}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    <PopoverContent side="right" align="start" className="w-80 p-0">
                      <Command>
                        <CommandInput placeholder="Search destinations…" />
                        <CommandList>
                          <CommandEmpty>No destinations found.</CommandEmpty>
                          <CommandGroup>
                            {platformPickerOptions.map((opt) => {
                              const isAlreadySelected = opt.id === selectedTargetSocialAccountId;
                              const platformConfig = getPlatformConfig(opt.platform);
                              const platformLabel = platformConfig.displayName;
                              const shortLabel = opt.label?.trim() || '';
                              const avatarName =
                                opt.avatarName?.trim() || shortLabel || platformLabel;
                              const searchValue =
                                `${platformLabel} ${shortLabel} ${avatarName}`.trim();

                              return (
                                <CommandItem
                                  key={opt.id}
                                  value={searchValue}
                                  onSelect={() => {
                                    if (isAlreadySelected) return;
                                    setEditDestinationsPopoverOpen(false);
                                    void handleAddDestinationToSingle(opt.id);
                                  }}
                                  disabled={
                                    Boolean(opt.disabled) ||
                                    disabled ||
                                    isAlreadySelected ||
                                    isAddingContentDestination
                                  }
                                  className="py-2"
                                >
                                  <SocialAccountAvatar
                                    platform={opt.platform}
                                    name={avatarName}
                                    src={opt.avatarUrl}
                                    size="sm"
                                    selected={isAlreadySelected}
                                    disabled={Boolean(opt.disabled) || disabled}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">
                                      {platformLabel}
                                    </div>
                                    {shortLabel ? (
                                      <div className="text-muted-foreground truncate text-xs">
                                        {shortLabel}
                                      </div>
                                    ) : null}
                                  </div>
                                  {isAlreadySelected ? <Check className="ml-auto h-4 w-4" /> : null}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-lg"
                        aria-label="Destinations help"
                        className="text-muted-foreground shadow-none"
                        onClick={() => setEditDestinationsHelpOpen(true)}
                      >
                        <CircleHelp className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-sm">How destinations work</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              }
            >
              {(() => {
                if (!selectedTargetSocialAccountId) return null;
                const opt = platformPickerOptions.find(
                  (entry) => entry.id === selectedTargetSocialAccountId
                );
                if (!opt) return null;
                const platformConfig = getPlatformConfig(opt.platform);
                const platformLabel = platformConfig.displayName;
                const shortLabel = opt.label?.trim() || '';
                const tooltipLabel = shortLabel
                  ? `${platformLabel} · ${shortLabel}`
                  : platformLabel;
                const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;
                return (
                  <DestinationsRailItem tooltip={tooltipLabel} ariaLabel={tooltipLabel} selected>
                    <SocialAccountAvatar
                      platform={opt.platform}
                      name={avatarName}
                      src={opt.avatarUrl}
                      size="sm"
                      selected
                    />
                  </DestinationsRailItem>
                );
              })()}
            </DestinationsRail>

            <div className={bodyClass}>
              {showPreviewAsBody ? (
                previewPanel
              ) : (
                <>
                  {inlinePreviewPanel}
                  {showInlinePreviewToggle ? (
                    <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
                  ) : null}
                  <PostEditorMainBody
                    mode="edit"
                    allowMixedMedia={allowMixedMedia}
                    disabled={disabled}
                    isLoading={isLoading}
                    isVideoMedia={isVideoMedia}
                    post={post}
                    selectedBrand={selectedBrand}
                    formData={formData}
                    setFormData={(updater) => setFormData((prev) => updater(prev))}
                    firstCommentOpen={firstCommentOpen}
                    setFirstCommentOpen={setFirstCommentOpen}
                    campaigns={campaigns}
                    isLoadingCampaigns={isLoadingCampaigns}
                    selectedCampaign={selectedCampaign}
                    setSelectedCampaign={(campaignId) => setSelectedCampaign(campaignId)}
                    selectedCampaignPaused={Boolean(selectedCampaignPaused)}
                    onOpenAssetPicker={() => {
                      setAssetPickerTarget('destination');
                      setShowAssetPicker(true);
                    }}
                    platformOptions={platformPickerOptions}
                    selectedPlatformAccountIds={selectedPlatformAccountIds}
                    onSelectedPlatformAccountIdsChange={handlePlatformAccountsChange}
                  />
                </>
              )}
            </div>

            {showPreviewInColumn ? previewPanel : null}
            <Dialog open={editDestinationsHelpOpen} onOpenChange={setEditDestinationsHelpOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Destinations</DialogTitle>
                  <DialogDescription>
                    Add more destinations to turn this post into a multi-destination group.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">What happens when you add</div>
                    <p className="text-muted-foreground">
                      We create a shared template from your current post and generate a destination
                      post for each social account you add.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-foreground font-medium">Editing</div>
                    <p className="text-muted-foreground">
                      You can keep one template for the group and customize each destination
                      individually.
                    </p>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : (
        <>
          <div className={bodyClass}>
            {showPreviewAsBody ? (
              previewPanel
            ) : (
              <>
                {inlinePreviewPanel}
                {showInlinePreviewToggle ? (
                  <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
                ) : null}
                <PostEditorMainBody
                  mode={isCreating ? 'create' : 'edit'}
                  allowMixedMedia={allowMixedMedia}
                  disabled={disabled}
                  isLoading={isLoading}
                  isVideoMedia={isVideoMedia}
                  post={post}
                  selectedBrand={selectedBrand}
                  formData={formData}
                  setFormData={(updater) => setFormData((prev) => updater(prev))}
                  firstCommentOpen={firstCommentOpen}
                  setFirstCommentOpen={setFirstCommentOpen}
                  campaigns={campaigns}
                  isLoadingCampaigns={isLoadingCampaigns}
                  selectedCampaign={selectedCampaign}
                  setSelectedCampaign={(campaignId) => setSelectedCampaign(campaignId)}
                  selectedCampaignPaused={Boolean(selectedCampaignPaused)}
                  onOpenAssetPicker={() => {
                    setAssetPickerTarget('destination');
                    setShowAssetPicker(true);
                  }}
                  platformOptions={platformPickerOptions}
                  selectedPlatformAccountIds={selectedPlatformAccountIds}
                  onSelectedPlatformAccountIdsChange={handlePlatformAccountsChange}
                />
              </>
            )}
          </div>
        </>
      )}
      {(() => {
        if (isTemplateTab && isMultiDestinationGroup) return null;
        if (isCreating) {
          if (!selectedBrand) return null;
          return (
            <WriteItBar
              mode="create"
              layout={layout}
              previewHandle={previewHandle}
              scheduledAt={formData.scheduledAt}
              minScheduleInput={minScheduleInput}
              brandTimezone={brandTimezone}
              atCapacity={atCapacity}
              scheduleBlocker={scheduleBlocker}
              createScheduleDisabled={createScheduleDisabled}
              isCreatingPost={isCreatingPost}
              validationOk={validation.ok && hasSelectedPlatforms}
              onScheduledAtChange={(value) => setFormData((s) => ({ ...s, scheduledAt: value }))}
              onSchedule={() => createPost('schedule')}
              onSaveDraft={() => createPost('draft')}
              onUpgradePlan={() => (window.location.href = '/limits')}
            />
          );
        }

        if (isLoading || !post || disabled) return null;

        return (
          <WriteItBar
            mode="edit"
            layout={layout}
            previewHandle={previewHandle}
            scheduledAt={formData.scheduledAt}
            minScheduleInput={minScheduleInput}
            brandTimezone={brandTimezone}
            isScheduled={isScheduled}
            hasChanges={hasChanges}
            isSaving={isMultiDestinationGroup ? isSaving || isSchedulingContentGroup : isSaving}
            isUnscheduling={isMultiDestinationGroup ? isSchedulingContentGroup : isUnscheduling}
            validationOk={validation.ok}
            primaryEditCtaLabel={primaryEditCtaLabel}
            onScheduledAtChange={(value) => setFormData((s) => ({ ...s, scheduledAt: value }))}
            onUnschedule={() => {
              if (isMultiDestinationGroup) {
                void scheduleContentGroup(null);
                return;
              }
              if (id) unschedulePost(id);
            }}
            onSave={handleSaveChanges}
          />
        );
      })()}
      {showAssetPicker && brandIdForAssets && (
        <AssetPicker
          brandId={brandIdForAssets}
          type={
            assetPickerTarget === 'template'
              ? templateFormData.contentType === 'reel'
                ? 'video'
                : undefined
              : formData.contentType === 'reel'
                ? 'video'
                : undefined
          }
          onSelectMany={(assets) => {
            const normalized: AssetReference[] = assets.map((asset) => ({
              id: asset.id,
              url: asset.url,
              type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
            }));

            const applyAssetSelection = (
              state: { contentType: InstagramContentType; carouselAssets: AssetReference[] },
              options?: { disallowMixed?: boolean }
            ) => {
              const allowMixing = state.contentType === 'post' && options?.disallowMixed !== true;
              if (!allowMixing) {
                const firstVideo = normalized.find((asset) => asset.type === 'video') || null;
                const imageAssets = normalized.filter((asset) => asset.type !== 'video');
                return firstVideo ? [firstVideo] : imageAssets.slice(0, 10);
              }
              return mergeUniqueAssets([...state.carouselAssets, ...normalized], 10);
            };

            if (assetPickerTarget === 'template') {
              setTemplateFormData((s) => ({
                ...s,
                carouselAssets: applyAssetSelection(s, {
                  disallowMixed: groupPlatforms.includes('facebook'),
                }),
              }));
            } else {
              setFormData((s) => ({
                ...s,
                carouselAssets: applyAssetSelection(s, {
                  disallowMixed: selectedPlatforms.includes('facebook'),
                }),
              }));
            }
            setShowAssetPicker(false);
          }}
          onClose={() => setShowAssetPicker(false)}
        />
      )}
    </div>
  );
}
