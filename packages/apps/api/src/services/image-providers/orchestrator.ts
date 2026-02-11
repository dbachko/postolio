import { imageProviderRegistry } from './registry.js';
import type { ImageProvider, ImageGenerationRequest, ImageGenerationResult } from './types.js';
import { contentLogger } from '../content-generators/logger.js';
import { prisma } from '../../config/database.js';
import { importImageBuffer } from '../assets-media.js';
import type { BrandProfileContext } from '../brand-profile.js';
import { randomUUID } from 'node:crypto';

export interface GenerationOptions {
  preferredProvider?: ImageProvider;
  enableFallback?: boolean;
  brandId: string;
  contentId?: string;
}

export class ImageGenerationOrchestrator {
  private async resolvePreferredProvider(options: GenerationOptions): Promise<ImageProvider> {
    if (
      options.preferredProvider &&
      imageProviderRegistry.isProviderConfigured(options.preferredProvider)
    ) {
      return options.preferredProvider;
    }

    if (options.brandId) {
      try {
        const brand = await prisma.brand.findUnique({
          where: { id: options.brandId },
          select: { preferences: true },
        });

        const preferences = brand?.preferences as { imageProvider?: unknown } | null;
        const preferred = preferences?.imageProvider;
        if (typeof preferred === 'string') {
          const provider = preferred as ImageProvider;
          if (imageProviderRegistry.isProviderConfigured(provider)) {
            return provider;
          }
        }
      } catch (error) {
        contentLogger.warn('[Orchestrator] Failed to resolve brand image provider preference', {
          brandId: options.brandId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const defaultProvider = imageProviderRegistry.getDefaultProvider();
    if (defaultProvider) {
      return defaultProvider;
    }

    throw new Error(
      'No image providers configured. Set at least one provider API key (e.g., OPENAI_API_KEY) or enable placeholders with SKIP_IMAGE_GENERATION=true.'
    );
  }

  /**
   * Generate an image with automatic fallback support
   */
  async generateImage(
    prompt: string,
    brandContext: BrandProfileContext | null,
    brandName: string,
    options: GenerationOptions
  ): Promise<ImageGenerationResult> {
    const request: ImageGenerationRequest = {
      prompt,
      brandContext,
      brandName,
    };

    const preferredProvider = await this.resolvePreferredProvider(options);

    contentLogger.info('[Orchestrator] Starting image generation', {
      brand: brandName,
      provider: preferredProvider,
    });

    try {
      // Try preferred provider
      const provider = imageProviderRegistry.getProviderWithFallback(preferredProvider);
      const result = await this.attemptGeneration(provider.name, request);

      // Upload if buffer returned
      if (result.imageBuffer && !result.imageUrl) {
        const asset = await this.uploadImage(result.imageBuffer, options, prompt, result.provider);
        result.imageUrl = asset.url;
        result.metadata.assetId = asset.id;
      }

      // Log success
      await this.logGeneration(result, 'success', options, undefined, prompt);

      contentLogger.info('[Orchestrator] Generation successful', {
        provider: result.provider,
        cost: result.cost,
        time: result.metadata.generationTime,
      });

      return result;
    } catch (error) {
      contentLogger.error('[Orchestrator] Primary provider failed', {
        provider: preferredProvider,
        error: error instanceof Error ? error.message : String(error),
      });

      // Try fallback if enabled
      if (options.enableFallback) {
        return await this.generateWithFallback(request, preferredProvider, options, prompt);
      }

      throw error;
    }
  }

  /**
   * Attempt generation with fallback providers
   */
  private async generateWithFallback(
    request: ImageGenerationRequest,
    failedProvider: ImageProvider,
    options: GenerationOptions,
    prompt: string
  ): Promise<ImageGenerationResult> {
    const fallbackOrder = imageProviderRegistry.getFallbackOrder();

    for (const providerName of fallbackOrder) {
      if (providerName === failedProvider) continue;

      try {
        contentLogger.info('[Orchestrator] Trying fallback provider', {
          provider: providerName,
        });

        const result = await this.attemptGeneration(providerName, request);

        // Upload if buffer returned
        if (result.imageBuffer && !result.imageUrl) {
          const asset = await this.uploadImage(
            result.imageBuffer,
            options,
            prompt,
            result.provider
          );
          result.imageUrl = asset.url;
          result.metadata.assetId = asset.id;
        }

        // Log fallback success
        await this.logGeneration(result, 'fallback', options, failedProvider, prompt);

        contentLogger.info('[Orchestrator] Fallback successful', {
          provider: providerName,
          failedProvider,
        });

        return result;
      } catch (error) {
        contentLogger.warn('[Orchestrator] Fallback provider failed', {
          provider: providerName,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    throw new Error('All image generation providers failed');
  }

  /**
   * Attempt generation with a specific provider
   */
  private async attemptGeneration(
    providerName: ImageProvider,
    request: ImageGenerationRequest
  ): Promise<ImageGenerationResult> {
    const provider = imageProviderRegistry.getProvider(providerName);

    if (!provider) {
      throw new Error(`Provider ${providerName} not configured`);
    }

    if (!provider.isConfigured) {
      throw new Error(`Provider ${providerName} is not configured`);
    }

    return await provider.generateImage(request);
  }

  /**
   * Upload image buffer to the assets service
   */
  private async uploadImage(
    buffer: Buffer,
    options: GenerationOptions,
    originalPrompt: string,
    provider: ImageProvider
  ): Promise<{ id: string; url: string }> {
    const contentId = options.contentId || randomUUID();
    const asset = await importImageBuffer(buffer, {
      contentId,
      brandId: options.brandId,
      source: provider,
      originalPrompt,
      generatedAt: new Date(),
    });

    return { id: asset.id, url: asset.url };
  }

  /**
   * Log generation metrics to database
   */
  private async logGeneration(
    result: ImageGenerationResult,
    status: 'success' | 'fallback',
    options: GenerationOptions,
    failedProvider: ImageProvider | undefined,
    prompt: string
  ): Promise<void> {
    try {
      await prisma.imageGenerationLog.create({
        data: {
          brandId: options.brandId,
          contentId: options.contentId,
          provider: result.provider,
          prompt: prompt.substring(0, 1000), // Truncate to reasonable length
          imageUrl: result.imageUrl || '',
          cost: result.cost,
          generationTime: result.metadata.generationTime,
          size: result.metadata.size,
          quality: result.metadata.quality,
          status,
          failedProvider,
          metadata: result.metadata,
        },
      });

      contentLogger.info('[Orchestrator] Generation logged to database', {
        provider: result.provider,
        cost: result.cost,
        status,
        brandId: options.brandId,
      });
    } catch (error) {
      contentLogger.error('[Orchestrator] Failed to log generation to database', {
        error: error instanceof Error ? error.message : String(error),
        provider: result.provider,
      });
      // Don't throw - logging failure shouldn't break image generation
    }
  }
}

// Singleton instance
export const imageOrchestrator = new ImageGenerationOrchestrator();
