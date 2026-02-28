import { FacebookAdapter } from './facebook-adapter.js';
import { InstagramAdapter } from './instagram-adapter.js';
import { LinkedInAdapter } from './linkedin-adapter.js';
import { TikTokAdapter } from './tiktok-adapter.js';
import type { PlatformAdapter, PlatformContent, ValidationResult } from './types.js';

export class PlatformAdapterFactory {
  private static adapters = new Map<string, PlatformAdapter>();

  static {
    this.registerAdapter(new InstagramAdapter());
    this.registerAdapter(new LinkedInAdapter());
    this.registerAdapter(new FacebookAdapter());
    this.registerAdapter(new TikTokAdapter());
  }

  static registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  static getAdapter(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform.toLowerCase());
    if (!adapter) {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    return adapter;
  }

  static getSupportedPlatforms(): string[] {
    return Array.from(this.adapters.keys());
  }

  static validateAllPlatforms(
    content: PlatformContent,
    platforms: string[]
  ): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>();

    for (const platform of platforms) {
      try {
        const adapter = this.getAdapter(platform);
        results.set(platform, adapter.validateContent(content));
      } catch {
        results.set(platform, {
          valid: false,
          errors: [`Platform ${platform} is not supported`],
        });
      }
    }

    return results;
  }
}
