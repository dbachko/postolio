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

type UsePostEditorTemplateFormParams = {
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
};

function useTemplateInitialization(params: {
  isMultiDestinationGroup: boolean;
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'];
  templateAssetIds: string[];
  templateAssetsById: Record<string, unknown> | undefined;
  templateCarouselAssets: AssetReference[];
  setTemplateFormData: React.Dispatch<React.SetStateAction<ContentGroupTemplateFormState>>;
  setTemplateFirstCommentOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setTemplateHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  templateInitializedRef: React.MutableRefObject<boolean>;
}) {
  const {
    contentGroupTemplate,
    isMultiDestinationGroup,
    setTemplateFirstCommentOpen,
    setTemplateFormData,
    setTemplateHasChanges,
    templateAssetIds,
    templateAssetsById,
    templateCarouselAssets,
    templateInitializedRef,
  } = params;

  useEffect(() => {
    if (!isMultiDestinationGroup) {
      templateInitializedRef.current = false;
      setTemplateHasChanges(false);
      return;
    }
    if (!contentGroupTemplate) {
      return;
    }
    if (templateAssetIds.length > 0 && !templateAssetsById) {
      return;
    }

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
    setTemplateFirstCommentOpen,
    setTemplateFormData,
    setTemplateHasChanges,
    templateAssetIds.length,
    templateAssetsById,
    templateCarouselAssets,
    templateInitializedRef,
  ]);
}

function buildTemplateValidation(params: {
  isMultiDestinationGroup: boolean;
  templateFormData: ContentGroupTemplateFormState;
  templateMediaType: InstagramMediaType;
  groupPlatforms: Platform[];
}) {
  if (!params.isMultiDestinationGroup) {
    return { ok: true, errors: [] as any[] };
  }

  const isStory = params.templateFormData.contentType === 'story';
  const mediaAssets = (params.templateFormData.carouselAssets || [])
    .filter((asset) => typeof asset.id === 'string' && asset.id.trim().length > 0)
    .map((asset) => ({
      key: asset.id,
      type: (asset.type === 'video' ? 'video' : 'image') as InstagramMediaType,
    }));

  const platformsForValidation: Platform[] =
    params.groupPlatforms.length > 0 ? params.groupPlatforms : ['instagram'];
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
        contentType: params.templateFormData.contentType,
        mediaType: mediaAssets.length > 0 ? params.templateMediaType : undefined,
        caption: isStory ? '' : params.templateFormData.caption,
        mediaAssets,
      }),
    };
  });

  const firstFail = validations.find((value) => !value.result.ok);
  if (!firstFail) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: firstFail.result.errors.map((error) => ({
      ...error,
      message: `${firstFail.platform}: ${error.message}`,
    })),
  };
}

function useTemplateDirtyTracking(params: {
  isMultiDestinationGroup: boolean;
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'];
  templateInitializedRef: React.MutableRefObject<boolean>;
  templateFormData: ContentGroupTemplateFormState;
  templateAssetIds: string[];
  templateFirstCommentOpen: boolean;
  setTemplateHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    contentGroupTemplate,
    isMultiDestinationGroup,
    setTemplateHasChanges,
    templateAssetIds,
    templateFirstCommentOpen,
    templateFormData,
    templateInitializedRef,
  } = params;

  useEffect(() => {
    if (!isMultiDestinationGroup || !contentGroupTemplate || !templateInitializedRef.current) {
      if (!isMultiDestinationGroup) {
        setTemplateHasChanges(false);
      }
      return;
    }
    setTemplateHasChanges(
      hasTemplateFormChanges({
        contentGroupTemplate,
        templateFormData,
        templateAssetIds,
        templateFirstCommentOpen,
      })
    );
  }, [
    contentGroupTemplate,
    isMultiDestinationGroup,
    setTemplateHasChanges,
    templateAssetIds,
    templateFirstCommentOpen,
    templateFormData,
    templateInitializedRef,
  ]);
}

function hasTemplateFormChanges(params: {
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'];
  templateFormData: ContentGroupTemplateFormState;
  templateAssetIds: string[];
  templateFirstCommentOpen: boolean;
}) {
  const normalizedContentType =
    (params.contentGroupTemplate?.contentType as InstagramContentType) || 'post';
  const { trimmedCaption, originalCaption } = getTemplateCaptionComparisonValues(
    params.templateFormData,
    params.contentGroupTemplate,
    normalizedContentType
  );
  const formAssetIds = (params.templateFormData.carouselAssets || []).map((asset) => asset.id);
  const { formFirstComment, originalFirstComment } = getTemplateFirstCommentComparisonValues(
    params.templateFormData,
    params.contentGroupTemplate,
    params.templateFirstCommentOpen
  );
  const { formShareToFeed, originalShareToFeed } = getTemplateShareToFeedComparisonValues(
    params.templateFormData,
    params.contentGroupTemplate,
    normalizedContentType
  );

  return (
    trimmedCaption !== originalCaption ||
    params.templateFormData.contentType !== normalizedContentType ||
    formShareToFeed !== originalShareToFeed ||
    formFirstComment !== originalFirstComment ||
    JSON.stringify(formAssetIds) !== JSON.stringify(params.templateAssetIds)
  );
}

function getTemplateCaptionComparisonValues(
  templateFormData: ContentGroupTemplateFormState,
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'],
  normalizedContentType: InstagramContentType
) {
  const isStory = templateFormData.contentType === 'story';
  return {
    trimmedCaption: isStory ? '' : (templateFormData.caption || '').trim(),
    originalCaption:
      normalizedContentType === 'story' ? '' : (contentGroupTemplate?.caption || '').trim(),
  };
}

function getTemplateFirstCommentComparisonValues(
  templateFormData: ContentGroupTemplateFormState,
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'],
  templateFirstCommentOpen: boolean
) {
  return {
    formFirstComment: templateFirstCommentOpen ? (templateFormData.firstComment || '').trim() : '',
    originalFirstComment: (contentGroupTemplate?.firstComment || '').trim(),
  };
}

function getTemplateShareToFeedComparisonValues(
  templateFormData: ContentGroupTemplateFormState,
  contentGroupTemplate: UsePostEditorTemplateFormParams['contentGroupTemplate'],
  normalizedContentType: InstagramContentType
) {
  return {
    formShareToFeed: templateFormData.shareToFeed ?? true,
    originalShareToFeed:
      normalizedContentType === 'reel' ? (contentGroupTemplate?.shareToFeed ?? true) : true,
  };
}

function useAllowMixedTemplateMedia(
  groupPlatforms: Platform[],
  contentType: InstagramContentType
): boolean {
  return useMemo(() => {
    const platforms = groupPlatforms.length ? groupPlatforms : (['instagram'] as Platform[]);
    return contentType !== 'reel' && !platforms.includes('facebook');
  }, [groupPlatforms, contentType]);
}

function useTemplateQueueSupported(params: {
  isMultiDestinationGroup: boolean;
  groupPlatforms: Platform[];
}): boolean {
  return useMemo(() => {
    if (!params.isMultiDestinationGroup) {
      return false;
    }
    const platforms = params.groupPlatforms.length
      ? params.groupPlatforms
      : (['instagram'] as Platform[]);
    return platforms.every((platform) => {
      try {
        return getPlatformConfig(platform).features.scheduling;
      } catch {
        return false;
      }
    });
  }, [params.groupPlatforms, params.isMultiDestinationGroup]);
}

export function usePostEditorTemplateForm(params: UsePostEditorTemplateFormParams) {
  const [templateFormData, setTemplateFormData] = useState<ContentGroupTemplateFormState>(() =>
    createEmptyTemplateFormState()
  );
  const [templateHasChanges, setTemplateHasChanges] = useState(false);
  const templateInitializedRef = useRef(false);
  const [templateFirstCommentOpen, setTemplateFirstCommentOpen] = useState(false);
  const [isTemplateTab, setIsTemplateTab] = useState(false);

  useTemplateInitialization({
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupTemplate: params.contentGroupTemplate,
    templateAssetIds: params.templateAssetIds,
    templateAssetsById: params.templateAssetsById,
    templateCarouselAssets: params.templateCarouselAssets,
    setTemplateFormData,
    setTemplateFirstCommentOpen,
    setTemplateHasChanges,
    templateInitializedRef,
  });

  useEffect(() => {
    setIsTemplateTab(false);
  }, [params.contentGroupId, params.id]);

  const templateMediaType = useMemo<InstagramMediaType>(
    () => deriveMediaTypeFromAssets(templateFormData.carouselAssets, templateFormData.contentType),
    [templateFormData.carouselAssets, templateFormData.contentType]
  );

  const templateValidation = useMemo(
    () =>
      buildTemplateValidation({
        isMultiDestinationGroup: params.isMultiDestinationGroup,
        templateFormData,
        templateMediaType,
        groupPlatforms: params.groupPlatforms,
      }),
    [params.groupPlatforms, params.isMultiDestinationGroup, templateFormData, templateMediaType]
  );

  useTemplateDirtyTracking({
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    contentGroupTemplate: params.contentGroupTemplate,
    templateInitializedRef,
    templateFormData,
    templateAssetIds: params.templateAssetIds,
    templateFirstCommentOpen,
    setTemplateHasChanges,
  });

  const allowMixedTemplateMedia = useAllowMixedTemplateMedia(
    params.groupPlatforms,
    templateFormData.contentType
  );
  const templateQueueSupported = useTemplateQueueSupported({
    isMultiDestinationGroup: params.isMultiDestinationGroup,
    groupPlatforms: params.groupPlatforms,
  });

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
    templateValidationError: templateValidation.ok ? null : templateValidation.errors[0]?.message,
    allowMixedTemplateMedia,
    templateQueueSupported,
  };
}
