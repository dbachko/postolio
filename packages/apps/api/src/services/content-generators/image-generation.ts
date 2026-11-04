import { shouldUsePlaceholderImages, generatePlaceholderImageUrl } from '../image-placeholders.js';
import { imageOrchestrator } from '../image-providers/orchestrator.js';
import type { ImageProvider, ImageGenerationResult } from '../image-providers/types.js';
import type { BrandProfileContext } from '../brand-profile.js';
import { contentLogger } from './logger.js';

/**
 * Generate brand content image with multi-provider support
 */
export async function generateBrandContentImage(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string,
  options?: {
    preferredProvider?: ImageProvider;
    brandId?: string;
    contentId?: string;
  }
): Promise<ImageGenerationResult> {
  // Check if placeholders should be used
  const usePlaceholders = shouldUsePlaceholderImages();
  if (usePlaceholders) {
    contentLogger.info('[ImageGen] Using placeholder (SKIP_IMAGE_GENERATION=true)', {
      brand: brandName,
    });
    const imageUrl = generatePlaceholderImageUrl('1024x1024', `${brandName}-${Date.now()}`);
    return {
      imageUrl,
      provider: options?.preferredProvider || 'dalle-3',
      cost: 0,
      metadata: {
        model: 'placeholder',
        size: '1024x1024',
        generationTime: 0,
      },
    };
  }

  // Use orchestrator for multi-provider generation
  const result = await imageOrchestrator.generateImage(prompt, brandContext, brandName, {
    preferredProvider: options?.preferredProvider,
    enableFallback: true, // Always enable fallback
    brandId: options?.brandId || 'unknown',
    contentId: options?.contentId,
  });

  if (!result.imageUrl) {
    throw new Error('No image URL returned from generation');
  }

  return result;
}
