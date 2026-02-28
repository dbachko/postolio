import {
  type PlatformAdapter,
  type PlatformContent,
  type PlatformCredentials,
  type PublishResult,
  type RateLimits,
  type ValidationResult,
  fbGraph,
} from './types.js';

interface FacebookPostPayload {
  message: string;
  access_token: string;
  url?: string;
}

export class FacebookAdapter implements PlatformAdapter {
  platform = 'facebook';

  validateContent(content: PlatformContent): ValidationResult {
    const errors: string[] = [];

    if (content.caption.length > 63206) {
      errors.push('Caption exceeds Facebook limit of 63,206 characters');
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
    };
  }

  async publish(
    content: PlatformContent,
    credentials: PlatformCredentials
  ): Promise<PublishResult> {
    try {
      const pageId = this.getPageId(credentials);
      const postData = this.buildPostPayload(content, credentials.accessToken);

      if (content.imageUrl || content.mediaUrl) {
        return this.publishPhotoPost(pageId, postData, credentials.accessToken);
      }
      return this.publishTextPost(pageId, postData, credentials.accessToken);
    } catch (error) {
      console.error('Facebook publish error:', error);
      throw error;
    }
  }

  private getPageId(credentials: PlatformCredentials): string {
    const pageId = credentials.metadata?.pageId;
    if (!pageId) {
      throw new Error('Facebook Page ID not found in credentials');
    }
    return String(pageId);
  }

  private buildPostPayload(content: PlatformContent, accessToken: string): FacebookPostPayload {
    const payload: FacebookPostPayload = {
      message: content.caption,
      access_token: accessToken,
    };

    if (content.imageUrl || content.mediaUrl) {
      payload.url = content.imageUrl || content.mediaUrl;
    }

    return payload;
  }

  private async publishPhotoPost(
    pageId: string,
    postData: FacebookPostPayload,
    accessToken: string
  ): Promise<PublishResult> {
    const response = await fetch(fbGraph(`${pageId}/photos`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      throw await this.buildFacebookError(response, 'Facebook photo upload failed');
    }

    const responseData = (await response.json()) as { post_id?: string; id: string };
    const postId = responseData.post_id || responseData.id;
    const permalink = await this.resolvePermalink(postId, accessToken);

    return {
      platform: 'facebook',
      postId,
      permalink,
      publishedAt: new Date().toISOString(),
      metadata: { pageId, postType: 'photo' },
    };
  }

  private async publishTextPost(
    pageId: string,
    postData: FacebookPostPayload,
    accessToken: string
  ): Promise<PublishResult> {
    const response = await fetch(fbGraph(`${pageId}/feed`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      throw await this.buildFacebookError(response, 'Facebook post failed');
    }

    const responseData = (await response.json()) as { id: string };
    const postId = responseData.id;
    const permalink = await this.resolvePermalink(postId, accessToken);

    return {
      platform: 'facebook',
      postId,
      permalink,
      publishedAt: new Date().toISOString(),
      metadata: { pageId, postType: 'text' },
    };
  }

  private async resolvePermalink(postId: string, accessToken: string): Promise<string> {
    const permalinkResponse = await fetch(
      fbGraph(`${postId}?fields=permalink_url&access_token=${accessToken}`)
    );
    const permalinkData = (await permalinkResponse.json()) as { permalink_url?: string };
    return permalinkData.permalink_url || `https://facebook.com/${postId}`;
  }

  private async buildFacebookError(response: Response, prefix: string): Promise<Error> {
    const errorJson: unknown = await response.json();
    const fbErr =
      errorJson && typeof errorJson === 'object' && 'error' in errorJson
        ? (errorJson as { error?: { message?: string } })
        : undefined;

    return new Error(`${prefix}: ${fbErr?.error?.message || 'Unknown error'}`);
  }

  getRateLimits(): RateLimits {
    return {
      postsPerHour: 50,
      postsPerDay: 200,
      apiCallsPerHour: 200,
    };
  }
}
