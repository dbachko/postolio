import { GoogleGenerativeAI } from '@google/generative-ai';
import { BaseImageProvider } from './base-provider.js';
import { extractInlineImageBuffer } from './gemini-utils.js';
import type {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderPricing,
  ImageFeature,
} from './types.js';

export class GeminiProProvider extends BaseImageProvider {
  readonly name: ImageProvider = 'gemini-3-pro';
  readonly displayName = 'Gemini 3 Pro';

  readonly pricing: ProviderPricing = {
    standard: 0.134, // 1K/2K
    hd: 0.24, // 4K
    features: [
      'Studio quality',
      '4K resolution support',
      'All Gemini Flash features',
      'Best text rendering',
      'Premium results',
    ],
    speedEstimate: '15-30s',
  };

  private genAI: GoogleGenerativeAI | null = null;
  private lastApiKey: string | null = null;

  protected checkConfiguration(): boolean {
    return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }

  private getClient(): GoogleGenerativeAI {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not configured');
    }

    if (!this.genAI || this.lastApiKey !== apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.lastApiKey = apiKey;
    }

    return this.genAI;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const genAI = this.getClient();

    const startTime = Date.now();

    // Note: Model name may need adjustment based on Google's API
    const model = genAI.getGenerativeModel({ model: 'gemini-3.0-pro-vision' });

    const enhancedPrompt = this.buildPrompt(request);

    try {
      const result = await model.generateContent([{ text: enhancedPrompt }]);
      const response = result.response;

      const imageBuffer = extractInlineImageBuffer(response);
      if (!imageBuffer) {
        throw new Error('No image data received from Gemini Pro');
      }

      const generationTime = Date.now() - startTime;
      const cost = this.calculateCost(request);

      return {
        imageBuffer,
        provider: this.name,
        cost,
        metadata: {
          model: 'gemini-3.0-pro-vision',
          size: request.size || '1024x1024',
          quality: request.quality,
          generationTime,
        },
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Gemini Pro generation failed: ${err.message}`);
    }
  }

  supports(feature: ImageFeature): boolean {
    const supportedFeatures: ImageFeature[] = [
      'text-rendering',
      'multi-turn',
      'character-consistency',
      'multimodal-input',
      '4k-resolution',
    ];
    return supportedFeatures.includes(feature);
  }

  protected calculateCost(request: ImageGenerationRequest): number {
    // 4K resolution costs more
    if (request.size === '4096x4096') {
      return 0.24;
    }
    return 0.134; // 1K or 2K
  }
}
