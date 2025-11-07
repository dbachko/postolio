import { Midjourney } from 'midjourney';
import { logger as baseLogger } from '@postolio/logger';
import { getOpenAIClient } from './openai-client.js';
import { shouldUsePlaceholderImages, generatePlaceholderImageUrl } from './image-placeholders.js';
import type { BrandProfileContext } from './brand-profile.js';

// Midjourney client configuration
interface MidjourneyConfig {
  salaiToken: string;
  serverId: string;
  channelId: string;
  debug?: boolean;
  ws?: boolean;
}

interface MidjourneyImageResult {
  imageUrl: string;
  id: string;
  progress?: string;
  error?: string;
}

const midjourneyLogger = baseLogger.child({ module: 'midjourney-service' });

export class MidjourneyService {
  private client: Midjourney | null = null;
  private initialized = false;
  private config: MidjourneyConfig;
  private fallbackToDallE = true;

  constructor() {
    // Load configuration from environment variables
    this.config = {
      salaiToken: process.env.MIDJOURNEY_SALAI_TOKEN || '',
      serverId: process.env.MIDJOURNEY_SERVER_ID || '',
      channelId: process.env.MIDJOURNEY_CHANNEL_ID || '',
      debug: process.env.NODE_ENV === 'dev',
      ws: true,
    };

    // Validate configuration
    if (!this.config.salaiToken || !this.config.serverId || !this.config.channelId) {
      midjourneyLogger.warn('Midjourney API credentials not configured. Falling back to DALL-E.');
      this.fallbackToDallE = true;
    } else {
      midjourneyLogger.info('Midjourney API credentials found, initializing client');
    }
  }

  /**
   * Initialize the Midjourney client
   */
  async init(): Promise<boolean> {
    if (this.initialized || !this.isConfigured()) {
      return this.initialized;
    }

    try {
      this.client = new Midjourney({
        SalaiToken: this.config.salaiToken,
        ServerId: this.config.serverId,
        ChannelId: this.config.channelId,
        Debug: this.config.debug || false,
        Ws: this.config.ws || true,
      });

      await this.client.init();
      this.initialized = true;
      midjourneyLogger.info('Midjourney client initialized successfully');
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      midjourneyLogger.error('Failed to initialize Midjourney client', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      this.fallbackToDallE = true;
      return false;
    }
  }

  /**
   * Check if Midjourney is properly configured
   */
  private isConfigured(): boolean {
    return !!(this.config.salaiToken && this.config.serverId && this.config.channelId);
  }

  /**
   * Generate image using DALL-E with brand characteristics
   */
  private async generateDalleImage(
    prompt: string,
    brandContext: BrandProfileContext | null,
    _brandName: string
  ): Promise<string> {
    if (shouldUsePlaceholderImages()) {
      return generatePlaceholderImageUrl('1024x1024', `${_brandName || 'brand'}-${Date.now()}`);
    }

    void _brandName;
    try {
      const openai = getOpenAIClient();

      if (!openai) {
        midjourneyLogger.warn('OpenAI client is not configured. Cannot generate DALL-E image.');
        throw new Error('OpenAI API key configuration error');
      }

      let enhancedPrompt = `Create a high-quality Instagram-worthy image: ${prompt}`;
      // Add brand characteristics to DALL-E prompt from projection
      const tones = brandContext?.tones?.slice(0, 2) || [];
      const palette = brandContext?.palette?.slice(0, 2) || [];
      const motifs = brandContext?.motifs?.slice(0, 1) || [];
      const composition = brandContext?.composition?.slice(0, 1) || [];

      if (tones.length > 0) {
        enhancedPrompt += `, ${tones.join(' and ')} style`;
      }
      if (palette.length > 0) {
        const colors = palette.join(' and ');
        enhancedPrompt += `, featuring ${colors} colors`;
      }
      if (motifs.length > 0) {
        enhancedPrompt += `, motif: ${motifs[0]}`;
      }
      if (composition.length > 0) {
        enhancedPrompt += `, composition: ${composition[0]}`;
      }

      enhancedPrompt +=
        '. Professional photography style, visually appealing, social media optimized.';

      midjourneyLogger.info('Enhanced DALL-E prompt prepared', {
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
        throw new Error('No image URL received from DALL-E');
      }

      midjourneyLogger.info('DALL-E image generation successful');
      return imageUrl;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      midjourneyLogger.error('DALL-E image generation failed', {
        error: { name: err.name, message: err.message, stack: err.stack },
      });
      throw new Error('DALL-E image generation failed');
    }
  }

  /**
   * Generate brand-consistent image prompt based on style profile
   */
  private generateBrandPrompt(
    basePrompt: string,
    brandContext: BrandProfileContext | null,
    brandName: string
  ): string {
    const tones = brandContext?.tones?.slice(0, 2) || [];
    const palette = brandContext?.palette?.slice(0, 3) || [];
    const motifs = brandContext?.motifs?.slice(0, 1) || [];
    const composition = brandContext?.composition?.slice(0, 1) || [];
    const topics = Array.isArray(brandContext?.topicsTop)
      ? brandContext!.topicsTop!.slice(0, 1).map((t) => t.value)
      : [];

    let enhancedPrompt = basePrompt;
    if (tones.length > 0) enhancedPrompt += `, ${tones.join(' and ')} style`;
    if (palette.length > 0) enhancedPrompt += `, featuring ${palette.join(' and ')} color scheme`;
    if (motifs.length > 0) enhancedPrompt += `, motif: ${motifs[0]}`;
    if (composition.length > 0) enhancedPrompt += `, composition: ${composition[0]}`;
    if (topics.length > 0) enhancedPrompt += `, ${topics[0]} context`;

    enhancedPrompt += ' --ar 1:1 --style raw --quality 2';

    midjourneyLogger.info('Generated Midjourney prompt', {
      brand: brandName,
      promptPreview: enhancedPrompt.substring(0, 120),
    });
    return enhancedPrompt;
  }

  /**
   * Generate image using Midjourney with brand-aware prompts
   */
  async generateBrandImage(
    prompt: string,
    brandContext: BrandProfileContext | null,
    brandName: string
  ): Promise<MidjourneyImageResult> {
    if (shouldUsePlaceholderImages()) {
      return {
        imageUrl: generatePlaceholderImageUrl('1024x1024', `${brandName}-${Date.now()}`),
        id: `placeholder_${Date.now()}`,
        progress: 'completed',
      };
    }

    // Always try to initialize if not already done
    if (!this.initialized) {
      await this.init();
    }

    // If Midjourney is not available, fallback to DALL-E
    if (!this.initialized || !this.client || this.fallbackToDallE) {
      midjourneyLogger.info('Falling back to DALL-E for image generation');
      try {
        const dalleUrl = await this.generateDalleImage(prompt, brandContext, brandName);
        return {
          imageUrl: dalleUrl,
          id: `dalle_${Date.now()}`,
          progress: 'completed',
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        midjourneyLogger.error('DALL-E fallback failed', {
          brand: brandName,
          error: { name: err.name, message: err.message, stack: err.stack },
        });
        throw new Error('Both Midjourney and DALL-E image generation failed');
      }
    }

    try {
      // Generate brand-consistent prompt
      const brandPrompt = this.generateBrandPrompt(prompt, brandContext, brandName);

      midjourneyLogger.info('Generating image with Midjourney', { brand: brandName });

      // Create timeout for Midjourney generation (5 minutes)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Midjourney generation timeout')), 300000);
      });

      // Generate image with progress tracking
      const imaginePromise = this.client.Imagine(brandPrompt, (uri, progress) => {
        midjourneyLogger.debug('Midjourney progress update', {
          brand: brandName,
          progress,
          uri,
        });
      });

      const result = await Promise.race([imaginePromise, timeoutPromise]);

      if (!result || !result.uri) {
        throw new Error('Midjourney returned invalid result');
      }

      midjourneyLogger.info('Midjourney image generated successfully', {
        brand: brandName,
        imageUrl: result.uri,
      });

      return {
        imageUrl: result.uri,
        id: result.id || `midjourney_${Date.now()}`,
        progress: 'completed',
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      midjourneyLogger.error('Midjourney generation failed', {
        brand: brandName,
        error: { name: err.name, message: err.message, stack: err.stack },
      });

      // Fallback to DALL-E on any error
      midjourneyLogger.info('Falling back to DALL-E due to Midjourney error');
      try {
        const dalleUrl = await this.generateDalleImage(prompt, brandContext, brandName);
        return {
          imageUrl: dalleUrl,
          id: `dalle_fallback_${Date.now()}`,
          progress: 'completed',
          error: `Midjourney failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      } catch (dalleError) {
        const errFallback =
          dalleError instanceof Error ? dalleError : new Error(String(dalleError));
        midjourneyLogger.error('DALL-E fallback also failed', {
          brand: brandName,
          error: { name: errFallback.name, message: errFallback.message, stack: errFallback.stack },
        });
        throw new Error('Both Midjourney and DALL-E image generation failed');
      }
    }
  }

  /**
   * Generate multiple images with different variations
   */
  async generateImageVariations(
    prompt: string,
    brandContext: BrandProfileContext | null,
    brandName: string,
    count: number = 1
  ): Promise<MidjourneyImageResult[]> {
    const results: MidjourneyImageResult[] = [];

    for (let i = 0; i < count; i++) {
      try {
        // Add variation keywords to make each image unique
        const variationPrompt =
          i === 0 ? prompt : `${prompt}, variation ${i + 1}, different perspective`;

        const result = await this.generateBrandImage(variationPrompt, brandContext, brandName);
        results.push(result);

        // Add delay between generations to avoid rate limits
        if (i < count - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        midjourneyLogger.error('Failed to generate image variation', {
          brand: brandName,
          variation: i + 1,
          error: { name: err.name, message: err.message, stack: err.stack },
        });
        // Continue with other variations even if one fails
      }
    }

    if (results.length === 0) {
      throw new Error('All image generation attempts failed');
    }

    return results;
  }

  /**
   * Get the status of the Midjourney service
   */
  getStatus(): {
    configured: boolean;
    initialized: boolean;
    fallbackMode: boolean;
  } {
    return {
      configured: this.isConfigured(),
      initialized: this.initialized,
      fallbackMode: this.fallbackToDallE,
    };
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.client) {
      try {
        // The Midjourney client doesn't have an explicit cleanup method
        // but we can reset our state
        this.client = null;
        this.initialized = false;
        midjourneyLogger.info('Midjourney client destroyed');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        midjourneyLogger.error('Error destroying Midjourney client', {
          error: { name: err.name, message: err.message, stack: err.stack },
        });
      }
    }
  }
}

// Create singleton instance
export const midjourneyService = new MidjourneyService();

// Auto-initialize if configured
if (process.env.MIDJOURNEY_SALAI_TOKEN) {
  midjourneyService.init().catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    midjourneyLogger.error('Failed to auto-initialize Midjourney service', {
      error: { name: err.name, message: err.message, stack: err.stack },
    });
  });
}

/**
 * Convenience function for generating brand-aware images
 */
export async function generateMidjourneyImage(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string
): Promise<string> {
  const result = await midjourneyService.generateBrandImage(prompt, brandContext, brandName);
  return result.imageUrl;
}

/**
 * Convenience function for generating multiple image variations
 */
export async function generateImageVariations(
  prompt: string,
  brandContext: BrandProfileContext | null,
  brandName: string,
  count: number = 1
): Promise<string[]> {
  const results = await midjourneyService.generateImageVariations(
    prompt,
    brandContext,
    brandName,
    count
  );
  return results.map((result) => result.imageUrl);
}
