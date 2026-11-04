import { BaseImageProvider } from './base-provider.js';
import { getOpenAIClient } from '../openai-client.js';
import { generateOpenAIImage, OPENAI_IMAGE_MODEL } from './openai-image.js';
import type {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderPricing,
  ImageFeature,
} from './types.js';

/**
 * OpenAI image provider. OpenAI shut DALL-E 3 down on 2026-05-12; the `dalle-3` id stays
 * because brand settings and generation logs persist it.
 */
export class DalleProvider extends BaseImageProvider {
  readonly name: ImageProvider = 'dalle-3';
  readonly displayName = 'OpenAI GPT Image';

  readonly pricing: ProviderPricing = {
    // Estimates shown before generation; actual cost comes from the response's token usage.
    standard: 0.053,
    hd: 0.211,
    features: ['Photorealistic quality', 'Rich detail', 'Artistic styles', 'Mature API'],
    speedEstimate: '10-20s',
  };

  protected checkConfiguration(): boolean {
    return !!process.env.OPENAI_API_KEY;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startTime = Date.now();
    const openai = getOpenAIClient();

    if (!openai) {
      throw new Error('OpenAI client not configured');
    }

    const enhancedPrompt = this.buildDallePrompt(request);

    const { imageBuffer, size, quality, cost } = await generateOpenAIImage(openai, {
      prompt: enhancedPrompt,
      size: request.size || '1024x1024',
      quality: request.quality || 'standard',
    });

    return {
      imageBuffer,
      provider: this.name,
      cost: cost ?? this.calculateCost(request),
      metadata: {
        model: OPENAI_IMAGE_MODEL,
        size,
        quality,
        generationTime: Date.now() - startTime,
      },
    };
  }

  supports(feature: ImageFeature): boolean {
    return ['text-rendering'].includes(feature);
  }

  /**
   * Build DALL-E specific prompt with social media optimization
   */
  private buildDallePrompt(request: ImageGenerationRequest): string {
    let prompt = `Create a high-quality Instagram-worthy image: ${request.prompt}`;

    if (request.brandContext?.tones?.length) {
      const tones = request.brandContext.tones.slice(0, 2).join(' and ');
      prompt += `, ${tones} style`;
    }

    if (request.brandContext?.palette?.length) {
      const colors = request.brandContext.palette.slice(0, 2).join(' and ');
      prompt += `, featuring ${colors} colors`;
    }

    prompt += '. Professional photography style, visually appealing, social media optimized.';

    return prompt;
  }
}
