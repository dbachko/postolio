import {
  type PlatformAdapter,
  type PlatformContent,
  type PlatformCredentials,
  type PublishResult,
  type RateLimits,
  type ValidationResult,
  fbGraph,
} from './types.js';

export class InstagramAdapter implements PlatformAdapter {
  platform = 'instagram';

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];

    if (!content.mediaUrl && !content.imageUrl) {
      errors.push('Instagram requires at least one image or video');
    }
    if (content.caption.length > 2200) {
      errors.push('Caption exceeds Instagram limit of 2,200 characters');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    const finalCaption =
      content.caption.length > 2200 ? `${content.caption.substring(0, 2197)}...` : content.caption;

    return {
      ...content,
      caption: finalCaption,
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    try {
      const instagramBusinessAccountId = credentials.metadata?.instagramBusinessAccountId;
      if (!instagramBusinessAccountId) {
        throw new Error('Instagram account ID not found in credentials');
      }

      const mediaUploadResponse = await fetch(fbGraph(`${instagramBusinessAccountId}/media`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: content.imageUrl || content.mediaUrl,
          caption: content.caption,
          access_token: credentials.accessToken,
        }),
      });
      if (!mediaUploadResponse.ok) {
        const errorJson: unknown = await mediaUploadResponse.json();
        const errMsg =
          errorJson && typeof errorJson === 'object' && 'error' in errorJson
            ? (errorJson as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(`Instagram media upload failed: ${errMsg || 'Unknown error'}`);
      }

      const mediaData = (await mediaUploadResponse.json()) as { id: string };
      const publishResponse = await fetch(fbGraph(`${instagramBusinessAccountId}/media_publish`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: mediaData.id,
          access_token: credentials.accessToken,
        }),
      });
      if (!publishResponse.ok) {
        const errorJson: unknown = await publishResponse.json();
        const errMsg =
          errorJson && typeof errorJson === 'object' && 'error' in errorJson
            ? (errorJson as { error?: { message?: string } }).error?.message
            : undefined;
        throw new Error(`Instagram publish failed: ${errMsg || 'Unknown error'}`);
      }

      const publishData = (await publishResponse.json()) as { id: string };
      const permalinkResponse = await fetch(
        fbGraph(`${publishData.id}?fields=permalink&access_token=${credentials.accessToken}`)
      );
      const permalinkData = (await permalinkResponse.json()) as { permalink: string };

      return {
        platform: 'instagram',
        postId: publishData.id,
        permalink: permalinkData.permalink,
        publishedAt: new Date().toISOString(),
        metadata: {
          mediaType: 'IMAGE',
          businessAccountId: instagramBusinessAccountId,
        },
      };
    } catch (error) {
      console.error('Instagram publish error:', error);
      throw error;
    }
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 25,
      postsPerDay: 100,
      apiCallsPerHour: 200,
    };
  }
}
