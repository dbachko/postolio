import { useEffect, useMemo, useRef, useState } from 'react';

import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { ContentGroupTemplateFormState } from '@/components/post-editor/content-group-template-editor/types';
import { getPlatformConfig, type Platform } from '@/lib/platform-config';
import {
  validateContentPayload,
  type InstagramContentType,
  type InstagramMediaType,
} from '@postolio/content-validation';

import {
  createEmptyTemplateFormState,
  deriveMediaTypeFromAssets,
  toValidationPlatform,
} from '../utils';

export function usePostEditorTemplateForm(params: {
  id?: string;
  contentGroupId: string | null;
  isMultiDestinationGroup: boolean;
  contentGroupTemplate: {
    caption: string;
    contentType: InstagramContentType;
    shareToFeed: boolean | null;
    firstComment: string | null;
  } | null;
  groupPlatforms: Platform[];
  templateAssetIds: string[];
  templateAssetsById: Record<string, unknown> | undefined;
  templateCarouselAssets: AssetReference[];
}) {
  const {
    contentGroupId,
    contentGroupTemplate,
    groupPlatforms,
    id,
    isMultiDestinationGroup,
    templateAssetIds,
    templateAssetsById,
    templateCarouselAssets,
  } = params;

  const [templateFormData, setTemplateFormData] = useState<ContentGroupTemplateFormState>(() =>
    createEmptyTemplateFormState()
  );
  const [templateHasChanges, setTemplateHasChanges] = useState(false);
  const templateInitializedRef = useRef(false);
  const [templateFirstCommentOpen, setTemplateFirstCommentOpen] = useState(false);
  const [isTemplateTab, setIsTemplateTab] = useState(false);

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

  useEffect(() => {
    setIsTemplateTab(false);
  }, [contentGroupId, id]);

  const templateMediaType = useMemo<InstagramMediaType>(() => {
    return deriveMediaTypeFromAssets(templateFormData.carouselAssets, templateFormData.contentType);
  }, [templateFormData.carouselAssets, templateFormData.contentType]);

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

    const formFirstComment = templateFirstCommentOpen
      ? (templateFormData.firstComment || '').trim()
      : '';
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
  }, [
    contentGroupTemplate,
    isMultiDestinationGroup,
    templateAssetIds,
    templateFirstCommentOpen,
    templateFormData,
  ]);

  const allowMixedTemplateMedia = useMemo(() => {
    const platforms = groupPlatforms.length ? groupPlatforms : (['instagram'] as Platform[]);
    return templateFormData.contentType !== 'reel' && !platforms.includes('facebook');
  }, [groupPlatforms, templateFormData.contentType]);

  const templateQueueSupported = useMemo(() => {
    if (!isMultiDestinationGroup) return false;
    const platforms = groupPlatforms.length ? groupPlatforms : (['instagram'] as Platform[]);
    return platforms.every((p) => {
      try {
        return getPlatformConfig(p).features.scheduling;
      } catch {
        return false;
      }
    });
  }, [groupPlatforms, isMultiDestinationGroup]);

  return {
    templateFormData,
    setTemplateFormData,
    templateHasChanges,
    setTemplateHasChanges,
    templateInitializedRef,
    templateFirstCommentOpen,
    setTemplateFirstCommentOpen,
    isTemplateTab,
    setIsTemplateTab,
    templateValidation,
    templateValidationError,
    allowMixedTemplateMedia,
    templateQueueSupported,
  };
}
