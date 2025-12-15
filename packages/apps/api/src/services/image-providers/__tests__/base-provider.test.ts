import { describe, it, expect } from 'vitest';
import { BaseImageProvider } from '../base-provider.js';
import type {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ProviderPricing,
  ImageFeature,
} from '../types.js';

// Mock concrete provider for testing base class
class MockProvider extends BaseImageProvider {
  readonly name: ImageProvider = 'dalle-3';
  readonly displayName = 'Mock Provider';
  readonly pricing: ProviderPricing = {
    standard: 0.04,
    speedEstimate: '10-15s',
    features: ['Test feature 1', 'Test feature 2'],
  };

  protected checkConfiguration(): boolean {
    return true;
  }

  async generateImage(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return {
      imageBuffer: Buffer.from('mock-image'),
      provider: this.name,
      cost: 0.04,
      metadata: {
        model: 'mock-model',
        size: '1024x1024',
        generationTime: 1,
      },
    };
  }

  supports(_feature: ImageFeature): boolean {
    return true;
  }
}

describe('BaseImageProvider', () => {
  const provider = new MockProvider();

  describe('buildPrompt', () => {
    it('returns original prompt when no brand context', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful sunset',
        brandContext: null,
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toBe('A beautiful sunset');
    });

    it('enhances prompt with brand tones', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful sunset',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: ['Professional', 'Elegant', 'Modern'],
          palette: [],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('A beautiful sunset');
      expect(result).toContain('Professional and Elegant style');
    });

    it('enhances prompt with brand color palette', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful sunset',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: [],
          palette: ['Blue', 'Gold', 'White'],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('A beautiful sunset');
      expect(result).toContain('featuring Blue and Gold color palette');
    });

    it('enhances prompt with both tones and palette', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A beautiful sunset',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: ['Luxury', 'Sophisticated'],
          palette: ['Navy', 'Rose Gold'],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('Luxury and Sophisticated style');
      expect(result).toContain('featuring Navy and Rose Gold color palette');
    });

    it('limits tones to first 2', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A product photo',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: ['Modern', 'Clean', 'Bold', 'Dynamic', 'Energetic'],
          palette: [],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('Modern and Clean style');
      expect(result).not.toContain('Bold');
    });

    it('limits palette to first 2 colors', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A product photo',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: [],
          palette: ['Red', 'Blue', 'Green', 'Yellow', 'Purple'],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('featuring Red and Blue color palette');
      expect(result).not.toContain('Green');
    });

    it('handles empty tones array', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A product photo',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: [],
          palette: ['Blue'],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).not.toContain('style');
      expect(result).toContain('palette');
    });

    it('handles empty palette array', () => {
      const request: ImageGenerationRequest = {
        prompt: 'A product photo',
        brandContext: {
          brandId: 'brand-1',
          profileVersion: 1,
          tones: ['Modern'],
          palette: [],
          topicsTop: null,
          createdAt: new Date().toISOString(),
        },
        brandName: 'Test Brand',
      };

      const result = (provider as any).buildPrompt(request);
      expect(result).toContain('style');
      expect(result).not.toContain('palette');
    });
  });

  describe('generateImage', () => {
    it('returns valid result structure', async () => {
      const request: ImageGenerationRequest = {
        prompt: 'Test prompt',
        brandContext: null,
        brandName: 'Test Brand',
      };

      const result = await provider.generateImage(request);

      expect(result).toHaveProperty('imageBuffer');
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('cost');
      expect(result.provider).toBe('dalle-3');
      expect(typeof result.cost).toBe('number');
    });
  });

  describe('provider properties', () => {
    it('has required name property', () => {
      expect(provider.name).toBeDefined();
      expect(typeof provider.name).toBe('string');
    });

    it('has required displayName property', () => {
      expect(provider.displayName).toBeDefined();
      expect(typeof provider.displayName).toBe('string');
    });

    it('has required isConfigured property', () => {
      expect(typeof provider.isConfigured).toBe('boolean');
    });

    it('has valid pricing structure', () => {
      expect(provider.pricing).toBeDefined();
      expect(provider.pricing.standard).toBeTypeOf('number');
      expect(provider.pricing.standard).toBeGreaterThan(0);
      expect(provider.pricing.speedEstimate).toBeTypeOf('string');
      expect(Array.isArray(provider.pricing.features)).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('returns boolean', async () => {
      const result = await provider.healthCheck();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('supports', () => {
    it('returns boolean', () => {
      const result = provider.supports('text-rendering');
      expect(typeof result).toBe('boolean');
    });
  });
});
