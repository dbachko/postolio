import { useEffect, useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AppEmptyState } from '@/components/app-empty-state';
import type { InstagramContentType } from '@postolio/content-validation';
import type { PostEditorMainBodyProps } from './types';
import {
  findFirstEnabledContentType,
  getAllowedContentTypes,
  getContentTypeDisabledReasons,
  getMediaSummary,
  getSelectedPlatforms,
} from './utils';
import { ContentTypeSelector } from './components/content-type-selector';
import { DestinationsPicker } from './components/destinations-picker';
import { MediaSection } from './components/media-section';
import { CaptionAndFirstComment } from './components/caption-and-first-comment';

export function PostEditorMainBody({
  mode,
  allowMixedMedia,
  disabled,
  isLoading,
  post,
  selectedBrand,
  formData,
  setFormData,
  firstCommentOpen,
  setFirstCommentOpen,
  onOpenAssetPicker,
  platformOptions,
  selectedPlatformAccountIds,
  onSelectedPlatformAccountIdsChange,
  showDestinationsPicker,
}: PostEditorMainBodyProps) {
  const resolvedShowDestinationsPicker = showDestinationsPicker ?? mode === 'create';
  const destinationCount = selectedPlatformAccountIds?.length ?? 0;
  const isMultiDestinationSelection = destinationCount > 1;

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
    const currentDisabledReason = contentTypeDisabledReasons[current];
    if (!currentDisabledReason) {
      return;
    }

    const firstEnabled = findFirstEnabledContentType(contentTypeDisabledReasons);
    if (!firstEnabled) {
      return;
    }
    if (firstEnabled === current) {
      return;
    }
    setFormData((s) => ({ ...s, contentType: firstEnabled }));
  }, [contentTypeDisabledReasons, formData.contentType, selectedPlatforms.length, setFormData]);

  const handleContentTypeChange = (nextType: InstagramContentType) => {
    setFormData((s) => {
      if (nextType !== 'reel') {
        return { ...s, contentType: nextType };
      }

      const firstVideo = s.carouselAssets.find((asset) => asset.type === 'video');
      return {
        ...s,
        contentType: nextType,
        carouselAssets: firstVideo ? [firstVideo] : [],
      };
    });
  };

  const renderComposerBody = (opts: { brandId: string }) => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <ContentTypeSelector
          mode={mode}
          disabled={disabled}
          selectedPlatformsLength={selectedPlatforms.length}
          value={formData.contentType}
          onValueChange={handleContentTypeChange}
          disabledReasons={contentTypeDisabledReasons}
        />

        <DestinationsPicker
          show={resolvedShowDestinationsPicker}
          disabled={disabled}
          destinationCount={destinationCount}
          isMultiDestinationSelection={isMultiDestinationSelection}
          platformOptions={platformOptions}
          selectedPlatformAccountIds={selectedPlatformAccountIds}
          onSelectedPlatformAccountIdsChange={onSelectedPlatformAccountIdsChange}
        />
      </div>

      <MediaSection
        mode={mode}
        contentType={formData.contentType}
        disabled={disabled}
        allowMixedMedia={allowMixedMedia}
        brandId={opts.brandId}
        carouselAssets={formData.carouselAssets}
        shareToFeed={formData.shareToFeed}
        onCarouselAssetsChange={(assets) => setFormData((s) => ({ ...s, carouselAssets: assets }))}
        onShareToFeedChange={(checked) => setFormData((s) => ({ ...s, shareToFeed: checked }))}
        onOpenAssetPicker={onOpenAssetPicker}
      />

      <CaptionAndFirstComment
        mode={mode}
        contentType={formData.contentType}
        caption={formData.caption}
        firstComment={formData.firstComment}
        firstCommentOpen={firstCommentOpen}
        onFirstCommentOpenChange={setFirstCommentOpen}
        onCaptionChange={(value) => setFormData((s) => ({ ...s, caption: value }))}
        onFirstCommentChange={(value) => setFormData((s) => ({ ...s, firstComment: value }))}
        brandId={mode === 'create' ? selectedBrand?.id : post?.brand?.id}
        disabled={disabled}
      />
    </div>
  );

  if (mode === 'create') {
    if (!selectedBrand) {
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
    return renderComposerBody({ brandId: selectedBrand.id });
  }

  if (isLoading || !post) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading...
      </div>
    );
  }

  const brandId = post.brand?.id || selectedBrand?.id || null;
  if (!brandId) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Missing brand
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {post.status === 'failed' && post.schedulingError ? (
        <Alert variant="destructive">
          <AlertDescription>{post.schedulingError}</AlertDescription>
        </Alert>
      ) : null}
      {renderComposerBody({ brandId })}
    </div>
  );
}
