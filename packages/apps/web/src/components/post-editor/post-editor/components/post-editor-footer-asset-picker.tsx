import AssetPicker from '@/features/assets/components/AssetPicker';
import type { AssetReference } from '@/components/multi-image-uploader/types';
import type { InstagramContentType } from '@postolio/content-validation';

import type { PostEditorState } from '../hooks/use-post-editor';
import { mergeUniqueAssets } from '../utils';

function normalizePickedAssets(
  assets: Array<{ id: string; url: string; fileType: string }>
): AssetReference[] {
  return assets.map((asset) => ({
    id: asset.id,
    url: asset.url,
    type: asset.fileType === 'video' ? ('video' as const) : ('image' as const),
  }));
}

function pickAssetType(state: PostEditorState): 'video' | undefined {
  const contentType =
    state.ui.assetPickerTarget === 'template'
      ? state.template.templateFormData.contentType
      : state.form.formData.contentType;
  return contentType === 'reel' ? 'video' : undefined;
}

function applyAssetSelection(
  current: { contentType: InstagramContentType; carouselAssets: AssetReference[] },
  normalized: AssetReference[],
  disallowMixed: boolean
): AssetReference[] {
  const allowMixing = current.contentType === 'post' && !disallowMixed;
  if (!allowMixing) {
    const firstVideo = normalized.find((asset) => asset.type === 'video') || null;
    const imageAssets = normalized.filter((asset) => asset.type !== 'video');
    return firstVideo ? [firstVideo] : imageAssets.slice(0, 10);
  }
  return mergeUniqueAssets([...current.carouselAssets, ...normalized], 10);
}

function handleAssetPickerSelect(
  state: PostEditorState,
  assets: Array<{ id: string; url: string; fileType: string }>
) {
  const normalized = normalizePickedAssets(assets);
  if (state.ui.assetPickerTarget === 'template') {
    state.template.setTemplateFormData((current) => ({
      ...current,
      carouselAssets: applyAssetSelection(
        current,
        normalized,
        state.data.groupPlatforms.includes('facebook')
      ),
    }));
  } else {
    state.form.setFormData((current) => ({
      ...current,
      carouselAssets: applyAssetSelection(
        current,
        normalized,
        state.destinations.selectedPlatforms.includes('facebook')
      ),
    }));
  }
  state.ui.setShowAssetPicker(false);
}

export function FooterAssetPicker({ state }: { state: PostEditorState }) {
  if (!state.ui.showAssetPicker || !state.data.brandIdForAssets) {
    return null;
  }
  return (
    <AssetPicker
      brandId={state.data.brandIdForAssets}
      type={pickAssetType(state)}
      onSelectMany={(assets) => handleAssetPickerSelect(state, assets)}
      onClose={() => state.ui.setShowAssetPicker(false)}
    />
  );
}
