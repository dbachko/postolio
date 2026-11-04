import type {
  IImageProvider,
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderPricing,
  ImageFeature,
} from './types.js';
import { logger as baseLogger } from '@postolio/logger';

const imageProvidersLogger = baseLogger.child({ module: 'image-providers' });

export abstract class BaseImageProvider implements IImageProvider {
  abstract readonly name: ImageProvider;
  abstract readonly displayName: string;

  get isConfigured(): boolean {
    return this.checkConfiguration();
  }

  abstract readonly pricing: ProviderPricing;

  /**
   * Generate an image using this provider
   */
  abstract generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;

  /**
   * Check if this provider supports a specific feature
   */
  abstract supports(feature: ImageFeature): boolean;

  /**
   * Check if provider is properly configured with API keys
   */
  protected abstract checkConfiguration(): boolean;

  /**
   * Health check to verify provider is responsive
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test generation
      await this.generateImage({
        prompt: 'test image',
        brandContext: null,
        brandName: 'health-check',
        size: '1024x1024',
      });
      return true;
    } catch (error) {
      imageProvidersLogger.warn('Provider health check failed', {
        provider: this.name,
        err: error,
      });
      return false;
    }
  }

  /**
   * Add brand context to the prompt.
   */
  protected buildPrompt(request: ImageGenerationRequest): string {
    let prompt = request.prompt;

    // Add brand tones
    if (request.brandContext?.tones?.length) {
      const tones = request.brandContext.tones.slice(0, 2).join(' and ');
      prompt += `, ${tones} style`;
    }

    // Add brand colors
    if (request.brandContext?.palette?.length) {
      const colors = request.brandContext.palette.slice(0, 2).join(' and ');
      prompt += `, featuring ${colors} color palette`;
    }

    // Add brand motifs
    if (request.brandContext?.motifs?.length) {
      prompt += `, motif: ${request.brandContext.motifs[0]}`;
    }

    return prompt;
  }

  /**
   * Calculate generation cost based on request
   */
  protected calculateCost(request: ImageGenerationRequest): number {
    if (request.quality === 'hd' && this.pricing.hd) {
      return this.pricing.hd;
    }
    return this.pricing.standard;
  }
}
