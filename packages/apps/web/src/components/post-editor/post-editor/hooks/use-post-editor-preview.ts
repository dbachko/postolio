import { useEffect, useMemo } from 'react';

import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type {
  PostPreviewAccount,
  PostPreviewContent,
  PostPreviewItem,
} from '@/components/post-preview/types';
import { getPlatformConfig } from '@/lib/platform-config';
import { useRightSidebarLayout } from '@/right-sidebar/right-sidebar-context';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';
import type { PostEditorLayout } from '../types';
import { PREVIEW_PANEL_WIDTH } from '../constants';
import {
  formatScheduledInput,
  mapAssetReferencesToPreviewMedia,
  toPreviewAccountFromOption,
} from '../utils';

type UsePostEditorPreviewParams = {
  id?: string;
  layout: PostEditorLayout;
  showHeader: boolean;
  disabled: boolean;
  isMultiDestinationGroup: boolean;
  isTemplateTab: boolean;
  previewOpen: boolean;
  hasChanges: boolean;
  post: PostDetailData | undefined;
  brandTimezone: string;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  formData: PostEditorFormState;
  firstCommentOpen: boolean;
  templateFormData: ContentGroupTemplateFormState;
  templateFirstCommentOpen: boolean;
  groupDestinationPreviewData: Array<{ contentId: string; account: PostPreviewAccount }>;
  platformPickerOptions: SocialAccountsPickerOption[];
  selectedPlatformAccountIds: string[];
};

function usePreviewLayout(layout: PostEditorLayout, previewOpen: boolean, showHeader: boolean) {
  const rightSidebarLayout = useRightSidebarLayout();
  const previewLayout = layout === 'sidebar' && rightSidebarLayout?.isSmall ? 'page' : layout;
  const showPreviewAsBody = previewOpen && layout === 'sidebar';
  const showPreviewInColumn = previewOpen && previewLayout === 'sidebar' && !showPreviewAsBody;
  const showPreviewInline = previewOpen && previewLayout === 'page' && !showPreviewAsBody;

  useEffect(() => {
    if (!rightSidebarLayout) {
      return;
    }
    if (!showPreviewInColumn) {
      rightSidebarLayout.setExtraWidthPx(0);
      return;
    }
    rightSidebarLayout.setExtraWidthPx(PREVIEW_PANEL_WIDTH);
    return () => rightSidebarLayout.setExtraWidthPx(0);
  }, [rightSidebarLayout, showPreviewInColumn]);

  return {
    previewLayout,
    showPreviewAsBody,
    showPreviewInColumn,
    showPreviewInline,
    showInlinePreviewToggle: !showHeader,
    previewPanelLayout: showPreviewInColumn ? ('sidebar' as const) : ('page' as const),
  };
}

function usePreviewContent(
  formData: PostEditorFormState,
  firstCommentOpen: boolean,
  templateFormData: ContentGroupTemplateFormState,
  templateFirstCommentOpen: boolean
) {
  const formPreviewMedia = useMemo(
    () => mapAssetReferencesToPreviewMedia(formData.carouselAssets),
    [formData.carouselAssets]
  );
  const formPreviewContent = useMemo<PostPreviewContent>(
    () => ({
      caption: formData.contentType === 'story' ? '' : formData.caption,
      contentType: formData.contentType,
      shareToFeed: formData.contentType === 'reel' ? formData.shareToFeed : null,
      firstComment:
        formData.contentType === 'story' || !firstCommentOpen ? '' : formData.firstComment || '',
      media: formPreviewMedia,
    }),
    [
      firstCommentOpen,
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
      firstComment:
        templateFormData.contentType === 'story' || !templateFirstCommentOpen
          ? ''
          : templateFormData.firstComment || '',
      media: templatePreviewMedia,
    }),
    [
      templateFirstCommentOpen,
      templateFormData.caption,
      templateFormData.contentType,
      templateFormData.firstComment,
      templateFormData.shareToFeed,
      templatePreviewMedia,
    ]
  );

  return { formPreviewMedia, formPreviewContent, templatePreviewMedia, templatePreviewContent };
}

function usePreviewAccounts(
  platformPickerOptions: SocialAccountsPickerOption[],
  selectedPlatformAccountIds: string[]
) {
  return useMemo(() => {
    if (!platformPickerOptions.length || selectedPlatformAccountIds.length === 0) {
      return [] as PostPreviewAccount[];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    return selectedPlatformAccountIds
      .map((selectedId) => byId.get(selectedId))
      .filter(Boolean)
      .map((opt) => toPreviewAccountFromOption(opt as SocialAccountsPickerOption));
  }, [platformPickerOptions, selectedPlatformAccountIds]);
}

function useFallbackPreviewAccount(params: {
  isMultiDestinationGroup: boolean;
  previewAccounts: PostPreviewAccount[];
  post: PostDetailData | undefined;
  platformPickerOptions: SocialAccountsPickerOption[];
}) {
  const { isMultiDestinationGroup, platformPickerOptions, post, previewAccounts } = params;

  return useMemo(() => {
    if (isMultiDestinationGroup || previewAccounts.length > 0 || !post) {
      return null;
    }
    const targetId =
      typeof post.targetSocialAccountId === 'string' ? post.targetSocialAccountId.trim() : '';
    const preferred =
      targetId.length > 0
        ? platformPickerOptions.find((option) => option.id === targetId) || null
        : null;
    const fallback = preferred || platformPickerOptions[0] || null;
    return fallback ? toPreviewAccountFromOption(fallback) : null;
  }, [isMultiDestinationGroup, platformPickerOptions, post, previewAccounts.length]);
}

function usePreviewItems(params: {
  fallbackPreviewAccount: PostPreviewAccount | null;
  formPreviewContent: PostPreviewContent;
  groupDestinationPreviewData: Array<{ contentId: string; account: PostPreviewAccount }>;
  hasChanges: boolean;
  id?: string;
  isMultiDestinationGroup: boolean;
  isTemplateTab: boolean;
  previewAccounts: PostPreviewAccount[];
  templatePreviewContent: PostPreviewContent;
}) {
  const {
    fallbackPreviewAccount,
    formPreviewContent,
    groupDestinationPreviewData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    isTemplateTab,
    previewAccounts,
    templatePreviewContent,
  } = params;

  return useMemo(() => {
    if (isMultiDestinationGroup) {
      if (groupDestinationPreviewData.length === 0) {
        return [] as PostPreviewItem[];
      }
      if (isTemplateTab) {
        return groupDestinationPreviewData.map((dest) => ({
          account: dest.account,
          content: templatePreviewContent,
          note: getPlatformConfig(dest.account.platform).displayName,
        }));
      }
      const activeDestination = groupDestinationPreviewData.find((dest) => dest.contentId === id);
      if (!activeDestination) {
        return [] as PostPreviewItem[];
      }
      const note = hasChanges ? 'Editing' : undefined;
      return [{ account: activeDestination.account, content: formPreviewContent, note }];
    }

    if (previewAccounts.length > 0) {
      return previewAccounts.map((account) => ({ account, content: formPreviewContent }));
    }
    if (fallbackPreviewAccount) {
      return [{ account: fallbackPreviewAccount, content: formPreviewContent }];
    }
    return [] as PostPreviewItem[];
  }, [
    fallbackPreviewAccount,
    formPreviewContent,
    groupDestinationPreviewData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    isTemplateTab,
    previewAccounts,
    templatePreviewContent,
  ]);
}

function resolveOriginalScheduledForEditLabel(params: {
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  post: PostDetailData | undefined;
  brandTimezone: string;
}) {
  if (!params.isMultiDestinationGroup) {
    return formatScheduledInput(params.post?.scheduledAt, params.brandTimezone);
  }
  if (params.contentGroupSchedule.kind === 'uniform') {
    return formatScheduledInput(params.contentGroupSchedule.scheduledAt, params.brandTimezone);
  }
  return '';
}

function resolvePrimaryEditLabel(params: {
  scheduleChanged: boolean;
  hadScheduled: boolean;
  hasScheduledInput: boolean;
}) {
  if (!params.scheduleChanged) {
    return 'Save';
  }
  if (!params.hadScheduled && params.hasScheduledInput) {
    return 'Save & Schedule';
  }
  if (params.hadScheduled && !params.hasScheduledInput) {
    return 'Save as Draft';
  }
  if (params.hadScheduled && params.hasScheduledInput) {
    return 'Save & Update Schedule';
  }
  return 'Save';
}

function usePrimaryEditCtaLabel(params: {
  disabled: boolean;
  isMultiDestinationGroup: boolean;
  contentGroupSchedule: { kind: 'none' | 'uniform' | 'mixed'; scheduledAt: string | null };
  post: PostDetailData | undefined;
  formData: PostEditorFormState;
  brandTimezone: string;
}) {
  const { brandTimezone, contentGroupSchedule, disabled, formData, isMultiDestinationGroup, post } =
    params;

  return useMemo(() => {
    if (disabled) {
      return 'Save';
    }
    const hadScheduled = isMultiDestinationGroup
      ? contentGroupSchedule.kind !== 'none'
      : Boolean(post?.scheduledAt);
    const hasScheduledInput = Boolean(formData.scheduledAt);
    const originalScheduled = resolveOriginalScheduledForEditLabel({
      isMultiDestinationGroup,
      contentGroupSchedule,
      post,
      brandTimezone,
    });
    const scheduleChanged = (formData.scheduledAt || '') !== originalScheduled;
    return resolvePrimaryEditLabel({ scheduleChanged, hadScheduled, hasScheduledInput });
  }, [
    brandTimezone,
    contentGroupSchedule,
    disabled,
    formData.scheduledAt,
    isMultiDestinationGroup,
    post,
  ]);
}

export function usePostEditorPreview(params: UsePostEditorPreviewParams) {
  const layoutState = usePreviewLayout(params.layout, params.previewOpen, params.showHeader);
  const previewContent = usePreviewContent(
    params.formData,
    params.firstCommentOpen,
    params.templateFormData,
    params.templateFirstCommentOpen
  );
  const previewAccounts = usePreviewAccounts(
    params.platformPickerOptions,
    params.selectedPlatformAccountIds
  );
  const fallbackPreviewAccount = useFallbackPreviewAccount({
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    previewAccounts,
    post: params.post,
    platformPickerOptions: params.platformPickerOptions,
  });

  const previewItems = usePreviewItems({
    fallbackPreviewAccount,
    formPreviewContent: previewContent.formPreviewContent,
    groupDestinationPreviewData: params.groupDestinationPreviewData,
    hasChanges: params.hasChanges,
    id: params.id,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    isTemplateTab: params.isTemplateTab,
    previewAccounts,
    templatePreviewContent: previewContent.templatePreviewContent,
  });

  const publicationLinks = useMemo(() => {
    const links: Array<{ platform: string; url: string }> = [];
    if (params.post?.status === 'published' && params.post.instagramPermalink) {
      links.push({ platform: 'instagram', url: String(params.post.instagramPermalink) });
    }
    return links;
  }, [params.post?.instagramPermalink, params.post?.status]);

  const publicationPreview = useMemo(() => {
    const isTemplatePreview = params.isTemplateTab && params.isMultiDestinationGroup;
    return {
      contentType: isTemplatePreview
        ? params.templateFormData.contentType
        : params.formData.contentType,
      media: isTemplatePreview
        ? previewContent.templatePreviewMedia
        : previewContent.formPreviewMedia,
    };
  }, [
    params.formData.contentType,
    params.isMultiDestinationGroup,
    params.isTemplateTab,
    params.templateFormData.contentType,
    previewContent.formPreviewMedia,
    previewContent.templatePreviewMedia,
  ]);

  const primaryEditCtaLabel = usePrimaryEditCtaLabel({
    disabled: params.disabled,
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupSchedule: params.contentGroupSchedule,
    post: params.post,
    formData: params.formData,
    brandTimezone: params.brandTimezone,
  });

  return {
    ...layoutState,
    previewItems,
    publicationLinks,
    publicationPreview,
    primaryEditCtaLabel,
  };
}
