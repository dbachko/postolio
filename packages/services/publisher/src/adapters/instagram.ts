import { Logger } from '@aws-lambda-powertools/logger';
import { API_VERSIONS, API_BASE_URLS } from '@postolio/aws';
import type {
  PlatformAdapter,
  Schedule,
  Credentials,
  PublishResult,
  PublishedMedia,
  ResolvedMedia,
} from '../types';
import { PLATFORM_LIMITS } from '../constants';
import { sanitizeUrlForLog, getSignedVideoUrl, getSignedImageUrlFromKey } from '../utils/media';
import { createAndPublishSingleMedia } from './instagram/publish-single';
import { createCarouselAndPublish } from './instagram/publish-carousel';

const logger = new Logger({ serviceName: 'publisher' });

interface PublishFlags {
  isReel: boolean;
  isStory: boolean;
}

export class InstagramAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    try {
      const formattedCaption = this.formatCaption(schedule.caption, schedule.hashtags);
      const flags = this.getPublishFlags(schedule);
      const resolvedMedia = await this.resolveMedia(schedule);

      if (!resolvedMedia.length) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      if (flags.isStory) {
        return this.publishStory(schedule, credentials, formattedCaption, resolvedMedia, flags);
      }

      if (this.shouldUseCarousel(flags, resolvedMedia)) {
        const published = await createCarouselAndPublish({
          credentials,
          formattedCaption,
          media: resolvedMedia.slice(0, 10),
          hasVideoMedia: resolvedMedia.some((asset) => asset.kind === 'video'),
          logger,
        });

        return {
          success: true,
          platformPostId: published.postId,
          platformUrl: published.permalink,
        };
      }

      const primary = resolvedMedia[0];
      const published = await createAndPublishSingleMedia({
        schedule,
        credentials,
        formattedCaption,
        mediaUrl: primary.url,
        isVideo: primary.kind === 'video',
        isReel: flags.isReel,
        isStory: flags.isStory,
        thumbOffset: schedule.thumbOffset,
        logger,
      });

      return {
        success: true,
        platformPostId: published.postId,
        platformUrl: published.permalink,
      };
    } catch (error) {
      const err = error as Error;
      const meta = (error as { meta?: Record<string, unknown> }).meta || {};

      logger.error('Instagram publishing failed', {
        errorName: err.name,
        errorMessage: err.message,
        stack: err.stack,
        meta,
      });

      return {
        success: false,
        error: err.message,
        errorCode: (meta as { errorCode?: string }).errorCode || 'IG_PUBLISH_RUNTIME_ERROR',
        httpStatus: (meta as { httpStatus?: number }).httpStatus,
      };
    }
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && credentials?.accountId);
  }

  formatContent(schedule: Schedule): unknown {
    const mediaTypeRaw = (schedule.mediaType || schedule.contentType || '').toLowerCase();
    const effectiveMediaType =
      mediaTypeRaw === 'video' || mediaTypeRaw === 'reel' ? 'REELS' : 'IMAGE';

    return {
      caption: this.formatCaption(schedule.caption, schedule.hashtags),
      mediaType: effectiveMediaType,
    };
  }

  private getPublishFlags(schedule: Schedule): PublishFlags {
    const contentType = (schedule.contentType || '').toLowerCase();
    return {
      isReel: contentType === 'reel',
      isStory: contentType === 'story',
    };
  }

  private shouldUseCarousel(flags: PublishFlags, resolvedMedia: ResolvedMedia[]): boolean {
    return !flags.isReel && resolvedMedia.length > 1 && resolvedMedia.length <= 10;
  }

  private async resolveMedia(schedule: Schedule): Promise<ResolvedMedia[]> {
    const resolvedMedia: ResolvedMedia[] = [];

    if (!schedule.mediaAssets || schedule.mediaAssets.length === 0) {
      throw new Error('Media assets are required for Instagram publishing');
    }

    logger.info('Resolving structured mediaAssets for publishing', {
      assetCount: schedule.mediaAssets.length,
      types: schedule.mediaAssets.map((asset) => asset.type).join(','),
    });

    for (const asset of schedule.mediaAssets) {
      const signedUrl =
        asset.type === 'video'
          ? await getSignedVideoUrl(asset.key)
          : await getSignedImageUrlFromKey(asset.key);

      if (!signedUrl) {
        continue;
      }

      resolvedMedia.push({
        kind: asset.type,
        url: signedUrl,
      });
    }

    logger.info('Resolved media URLs for Instagram publish', {
      assets: resolvedMedia.map((media, idx) => ({
        idx,
        kind: media.kind,
        ...sanitizeUrlForLog(media.url),
      })),
    });

    return resolvedMedia;
  }

  private async publishStory(
    schedule: Schedule,
    credentials: Credentials,
    formattedCaption: string,
    resolvedMedia: ResolvedMedia[],
    flags: PublishFlags
  ): Promise<PublishResult> {
    const hasVideoAsset = resolvedMedia.some((asset) => asset.kind === 'video');
    const storyMedia = hasVideoAsset
      ? resolvedMedia.filter((asset) => asset.kind === 'video')
      : resolvedMedia.filter((asset) => asset.kind === 'image');

    if (!storyMedia.length) {
      throw new Error('Media URL is required for Instagram publishing');
    }

    const published: PublishedMedia[] = [];
    for (const asset of storyMedia.slice(0, 10)) {
      const single = await createAndPublishSingleMedia({
        schedule,
        credentials,
        formattedCaption,
        mediaUrl: asset.url,
        isVideo: asset.kind === 'video',
        isReel: flags.isReel,
        isStory: true,
        thumbOffset: asset.kind === 'video' ? schedule.thumbOffset : undefined,
        logger,
      });
      published.push(single);
    }

    return {
      success: true,
      platformPostId: published[0]?.postId,
      platformUrl: published[0]?.permalink,
    };
  }

  private formatCaption(
    caption: string | undefined | null,
    hashtags: string[] | undefined
  ): string {
    const safeCaption = caption ?? '';
    const hashtagString = hashtags?.length
      ? `\n\n${hashtags.map((tag) => `#${tag}`).join(' ')}`
      : '';
    return `${safeCaption}${hashtagString}`.slice(0, PLATFORM_LIMITS.INSTAGRAM_CAPTION);
  }

  async postComment(
    mediaId: string,
    commentText: string,
    credentials: Credentials,
    account: { externalAccountId: string }
  ): Promise<{ success: boolean; commentId?: string; error?: string }> {
    void account;

    try {
      if (!commentText || commentText.trim().length === 0) {
        return { success: false, error: 'Comment text is required' };
      }

      let validatedText = commentText;
      if (commentText.length > 2200) {
        validatedText = commentText.slice(0, 2200);
      }

      const hashtagCount = (validatedText.match(/#/g) || []).length;
      if (hashtagCount > 4) {
        return { success: false, error: 'Comments cannot contain more than 4 hashtags' };
      }

      const urlPattern = /https?:\/\//gi;
      const urlMatches = validatedText.match(urlPattern) || [];
      if (urlMatches.length > 1) {
        return { success: false, error: 'Comments cannot contain more than 1 URL' };
      }

      const commentUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${mediaId}/comments`;
      const params = new URLSearchParams({
        message: validatedText,
        access_token: credentials.accessToken,
      });

      const response = await fetch(commentUrl, {
        method: 'POST',
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Instagram comment API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      const commentId = data?.id;

      if (!commentId || typeof commentId !== 'string') {
        throw new Error('Failed to post Instagram comment - no comment ID returned');
      }

      return { success: true, commentId };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message || 'Failed to post comment',
      };
    }
  }

  async postFirstCommentWithRetry(
    mediaId: string,
    commentText: string,
    credentials: Credentials,
    account: { externalAccountId: string }
  ): Promise<{ success: boolean; commentId?: string; error?: string; retriesUsed: number }> {
    const result = await this.postComment(mediaId, commentText, credentials, account);

    if (result.success) {
      return { ...result, retriesUsed: 0 };
    }

    const maxAttempts = 3;
    const delay = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, delay));

      const retryResult = await this.postComment(mediaId, commentText, credentials, account);
      if (retryResult.success) {
        return { ...retryResult, retriesUsed: attempt };
      }
    }

    return { ...result, retriesUsed: maxAttempts };
  }
}
