import { describe, it, expect, beforeEach } from 'vitest';
import { ImageProviderRegistry } from '../registry.js';
import type { ImageProvider } from '../types.js';

describe('ImageProviderRegistry', () => {
  let registry: ImageProviderRegistry;

  beforeEach(() => {
    // Keep env deterministic for these tests.
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.DEFAULT_IMAGE_PROVIDER;
    delete process.env.IMAGE_FALLBACK_ORDER;

    registry = new ImageProviderRegistry();
  });

  it('exposes configured providers', () => {
    const providers = registry.getConfiguredProviders();
    expect(Array.isArray(providers)).toBe(true);
    expect(providers.length).toBeGreaterThanOrEqual(1);
    providers.forEach((provider) => {
      expect(provider.isConfigured).toBe(true);
      expect(provider.name).toBeDefined();
      expect(provider.displayName).toBeDefined();
      expect(provider.pricing.standard).toBeTypeOf('number');
    });
  });

  it('returns provider by name when it exists', () => {
    const provider = registry.getProvider('dalle-3');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('dalle-3');
  });

  it('returns undefined for unknown provider', () => {
    const provider = registry.getProvider('non-existent' as ImageProvider);
    expect(provider).toBeUndefined();
  });

  it('returns DALL-E as default when only OpenAI is configured', () => {
    expect(registry.getDefaultProvider()).toBe('dalle-3');
  });

  it('returns a configured provider via getProviderWithFallback', () => {
    const provider = registry.getProviderWithFallback('non-existent' as ImageProvider);
    expect(provider.isConfigured).toBe(true);
    expect(provider.name).toBe('dalle-3');
  });

  it('reports configuration state per provider', () => {
    expect(registry.isProviderConfigured('dalle-3')).toBe(true);
    expect(registry.isProviderConfigured('gemini-2.5-flash')).toBe(false);
  });
});
