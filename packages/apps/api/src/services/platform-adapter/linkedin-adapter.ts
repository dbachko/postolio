import type {
  PlatformAdapter,
  PlatformContent,
  PlatformCredentials,
  PublishResult,
  RateLimits,
  ValidationResult,
} from './types.js';

export class LinkedInAdapter implements PlatformAdapter {
  platform = 'linkedin';

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (content.caption.length > 3000) {
      errors.push('Caption exceeds LinkedIn limit of 3,000 characters');
    }
    if (content.mediaType === 'carousel') {
      warnings.push('LinkedIn does not support carousel posts, will post as single image');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  formatContent(content: PlatformContent): PlatformContent {
    return {
      ...content,
      caption: content.caption.substring(0, 3000),
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    try {
      const personUrn = credentials.metadata?.personUrn || credentials.metadata?.userId;
      if (!personUrn) {
        throw new Error('LinkedIn person URN not found in credentials');
      }

      const postData = {
        author: `urn:li:person:${personUrn}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content.caption,
            },
            shareMediaCategory: content.imageUrl || content.mediaUrl ? 'IMAGE' : 'NONE',
            ...((content.imageUrl || content.mediaUrl) && {
              media: [
                {
                  status: 'READY',
                  description: { text: content.caption.substring(0, 200) },
                  media: content.imageUrl || content.mediaUrl,
                  title: { text: 'Shared via Postolio' },
                },
              ],
            }),
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(postData),
      });
      if (!response.ok) {
        const errorJson: unknown = await response.json();
        const errMsg =
          errorJson && typeof errorJson === 'object' && 'message' in errorJson
            ? (errorJson as { message?: string }).message
            : undefined;
        throw new Error(`LinkedIn publish failed: ${errMsg || 'Unknown error'}`);
      }

      const responseData = (await response.json()) as { id: string };
      const postId = responseData.id;

      return {
        platform: 'linkedin',
        postId,
        permalink: `https://www.linkedin.com/feed/update/${postId}/`,
        publishedAt: new Date().toISOString(),
        metadata: {
          authorUrn: `urn:li:person:${personUrn}`,
          shareType: content.imageUrl ? 'IMAGE' : 'TEXT',
        },
      };
    } catch (error) {
      console.error('LinkedIn publish error:', error);
      throw error;
    }
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 10,
      postsPerDay: 50,
      apiCallsPerHour: 100,
    };
  }
}
