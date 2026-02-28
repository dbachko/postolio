import type { FastifyInstance } from 'fastify';
import { PlatformAdapterFactory } from './factory.js';
import type { PlatformContent, PlatformCredentials, PublishResult, RateLimits } from './types.js';

export class PlatformService {
  constructor(private _fastify: FastifyInstance) {}

  async publishToMultiplePlatforms(
    content: PlatformContent,
    platforms: Array<{ platform: string; credentials: PlatformCredentials }>
  ): Promise<Map<string, PublishResult | Error>> {
    const results = new Map<string, PublishResult | Error>();

    const validations = PlatformAdapterFactory.validateAllPlatforms(
      content,
      platforms.map((platform) => platform.platform)
    );

    for (const [platform, validation] of validations.entries()) {
      if (!validation.valid) {
        results.set(platform, new Error(validation.errors?.join(', ')));
      }
    }

    const publishPromises = platforms
      .filter((platform) => validations.get(platform.platform)?.valid)
      .map(async ({ platform, credentials }) => {
        try {
          const adapter = PlatformAdapterFactory.getAdapter(platform);
          const formattedContent = adapter.formatContent(content);
          const result = await adapter.publish(formattedContent, credentials);
          results.set(platform, result);
        } catch (error) {
          results.set(platform, error as Error);
        }
      });

    await Promise.allSettled(publishPromises);

    return results;
  }

  getRateLimitStatus(): Map<string, RateLimits> {
    const status = new Map<string, RateLimits>();

    for (const platform of PlatformAdapterFactory.getSupportedPlatforms()) {
      const adapter = PlatformAdapterFactory.getAdapter(platform);
      status.set(platform, adapter.getRateLimits());
    }

    return status;
  }
}
