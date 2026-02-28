import { useMemo } from 'react';
import { validateContentPayload, type InstagramMediaType } from '@postolio/content-validation';

import type { PostEditorFormState } from '@/components/post-editor/post-editor-main-body/types';
import type { Platform } from '@/lib/platform-config';

import { deriveMediaTypeFromAssets, toValidationPlatform } from '../utils';

function buildValidation(formData: PostEditorFormState, selectedPlatforms: Platform[]) {
  const isStory = formData.contentType === 'story';
  const mediaType = deriveMediaTypeFromAssets(formData.carouselAssets, formData.contentType);
  const mediaAssets: Array<{ key: string; type: InstagramMediaType }> = (
    formData.carouselAssets || []
  )
    .filter((asset) => typeof asset.id === 'string' && asset.id.trim().length > 0)
    .map((asset) => ({ key: asset.id, type: asset.type === 'video' ? 'video' : 'image' }));
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
        mediaType: mediaAssets.length > 0 ? mediaType : undefined,
        caption: isStory ? '' : formData.caption,
        mediaAssets,
      }),
    };
  });

  const firstFail = validations.find((entry) => !entry.result.ok);
  if (!firstFail) {
    return { validation: { ok: true, errors: [] }, validationError: null };
  }

  const errors = firstFail.result.errors.map((error) => ({
    ...error,
    message: `${firstFail.platform}: ${error.message}`,
  }));

  return { validation: { ok: false, errors }, validationError: errors[0]?.message ?? null };
}

export function usePostEditorValidationState(params: {
  formData: PostEditorFormState;
  selectedPlatforms: Platform[];
}) {
  return useMemo(
    () => buildValidation(params.formData, params.selectedPlatforms),
    [params.formData, params.selectedPlatforms]
  );
}
