import { useEffect, useMemo } from 'react';

import { useRightSidebarLayout } from '@/right-sidebar/right-sidebar-context';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';
import type { PostDetailData } from '@/hooks/usePostDetail';
import type {
  PostPreviewAccount,
  PostPreviewContent,
  PostPreviewItem,
} from '@/components/post-preview/types';
import { getPlatformConfig } from '@/lib/platform-config';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';
import type { PostEditorLayout } from '../types';
import { PREVIEW_PANEL_WIDTH } from '../constants';
import {
  formatScheduledInput,
  mapAssetReferencesToPreviewMedia,
  toPreviewAccountFromOption,
} from '../utils';

export function usePostEditorPreview(params: {
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
}) {
  const {
    brandTimezone,
    contentGroupSchedule,
    disabled,
    firstCommentOpen,
    formData,
    groupDestinationPreviewData,
    hasChanges,
    id,
    isMultiDestinationGroup,
    isTemplateTab,
    layout,
    platformPickerOptions,
    post,
    previewOpen,
    selectedPlatformAccountIds,
    showHeader,
    templateFirstCommentOpen,
    templateFormData,
  } = params;

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

  const showInlinePreviewToggle = !showHeader;
  const previewPanelLayout: 'sidebar' | 'page' = showPreviewInColumn ? 'sidebar' : 'page';

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

  const previewAccounts = useMemo(() => {
    if (!platformPickerOptions.length || selectedPlatformAccountIds.length === 0) {
      return [] as PostPreviewAccount[];
    }
    const byId = new Map(platformPickerOptions.map((opt) => [opt.id, opt]));
    return selectedPlatformAccountIds
      .map((selectedId) => byId.get(selectedId))
      .filter(Boolean)
      .map((opt) => toPreviewAccountFromOption(opt as SocialAccountsPickerOption));
  }, [platformPickerOptions, selectedPlatformAccountIds]);

  const fallbackPreviewAccount = useMemo<PostPreviewAccount | null>(() => {
    if (isMultiDestinationGroup) {
      return null;
    }
    if (previewAccounts.length > 0) {
      return null;
    }
    if (!post) {
      return null;
    }

    const targetId =
      typeof post.targetSocialAccountId === 'string' ? post.targetSocialAccountId.trim() : '';
    const preferred =
      targetId.length > 0
        ? platformPickerOptions.find((option) => option.id === targetId) || null
        : null;
    const fallback = preferred || platformPickerOptions[0] || null;
    if (!fallback) {
      return null;
    }
    return toPreviewAccountFromOption(fallback);
  }, [isMultiDestinationGroup, platformPickerOptions, post, previewAccounts.length]);

  const previewItems = useMemo<PostPreviewItem[]>(() => {
    if (isMultiDestinationGroup) {
      if (groupDestinationPreviewData.length === 0) {
        return [];
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
        return [];
      }
      return [
        {
          account: activeDestination.account,
          content: formPreviewContent,
          note: hasChanges ? 'Editing' : undefined,
        },
      ];
    }

    const effectivePreviewAccounts =
      previewAccounts.length > 0
        ? previewAccounts
        : fallbackPreviewAccount
          ? [fallbackPreviewAccount]
          : [];

    if (effectivePreviewAccounts.length === 0) {
      return [];
    }
    return effectivePreviewAccounts.map((account) => ({
      account,
      content: formPreviewContent,
    }));
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

  const publicationLinks = useMemo(() => {
    const links: Array<{ platform: string; url: string }> = [];
    if (post?.status === 'published' && post.instagramPermalink) {
      links.push({ platform: 'instagram', url: String(post.instagramPermalink) });
    }
    return links;
  }, [post?.instagramPermalink, post?.status]);

  const publicationPreview = useMemo(() => {
    const isTemplatePreview = isTemplateTab && isMultiDestinationGroup;
    const media = (isTemplatePreview ? templatePreviewMedia : formPreviewMedia) || [];
    const contentType = isTemplatePreview ? templateFormData.contentType : formData.contentType;
    return {
      contentType,
      media,
    };
  }, [
    formData.contentType,
    formPreviewMedia,
    isMultiDestinationGroup,
    isTemplateTab,
    templateFormData.contentType,
    templatePreviewMedia,
  ]);

  const primaryEditCtaLabel = useMemo(() => {
    if (disabled) {
      return 'Save';
    }
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
      return 'Save & Schedule';
    }
    if (scheduleChanged && hadScheduled && !hasScheduledInput) {
      return 'Save as Draft';
    }
    if (scheduleChanged && hadScheduled && hasScheduledInput) {
      return 'Save & Update Schedule';
    }
    return 'Save';
  }, [
    brandTimezone,
    contentGroupSchedule.kind,
    contentGroupSchedule.scheduledAt,
    disabled,
    formData.scheduledAt,
    isMultiDestinationGroup,
    post?.scheduledAt,
  ]);

  return {
    previewLayout,
    showPreviewAsBody,
    showPreviewInColumn,
    showPreviewInline,
    showInlinePreviewToggle,
    previewPanelLayout,
    previewItems,
    publicationLinks,
    publicationPreview,
    primaryEditCtaLabel,
  };
}
