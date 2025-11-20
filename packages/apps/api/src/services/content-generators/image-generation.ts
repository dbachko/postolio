import { shouldUsePlaceholderImages, generatePlaceholderImageUrl } from '../image-placeholders.js';
import { generateMidjourneyImage } from '../midjourney.js';
import { getOpenAIClient } from '../openai-client.js';
import type { BrandProfileContext } from '../brand-profile.js';
import { contentLogger } from './logger.js';

export async function generateContentImage(prompt: string): Promise<string> {
  if (shouldUsePlaceholderImages()) {
    return generatePlaceholderImageUrl('1024x1024', `content-${Date.now()}`);
  }

  const openai = getOpenAIClient();

  if (!openai) {
    contentLogger.warn('OpenAI client is not configured. Cannot generate content image.', {
      promptPreview: prompt.substring(0, 50),
    });
    throw new Error('OpenAI API key configuration error');
  }

  try {
    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `Create a high-quality Instagram-worthy image: ${prompt}. Professional photography style, visually appealing, social media optimized.`,
      size: '1024x1024',
      quality: 'hd',
      n: 1,
    });

    const imageUrl = response.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error('No image URL received from DALL-E');
    }

    return imageUrl;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Image generation error', {
      promptPreview: prompt.substring(0, 50),
      error: { name: err.name, message: err.message, stack: err.stack },
    });
    throw new Error('Image generation failed');
  }
}

export async function generateBrandContentImage(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string
): Promise<string> {
  const usePlaceholders = shouldUsePlaceholderImages();
  if (usePlaceholders) {
    contentLogger.info('Skipping AI image generation; using placeholder', {
      brand: brandName,
      reason: 'shouldUsePlaceholderImages() returned true',
    });
    return generatePlaceholderImageUrl('1024x1024', `${brandName}-${Date.now()}`);
  }

  try {
    contentLogger.info('Attempting Midjourney generation for brand content', {
      brand: brandName,
    });
    const imageUrl = await generateMidjourneyImage(prompt, brandContext, brandName);
    contentLogger.info('Midjourney generation successful', {
      brand: brandName,
      hasImage: Boolean(imageUrl),
    });
    return imageUrl;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    contentLogger.error('Midjourney generation failed, falling back to DALL-E', {
      brand: brandName,
      error: { name: err.name, message: err.message, stack: err.stack },
    });

    try {
      const openai = getOpenAIClient();

      if (!openai) {
        contentLogger.warn(
          'OpenAI client is not configured. Cannot generate DALL-E fallback image.',
          {
            brand: brandName,
          }
        );
        throw new Error('OpenAI API key configuration error');
      }

      const tones = brandContext?.tones?.slice(0, 2) || [];
      const palette = brandContext?.palette?.slice(0, 2) || [];

      let enhancedPrompt = `Create a high-quality Instagram-worthy image: ${prompt}`;

      if (tones.length > 0) {
        enhancedPrompt += `, ${tones.join(' and ')} style`;
      }

      if (palette.length > 0) {
        const colors = palette.join(' and ');
        enhancedPrompt += `, featuring ${colors} colors`;
      }

      enhancedPrompt +=
        '. Professional photography style, visually appealing, social media optimized.';

      contentLogger.info('Enhanced DALL-E prompt prepared', {
        brand: brandName,
        promptPreview: enhancedPrompt.substring(0, 80),
      });

      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        size: '1024x1024',
        quality: 'hd',
        n: 1,
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL received from DALL-E fallback');
      }

      contentLogger.info('DALL-E fallback generation successful', {
        brand: brandName,
        hasImage: Boolean(imageUrl),
      });
      return imageUrl;
    } catch (dalleError) {
      const errFallback = dalleError instanceof Error ? dalleError : new Error(String(dalleError));
      contentLogger.error('Both Midjourney and DALL-E failed', {
        brand: brandName,
        error: {
          name: errFallback.name,
          message: errFallback.message,
          stack: errFallback.stack,
        },
      });
      throw new Error('Image generation failed for both Midjourney and DALL-E');
    }
  }
}
