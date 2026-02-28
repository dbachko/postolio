import type {
  PlatformAdapter,
  PlatformContent,
  PlatformCredentials,
  PublishResult,
  RateLimits,
  ValidationResult,
} from './types.js';

export class TikTokAdapter implements PlatformAdapter {
  platform = 'tiktok';

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];

    if (content.mediaType !== 'video') {
      errors.push('TikTok requires video content');
    }
    if (content.caption.length > 2200) {
      errors.push('Caption exceeds TikTok limit of 2,200 characters');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    return {
      ...content,
      caption: content.caption.substring(0, 2200),
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    void content;
    void credentials;
    throw new Error(
      'TikTok publishing is not yet supported. ' +
        'TikTok requires video content and OAuth 2.0 integration which is currently under development.'
    );
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 5,
      postsPerDay: 10,
      apiCallsPerHour: 50,
    };
  }
}
