import { useEffect, useMemo, type ReactNode } from 'react';
import type { InstagramContentType } from '@postolio/content-validation';

import { AppEmptyState } from '@/components/app-empty-state';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { CaptionAndFirstComment } from './components/caption-and-first-comment';
import { ContentTypeSelector } from './components/content-type-selector';
import { DestinationsPicker } from './components/destinations-picker';
import { MediaSection } from './components/media-section';
import type { PostEditorMainBodyProps } from './types';
import {
  findFirstEnabledContentType,
  getAllowedContentTypes,
  getContentTypeDisabledReasons,
  getMediaSummary,
  getSelectedPlatforms,
} from './utils';

type ComposerBodyProps = {
  mode: PostEditorMainBodyProps['mode'];
  allowMixedMedia: boolean;
  disabled: boolean;
  brandId: string;
  formData: PostEditorMainBodyProps['formData'];
  setFormData: PostEditorMainBodyProps['setFormData'];
  firstCommentOpen: boolean;
  setFirstCommentOpen: PostEditorMainBodyProps['setFirstCommentOpen'];
  onOpenAssetPicker: PostEditorMainBodyProps['onOpenAssetPicker'];
  resolvedShowDestinationsPicker: boolean;
  destinationCount: number;
  isMultiDestinationSelection: boolean;
  selectedPlatformsLength: number;
  contentTypeDisabledReasons: Record<InstagramContentType, string | null>;
  selectedBrandId?: string;
  postBrandId?: string;
  platformOptions: PostEditorMainBodyProps['platformOptions'];
  selectedPlatformAccountIds: PostEditorMainBodyProps['selectedPlatformAccountIds'];
  onSelectedPlatformAccountIdsChange: PostEditorMainBodyProps['onSelectedPlatformAccountIdsChange'];
  onContentTypeChange: (type: InstagramContentType) => void;
};

function ComposerBody(props: ComposerBodyProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <ContentTypeSelector
          mode={props.mode}
          disabled={props.disabled}
          selectedPlatformsLength={props.selectedPlatformsLength}
          value={props.formData.contentType}
          onValueChange={props.onContentTypeChange}
          disabledReasons={props.contentTypeDisabledReasons}
        />

        <DestinationsPicker
          show={props.resolvedShowDestinationsPicker}
          disabled={props.disabled}
          destinationCount={props.destinationCount}
          isMultiDestinationSelection={props.isMultiDestinationSelection}
          platformOptions={props.platformOptions}
          selectedPlatformAccountIds={props.selectedPlatformAccountIds}
          onSelectedPlatformAccountIdsChange={props.onSelectedPlatformAccountIdsChange}
        />
      </div>

      <MediaSection
        mode={props.mode}
        contentType={props.formData.contentType}
        disabled={props.disabled}
        allowMixedMedia={props.allowMixedMedia}
        brandId={props.brandId}
        carouselAssets={props.formData.carouselAssets}
        shareToFeed={props.formData.shareToFeed}
        onCarouselAssetsChange={(assets) =>
          props.setFormData((state) => ({ ...state, carouselAssets: assets }))
        }
        onShareToFeedChange={(checked) =>
          props.setFormData((state) => ({ ...state, shareToFeed: checked }))
        }
        onOpenAssetPicker={props.onOpenAssetPicker}
      />

      <CaptionAndFirstComment
        mode={props.mode}
        contentType={props.formData.contentType}
        caption={props.formData.caption}
        firstComment={props.formData.firstComment}
        firstCommentOpen={props.firstCommentOpen}
        onFirstCommentOpenChange={props.setFirstCommentOpen}
        onCaptionChange={(value) => props.setFormData((state) => ({ ...state, caption: value }))}
        onFirstCommentChange={(value) =>
          props.setFormData((state) => ({ ...state, firstComment: value }))
        }
        brandId={props.mode === 'create' ? props.selectedBrandId : props.postBrandId}
        disabled={props.disabled}
      />
    </div>
  );
}

function usePostEditorMainBodyContentType(params: {
  formData: PostEditorMainBodyProps['formData'];
  setFormData: PostEditorMainBodyProps['setFormData'];
  platformOptions: PostEditorMainBodyProps['platformOptions'];
  selectedPlatformAccountIds: PostEditorMainBodyProps['selectedPlatformAccountIds'];
}) {
  const { formData, setFormData, platformOptions, selectedPlatformAccountIds } = params;

  const mediaSummary = useMemo(
    () => getMediaSummary(formData.carouselAssets || []),
    [formData.carouselAssets]
  );

  const selectedPlatforms = useMemo(
    () =>
      getSelectedPlatforms({
        platformOptions,
        selectedPlatformAccountIds,
      }),
    [platformOptions, selectedPlatformAccountIds]
  );

  const allowedContentTypes = useMemo(
    () => getAllowedContentTypes(selectedPlatforms),
    [selectedPlatforms]
  );

  const contentTypeDisabledReasons = useMemo(
    () =>
      getContentTypeDisabledReasons({
        allowedContentTypes,
        mediaSummary,
      }),
    [allowedContentTypes, mediaSummary]
  );

  useEffect(() => {
    if (selectedPlatforms.length === 0) {
      return;
    }

    const current = formData.contentType;
    if (!contentTypeDisabledReasons[current]) {
      return;
    }

    const firstEnabled = findFirstEnabledContentType(contentTypeDisabledReasons);
    if (!firstEnabled || firstEnabled === current) {
      return;
    }

    setFormData((state) => ({ ...state, contentType: firstEnabled }));
  }, [contentTypeDisabledReasons, formData.contentType, selectedPlatforms.length, setFormData]);

  const handleContentTypeChange = (nextType: InstagramContentType) => {
    setFormData((state) => {
      if (nextType !== 'reel') {
        return { ...state, contentType: nextType };
      }

      const firstVideo = state.carouselAssets.find((asset) => asset.type === 'video');
      return {
        ...state,
        contentType: nextType,
        carouselAssets: firstVideo ? [firstVideo] : [],
      };
    });
  };

  return { selectedPlatforms, contentTypeDisabledReasons, handleContentTypeChange };
}

function EditingFallback(props: { isLoading: boolean; missingBrand: boolean }) {
  if (props.isLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading...
      </div>
    );
  }

  if (props.missingBrand) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Missing brand
      </div>
    );
  }

  return null;
}

function renderPostEditorMainBodyGuard(props: PostEditorMainBodyProps): ReactNode | null {
  if (props.mode === 'create' && !props.selectedBrand) {
    return (
      <AppEmptyState
        variant="minimal"
        title="Select a brand to create this post"
        description="Post drafts, scheduling rules, and insights are tied to the brand you choose."
        actions={[{ label: 'Choose Brand', to: '/brands' }]}
        className="min-h-[280px]"
      />
    );
  }

  if (props.mode !== 'edit') {
    return null;
  }
  const missingPost = !props.post;
  const missingBrand = !props.post?.brand?.id && !props.selectedBrand?.id;
  return EditingFallback({ isLoading: props.isLoading || missingPost, missingBrand });
}

function resolvePostEditorMainBodyBrandId(props: PostEditorMainBodyProps): string {
  if (props.mode === 'create') {
    return props.selectedBrand!.id;
  }
  return props.post!.brand?.id || props.selectedBrand?.id || '';
}

export function PostEditorMainBody(props: PostEditorMainBodyProps) {
  const resolvedShowDestinationsPicker = props.showDestinationsPicker ?? props.mode === 'create';
  const destinationCount = props.selectedPlatformAccountIds?.length ?? 0;
  const isMultiDestinationSelection = destinationCount > 1;

  const contentTypeState = usePostEditorMainBodyContentType({
    formData: props.formData,
    setFormData: props.setFormData,
    platformOptions: props.platformOptions,
    selectedPlatformAccountIds: props.selectedPlatformAccountIds,
  });
  const guard = renderPostEditorMainBodyGuard(props);
  if (guard) {
    return guard;
  }
  const brandId = resolvePostEditorMainBodyBrandId(props);

  return (
    <div className="space-y-4">
      {props.mode === 'edit' && props.post?.status === 'failed' && props.post.schedulingError ? (
        <Alert variant="destructive">
          <AlertDescription>{props.post.schedulingError}</AlertDescription>
        </Alert>
      ) : null}

      <ComposerBody
        mode={props.mode}
        allowMixedMedia={props.allowMixedMedia}
        disabled={props.disabled}
        brandId={brandId}
        formData={props.formData}
        setFormData={props.setFormData}
        firstCommentOpen={props.firstCommentOpen}
        setFirstCommentOpen={props.setFirstCommentOpen}
        onOpenAssetPicker={props.onOpenAssetPicker}
        resolvedShowDestinationsPicker={resolvedShowDestinationsPicker}
        destinationCount={destinationCount}
        isMultiDestinationSelection={isMultiDestinationSelection}
        selectedPlatformsLength={contentTypeState.selectedPlatforms.length}
        contentTypeDisabledReasons={contentTypeState.contentTypeDisabledReasons}
        selectedBrandId={props.selectedBrand?.id}
        postBrandId={props.post?.brand?.id}
        platformOptions={props.platformOptions}
        selectedPlatformAccountIds={props.selectedPlatformAccountIds}
        onSelectedPlatformAccountIdsChange={props.onSelectedPlatformAccountIdsChange}
        onContentTypeChange={contentTypeState.handleContentTypeChange}
      />
    </div>
  );
}
