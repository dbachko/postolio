import type { IImageProvider, ImageProvider } from './types.js';
import { DalleProvider } from './dalle-provider.js';
import { GeminiFlashProvider } from './gemini-flash-provider.js';
import { GeminiProProvider } from './gemini-pro-provider.js';

export class ImageProviderRegistry {
  private providers = new Map<ImageProvider, IImageProvider>();

  constructor() {
    this.registerProviders();
  }

  private registerProviders(): void {
    const allProviders: IImageProvider[] = [
      new GeminiFlashProvider(),
      new DalleProvider(),
      new GeminiProProvider(),
    ];

    for (const provider of allProviders) {
      this.providers.set(provider.name, provider);
    }
  }

  getProvider(name: ImageProvider): IImageProvider | undefined {
    return this.providers.get(name);
  }

  getAllProviders(): IImageProvider[] {
    return Array.from(this.providers.values());
  }

  getConfiguredProviders(): IImageProvider[] {
    return this.getAllProviders().filter((provider) => provider.isConfigured);
  }

  isProviderConfigured(name: ImageProvider): boolean {
    return this.getProvider(name)?.isConfigured ?? false;
  }

  /**
   * Returns the default provider name, or null if none are configured.
   */
  getDefaultProvider(): ImageProvider | null {
    const configuredNames = new Set(this.getConfiguredProviders().map((p) => p.name));

    const envDefault = process.env.DEFAULT_IMAGE_PROVIDER as ImageProvider | undefined;
    if (envDefault && configuredNames.has(envDefault)) {
      return envDefault;
    }

    const priorities: ImageProvider[] = ['gemini-2.5-flash', 'dalle-3', 'gemini-3-pro'];

    for (const provider of priorities) {
      if (configuredNames.has(provider)) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Returns fallback provider names (configured only).
   */
  getFallbackOrder(): ImageProvider[] {
    const configuredNames = new Set(this.getConfiguredProviders().map((p) => p.name));

    const envFallback = process.env.IMAGE_FALLBACK_ORDER;
    if (envFallback) {
      const ordered = envFallback
        .split(',')
        .map((p) => p.trim() as ImageProvider)
        .filter((p) => configuredNames.has(p));

      if (ordered.length > 0) return ordered;
    }

    return Array.from(configuredNames.values());
  }

  /**
   * Returns a configured provider, falling back to the default provider.
   * Throws if no providers are configured.
   */
  getProviderWithFallback(preferred?: ImageProvider | null): IImageProvider {
    if (preferred) {
      const provider = this.getProvider(preferred);
      if (provider?.isConfigured) return provider;
    }

    const defaultProvider = this.getDefaultProvider();
    if (defaultProvider) {
      const provider = this.getProvider(defaultProvider);
      if (provider?.isConfigured) return provider;
    }

    throw new Error(
      'No image providers configured. Set at least one provider API key (e.g., OPENAI_API_KEY) or enable placeholders with SKIP_IMAGE_GENERATION=true.'
    );
  }
}

export const imageProviderRegistry = new ImageProviderRegistry();
