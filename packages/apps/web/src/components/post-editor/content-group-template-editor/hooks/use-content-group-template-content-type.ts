import { useEffect, useMemo } from 'react';
import type { InstagramContentType } from '@postolio/content-validation';

import { getPlatformConfig, type Platform } from '@/lib/platform-config';

import type { ContentGroupTemplateFormState } from '../types';

interface UseContentTypeStateArgs {
  platforms: Platform[];
  value: ContentGroupTemplateFormState;
  onChange: (
    updater: (prev: ContentGroupTemplateFormState) => ContentGroupTemplateFormState
  ) => void;
}

export function useContentGroupTemplateContentType(args: UseContentTypeStateArgs) {
  const { platforms, value, onChange } = args;
  const selectedPlatforms = useMemo(() => Array.from(new Set(platforms)), [platforms]);

  const allowedContentTypes = useMemo(() => {
    if (selectedPlatforms.length === 0) {
      return { post: true, reel: true, story: true };
    }

    return {
      post: selectedPlatforms.every((platform) => getPlatformConfig(platform).features.publishing),
      reel: selectedPlatforms.every((platform) => getPlatformConfig(platform).features.reels),
      story: selectedPlatforms.every((platform) => getPlatformConfig(platform).features.stories),
    };
  }, [selectedPlatforms]);

  useEffect(() => {
    if (selectedPlatforms.length === 0) {
      return;
    }

    const current = value.contentType;
    let isAllowed = allowedContentTypes.story;
    if (current === 'post') {
      isAllowed = allowedContentTypes.post;
    } else if (current === 'reel') {
      isAllowed = allowedContentTypes.reel;
    }

    if (isAllowed || !allowedContentTypes.post) {
      return;
    }

    onChange((state) => ({ ...state, contentType: 'post' }));
  }, [allowedContentTypes, onChange, selectedPlatforms.length, value.contentType]);

  const allowMixedMedia = useMemo(() => {
    if (value.contentType !== 'post') {
      return false;
    }

    return selectedPlatforms.every((platform) => platform !== 'facebook');
  }, [selectedPlatforms, value.contentType]);

  const handleContentTypeChange = (next: string) => {
    onChange((state) => {
      const nextType = next as InstagramContentType;
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

  return {
    selectedPlatformsLength: selectedPlatforms.length,
    allowedContentTypes,
    allowMixedMedia,
    handleContentTypeChange,
  };
}
