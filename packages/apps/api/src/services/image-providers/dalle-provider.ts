import { BaseImageProvider } from './base-provider.js';
import { getOpenAIClient } from '../openai-client.js';
import type {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderPricing,
  ImageFeature,
} from './types.js';

export class DalleProvider extends BaseImageProvider {
  readonly name: ImageProvider = 'dalle-3';
  readonly displayName = 'DALL-E 3';

  readonly pricing: ProviderPricing = {
    standard: 0.04,
    hd: 0.08,
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

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: enhancedPrompt,
      size: (request.size || '1024x1024') as '1024x1024' | '1792x1024' | '1024x1792',
      quality: request.quality || 'standard',
      n: 1,
    });

    const first = response.data?.[0];
    const imageUrl = first?.url;
    if (!imageUrl) {
      throw new Error('No image URL received from DALL-E');
    }

    const cost = this.calculateCost(request);
    const generationTime = Date.now() - startTime;

    return {
      imageUrl,
      provider: this.name,
      cost,
      metadata: {
        model: 'dall-e-3',
        size: request.size || '1024x1024',
        quality: request.quality || 'standard',
        generationTime,
        revisedPrompt: first?.revised_prompt,
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
