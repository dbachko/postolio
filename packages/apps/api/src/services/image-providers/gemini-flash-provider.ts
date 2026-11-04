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

export class GeminiFlashProvider extends BaseImageProvider {
  readonly name: ImageProvider = 'gemini-2.5-flash';
  readonly displayName = 'Gemini 2.5 Flash';

  readonly pricing: ProviderPricing = {
    standard: 0.039,
    features: [
      'Superior text rendering',
      'Multi-turn refinement',
      'Character consistency',
      'Fast generation (5-10s)',
      'Generous free tier',
    ],
    speedEstimate: '5-10s',
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

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const enhancedPrompt = this.buildPrompt(request);

    try {
      const result = await model.generateContent([{ text: enhancedPrompt }]);
      const response = result.response;

      const imageBuffer = extractInlineImageBuffer(response);
      if (!imageBuffer) {
        throw new Error('No image data received from Gemini');
      }

      const generationTime = Date.now() - startTime;

      return {
        imageBuffer,
        provider: this.name,
        cost: this.pricing.standard,
        metadata: {
          model: 'gemini-2.5-flash',
          size: request.size || '1024x1024',
          generationTime,
        },
      };
    } catch (error) {
      // Re-throw with more context
      const err = error instanceof Error ? error : new Error(String(error));
      throw new Error(`Gemini Flash generation failed: ${err.message}`);
    }
  }

  supports(feature: ImageFeature): boolean {
    const supportedFeatures: ImageFeature[] = [
      'text-rendering',
      'multi-turn',
      'character-consistency',
      'multimodal-input',
    ];
    return supportedFeatures.includes(feature);
  }
}
