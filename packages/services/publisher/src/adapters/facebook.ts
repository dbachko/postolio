import { Logger } from '@aws-lambda-powertools/logger';
import { API_VERSIONS, API_BASE_URLS } from '@postolio/aws';
import type { PlatformAdapter, Schedule, Credentials, PublishResult } from '../types';
import {
  getSignedImageUrlFromKey,
  getSignedVideoUrl,
  sanitizeUrlForLog,
  safeParseJson,
} from '../utils/media';

function readStringField(obj: unknown, field: string): string | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const value = (obj as Record<string, unknown>)[field];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export class FacebookAdapter implements PlatformAdapter {
  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    const logger = new Logger({ serviceName: 'publisher' });

    const pageId = credentials.pageId || credentials.accountId;
    if (!pageId) {
      return {
        success: false,
        error: 'Facebook Page ID not found in credentials',
        errorCode: 'FB_MISSING_PAGE',
      };
    }

    const message = this.formatMessage(schedule.caption, schedule.hashtags);
    const mediaAssets = this.getSortedMediaAssets(schedule);
    const hasImages = mediaAssets.some((asset) => asset.type === 'image');
    const hasVideos = mediaAssets.some((asset) => asset.type === 'video');

    if (hasImages && hasVideos) {
      return {
        success: false,
        error: 'Facebook posts cannot mix images and videos in the same post',
        errorCode: 'FB_MEDIA_MIXED',
      };
    }

    try {
      if (!hasImages && !hasVideos) {
        return this.publishTextOnly(pageId, credentials.accessToken, message);
      }

      if (hasVideos) {
        return this.publishVideoOnly(pageId, credentials.accessToken, message, mediaAssets, logger);
      }

      return this.publishImagePost(pageId, credentials.accessToken, message, mediaAssets, logger);
    } catch (error) {
      const err = error as Error & { meta?: { httpStatus?: number; errorCode?: string } };
      return {
        success: false,
        error: err.message || 'Facebook publishing failed',
        httpStatus: err.meta?.httpStatus,
        errorCode: err.meta?.errorCode,
      };
    }
  }

  private getSortedMediaAssets(
    schedule: Schedule
  ): Array<{ key: string; type: string; order?: number }> {
    const mediaAssets = Array.isArray(schedule.mediaAssets) ? schedule.mediaAssets.slice() : [];
    mediaAssets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return mediaAssets;
  }

  private async publishTextOnly(
    pageId: string,
    accessToken: string,
    message: string
  ): Promise<PublishResult> {
    if (!message.trim()) {
      return {
        success: false,
        error: 'Facebook post requires text or media',
        errorCode: 'FB_CONTENT_REQUIRED',
      };
    }

    const postId = await this.createFeedPost({
      pageId,
      accessToken,
      message,
    });
    const permalink = await this.fetchPermalinkUrl(postId, accessToken);
    return { success: true, platformPostId: postId, platformUrl: permalink || undefined };
  }

  private async publishVideoOnly(
    pageId: string,
    accessToken: string,
    message: string,
    mediaAssets: Array<{ key: string; type: string }>,
    logger: Logger
  ): Promise<PublishResult> {
    const videos = mediaAssets.filter((asset) => asset.type === 'video');
    if (videos.length !== 1) {
      return {
        success: false,
        error: 'Facebook video publishing currently supports exactly one video asset per post',
        errorCode: 'FB_VIDEO_COUNT',
      };
    }

    const videoUrl = await getSignedVideoUrl(videos[0]!.key);
    logger.info('Resolved video URL for Facebook publish', { ...sanitizeUrlForLog(videoUrl) });

    const videoId = await this.uploadVideo({
      pageId,
      accessToken,
      fileUrl: videoUrl,
      description: message,
    });

    const permalink = await this.fetchPermalinkUrl(videoId, accessToken);
    return { success: true, platformPostId: videoId, platformUrl: permalink || undefined };
  }

  private async publishImagePost(
    pageId: string,
    accessToken: string,
    message: string,
    mediaAssets: Array<{ key: string; type: string }>,
    logger: Logger
  ): Promise<PublishResult> {
    const images = mediaAssets.filter((asset) => asset.type === 'image');
    if (images.length === 1) {
      return this.publishSingleImage(pageId, accessToken, message, images[0]!.key, logger);
    }

    return this.publishImageAlbum(pageId, accessToken, message, images, logger);
  }

  private async publishSingleImage(
    pageId: string,
    accessToken: string,
    message: string,
    imageKey: string,
    logger: Logger
  ): Promise<PublishResult> {
    const imageUrl = await getSignedImageUrlFromKey(imageKey);
    logger.info('Resolved image URL for Facebook publish', { ...sanitizeUrlForLog(imageUrl) });

    const { postId } = await this.publishSinglePhoto({
      pageId,
      accessToken,
      imageUrl,
      caption: message,
    });

    const permalink = await this.fetchPermalinkUrl(postId, accessToken);
    return { success: true, platformPostId: postId, platformUrl: permalink || undefined };
  }

  private async publishImageAlbum(
    pageId: string,
    accessToken: string,
    message: string,
    images: Array<{ key: string }>,
    logger: Logger
  ): Promise<PublishResult> {
    const imageUrls: string[] = [];
    for (const image of images.slice(0, 10)) {
      const url = await getSignedImageUrlFromKey(image.key);
      imageUrls.push(url);
    }

    logger.info('Resolved image URLs for Facebook album publish', {
      count: imageUrls.length,
      urls: imageUrls.map((url) => sanitizeUrlForLog(url)),
    });

    const photoIds: string[] = [];
    for (const imageUrl of imageUrls) {
      const photoId = await this.uploadUnpublishedPhoto({
        pageId,
        accessToken,
        imageUrl,
      });
      photoIds.push(photoId);
    }

    const postId = await this.createFeedPostWithAttachedMedia({
      pageId,
      accessToken,
      message,
      photoIds,
    });
    const permalink = await this.fetchPermalinkUrl(postId, accessToken);
    return { success: true, platformPostId: postId, platformUrl: permalink || undefined };
  }

  validateCredentials(credentials: Credentials): boolean {
    return !!(credentials?.accessToken && (credentials?.pageId || credentials?.accountId));
  }

  formatContent(schedule: Schedule): unknown {
    return {
      message: this.formatMessage(schedule.caption, schedule.hashtags),
    };
  }

  private formatMessage(
    caption: string | undefined | null,
    hashtags: string[] | undefined
  ): string {
    const safeCaption = caption ?? '';
    const normalizedCaption = safeCaption.trim();
    const existing = new Set(
      (normalizedCaption.match(/#[A-Za-z0-9_]+/g) || []).map((tag) => tag.slice(1).toLowerCase())
    );

    const extraHashtags = hashtags?.length
      ? hashtags
          .map((t) => String(t || '').trim())
          .filter((t) => t.length > 0)
          .filter((t) => !existing.has(t.toLowerCase()))
          .map((t) => `#${t}`)
      : [];

    const hashtagString = extraHashtags.length ? `\n\n${extraHashtags.join(' ')}` : '';
    return `${safeCaption}${hashtagString}`;
  }

  private graphUrl(path: string): string {
    const trimmed = path.replace(/^\/+/, '');
    return `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${trimmed}`;
  }

  private async readGraphJson(resp: Response): Promise<unknown> {
    const raw = await resp.text().catch(() => '');
    return raw ? safeParseJson(raw) : null;
  }

  private extractGraphErrorMessage(body: unknown, fallback: string): string {
    if (!body || typeof body !== 'object') {
      return fallback;
    }
    const error = (body as { error?: Record<string, unknown> }).error;
    if (!error || typeof error !== 'object') {
      return fallback;
    }
    const userMsg = error.error_user_msg;
    const msg = error.message;
    if (typeof userMsg === 'string' && userMsg.trim()) {
      return userMsg.trim();
    }
    if (typeof msg === 'string' && msg.trim()) {
      return msg.trim();
    }
    return fallback;
  }

  private buildGraphError(
    resp: Response,
    body: unknown,
    fallback: string
  ): Error & { meta?: Record<string, unknown> } {
    const error = new Error(this.extractGraphErrorMessage(body, fallback)) as Error & {
      meta?: Record<string, unknown>;
    };
    const graphError =
      body && typeof body === 'object' ? (body as { error?: Record<string, unknown> }).error : null;
    const code = graphError && typeof graphError.code === 'number' ? graphError.code : undefined;
    const subcode =
      graphError && typeof graphError.error_subcode === 'number'
        ? graphError.error_subcode
        : undefined;
    let errorCode: string | undefined;
    if (code) {
      errorCode = `FB_${code}${subcode ? `_${subcode}` : ''}`;
    } else if (resp.status === 401) {
      errorCode = 'FB_UNAUTHORIZED';
    }

    error.meta = {
      httpStatus: resp.status,
      errorCode,
    };
    return error;
  }

  private async createFeedPost(params: {
    pageId: string;
    accessToken: string;
    message: string;
  }): Promise<string> {
    const url = this.graphUrl(`${params.pageId}/feed`);
    const body = new URLSearchParams({
      message: params.message,
      access_token: params.accessToken,
    });
    const resp = await fetch(url, { method: 'POST', body });
    const data = await this.readGraphJson(resp);
    if (!resp.ok) {
      throw this.buildGraphError(resp, data, `Facebook feed post failed (HTTP ${resp.status})`);
    }
    const id = readStringField(data, 'id');
    if (!id || typeof id !== 'string') {
      throw new Error('Facebook feed post did not return an id');
    }
    return id;
  }

  private async publishSinglePhoto(params: {
    pageId: string;
    accessToken: string;
    imageUrl: string;
    caption: string;
  }): Promise<{ postId: string }> {
    const url = this.graphUrl(`${params.pageId}/photos`);
    const body = new URLSearchParams({
      url: params.imageUrl,
      caption: params.caption,
      published: 'true',
      access_token: params.accessToken,
    });
    const resp = await fetch(url, { method: 'POST', body });
    const data = await this.readGraphJson(resp);
    if (!resp.ok) {
      throw this.buildGraphError(resp, data, `Facebook photo publish failed (HTTP ${resp.status})`);
    }

    const postId = readStringField(data, 'post_id') || readStringField(data, 'id');

    if (!postId) {
      throw new Error('Facebook photo publish did not return an id');
    }

    return { postId };
  }

  private async uploadUnpublishedPhoto(params: {
    pageId: string;
    accessToken: string;
    imageUrl: string;
  }): Promise<string> {
    const url = this.graphUrl(`${params.pageId}/photos`);
    const body = new URLSearchParams({
      url: params.imageUrl,
      published: 'false',
      access_token: params.accessToken,
    });
    const resp = await fetch(url, { method: 'POST', body });
    const data = await this.readGraphJson(resp);
    if (!resp.ok) {
      throw this.buildGraphError(resp, data, `Facebook photo upload failed (HTTP ${resp.status})`);
    }
    const id = readStringField(data, 'id');
    if (!id || typeof id !== 'string') {
      throw new Error('Facebook photo upload did not return an id');
    }
    return id;
  }

  private async createFeedPostWithAttachedMedia(params: {
    pageId: string;
    accessToken: string;
    message: string;
    photoIds: string[];
  }): Promise<string> {
    const url = this.graphUrl(`${params.pageId}/feed`);
    const body = new URLSearchParams({
      message: params.message,
      access_token: params.accessToken,
    });
    params.photoIds.forEach((photoId, idx) => {
      body.append(`attached_media[${idx}]`, JSON.stringify({ media_fbid: photoId }));
    });
    const resp = await fetch(url, { method: 'POST', body });
    const data = await this.readGraphJson(resp);
    if (!resp.ok) {
      throw this.buildGraphError(resp, data, `Facebook album publish failed (HTTP ${resp.status})`);
    }
    const id = readStringField(data, 'id');
    if (!id || typeof id !== 'string') {
      throw new Error('Facebook album publish did not return an id');
    }
    return id;
  }

  private async uploadVideo(params: {
    pageId: string;
    accessToken: string;
    fileUrl: string;
    description: string;
  }): Promise<string> {
    const url = this.graphUrl(`${params.pageId}/videos`);
    const body = new URLSearchParams({
      file_url: params.fileUrl,
      description: params.description,
      access_token: params.accessToken,
    });
    const resp = await fetch(url, { method: 'POST', body });
    const data = await this.readGraphJson(resp);
    if (!resp.ok) {
      throw this.buildGraphError(resp, data, `Facebook video publish failed (HTTP ${resp.status})`);
    }
    const id = readStringField(data, 'id');
    if (!id || typeof id !== 'string') {
      throw new Error('Facebook video publish did not return an id');
    }
    return id;
  }

  private async fetchPermalinkUrl(id: string, accessToken: string): Promise<string | null> {
    const url = new URL(this.graphUrl(id));
    url.searchParams.set('fields', 'permalink_url');
    url.searchParams.set('access_token', accessToken);

    const resp = await fetch(url.toString(), { method: 'GET' });
    const body = await this.readGraphJson(resp);
    if (!resp.ok) {
      return null;
    }
    return readStringField(body, 'permalink_url');
  }
}
