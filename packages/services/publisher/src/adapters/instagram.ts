import { Logger } from '@aws-lambda-powertools/logger';
import { API_VERSIONS, API_BASE_URLS } from '@postolio/aws';
import type {
  PlatformAdapter,
  Schedule,
  Credentials,
  PublishResult,
  PublishedMedia,
  ResolvedMedia,
  IGErrorPayload,
} from '../types';
import { PLATFORM_LIMITS } from '../constants';
import {
  sanitizeUrlForLog,
  getSignedVideoUrl,
  getSignedImageUrlFromKey,
  safeParseJson,
} from '../utils/media';

const logger = new Logger({ serviceName: 'publisher' });

function asIGErrorPayload(u: unknown): IGErrorPayload | null {
  if (!u || typeof u !== 'object') {
    return null;
  }
  if ('error' in u) {
    return u as IGErrorPayload;
  }
  return null;
}

export class InstagramAdapter implements PlatformAdapter {
  private async waitForMediaReady(
    creationId: string,
    accessToken: string,
    isVideo: boolean,
    opts?: {
      throwOnTimeout?: boolean;
      maxWaitMs?: number;
      pollIntervalMs?: number;
    }
  ): Promise<boolean> {
    if (process.env.IG_SKIP_MEDIA_WAIT === 'true' || process.env.NODE_ENV === 'test') {
      return true;
    }

    const statusUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${creationId}`;
    const defaultMaxWait = isVideo ? 900_000 : 300_000;
    const maxWaitMs = opts?.maxWaitMs ?? defaultMaxWait;
    const pollIntervalMs = opts?.pollIntervalMs ?? 60_000;
    const throwOnTimeout = opts?.throwOnTimeout ?? true;
    const started = Date.now();
    let attempt = 0;
    let lastStatus: string | undefined;

    while (Date.now() - started < maxWaitMs) {
      try {
        const params = new URLSearchParams({
          fields: 'status,status_code',
          access_token: accessToken,
        });
        const resp = await fetch(`${statusUrl}?${params}`);
        let rawBody = '';
        let body: unknown;
        try {
          rawBody = await resp.text();
          body = rawBody ? safeParseJson(rawBody) : null;
        } catch {
          rawBody = '';
          body = null;
        }
        const structuredBody =
          body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
        const statusValue =
          structuredBody && 'status' in structuredBody
            ? String(
                (structuredBody as { status?: string | number | null | undefined }).status ?? ''
              )
            : '';
        const statusCodeValue =
          structuredBody && 'status_code' in structuredBody
            ? String(
                (structuredBody as { status_code?: string | number | null | undefined })
                  .status_code ?? ''
              )
            : '';
        const errorMessageValue =
          structuredBody && 'error_message' in structuredBody
            ? String(
                (structuredBody as { error_message?: string | number | null | undefined })
                  .error_message ?? ''
              )
            : '';
        const code = statusCodeValue.toUpperCase();
        lastStatus = code || lastStatus;

        if (attempt === 0 || attempt % 5 === 0) {
          logger.info('Instagram media status check', {
            creationId,
            attempt,
            status_code: code || 'UNKNOWN',
            status: statusValue || undefined,
            error_message: errorMessageValue || undefined,
            httpStatus: resp.status,
          });
        }

        if (!resp.ok) {
          const errorPayload =
            structuredBody && 'error' in structuredBody
              ? (
                  structuredBody as {
                    error?: {
                      error_user_msg?: string;
                      error_user_title?: string;
                      message?: string;
                      type?: string;
                      code?: number;
                      error_subcode?: number;
                      fbtrace_id?: string;
                    };
                  }
                ).error
              : undefined;
          const message =
            errorPayload?.error_user_msg || errorPayload?.message || `HTTP ${resp.status}`;
          logger.warn('Instagram media status check returned HTTP error', {
            creationId,
            attempt,
            httpStatus: resp.status,
            error: message,
            raw_body: rawBody || undefined,
            error_user_title: errorPayload?.error_user_title,
            error_user_msg: errorPayload?.error_user_msg,
            error_type: errorPayload?.type,
            error_code: errorPayload?.code,
            error_subcode: errorPayload?.error_subcode,
            fbtrace_id: errorPayload?.fbtrace_id,
          });
          if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) {
            const err = new Error(`Instagram status endpoint returned ${resp.status}: ${message}`);
            (err as unknown as { meta?: Record<string, unknown> }).meta = {
              errorCode: 'IG_MEDIA_STATUS_HTTP_ERROR',
              httpStatus: resp.status,
              error_user_msg: errorPayload?.error_user_msg,
              error_user_title: errorPayload?.error_user_title,
              error_type: errorPayload?.type,
              error_code: errorPayload?.code,
              error_subcode: errorPayload?.error_subcode,
              fbtrace_id: errorPayload?.fbtrace_id,
              raw_body: rawBody || undefined,
            };
            throw err;
          }
        }

        if (!code) {
          const logPayload = {
            creationId,
            attempt,
            raw_body: rawBody || structuredBody || undefined,
            httpStatus: resp.status,
            status: statusValue || undefined,
            error_message: errorMessageValue || undefined,
          };
          if (attempt === 0) {
            logger.warn('Instagram media status response had no status code', logPayload);
          } else {
            logger.debug('Instagram media status response had no status code', logPayload);
          }
        }

        if (code === 'FINISHED' || code === 'PUBLISHED' || code === 'READY') {
          return true;
        }
        if (code === 'ERROR' || code === 'EXPIRED') {
          const reason =
            errorMessageValue ||
            statusValue ||
            rawBody ||
            (structuredBody ? JSON.stringify(structuredBody) : 'unknown');
          const processingErrorCodeMatch =
            typeof reason === 'string'
              ? reason.match(/(?:code|error\s+code)\s+(\d{7})/i)
              : undefined;
          const processingErrorCode = processingErrorCodeMatch?.[1];
          const isUnsupportedVideoSpec =
            processingErrorCode && ['2207026', '2207076'].includes(processingErrorCode);
          logger.error('Instagram media processing error reported by API', {
            creationId,
            attempt,
            status_code: code || 'UNKNOWN',
            status: statusValue || undefined,
            error_message: errorMessageValue || undefined,
            processing_error_code: processingErrorCode || undefined,
            raw_body: rawBody || structuredBody || undefined,
          });
          const err = new Error(
            isUnsupportedVideoSpec
              ? `Instagram rejected the video format/spec (code ${processingErrorCode}). Re-encode to MP4 (H.264/AAC) with supported aspect ratio and duration.`
              : `Instagram media processing error: ${reason}`
          );
          const meta: Record<string, unknown> = {
            errorCode: isUnsupportedVideoSpec
              ? 'IG_VIDEO_UNSUPPORTED_SPEC'
              : 'IG_MEDIA_PROCESSING_ERROR',
            igStatusCode: code || undefined,
            igStatus: statusValue || undefined,
            igErrorMessage: errorMessageValue || undefined,
            igProcessingCode: processingErrorCode || undefined,
            httpStatus: resp.status,
            raw_body: rawBody || undefined,
          };
          if (isUnsupportedVideoSpec) {
            meta.action =
              'Re-encode video to MP4 (H.264/AAC), keep duration within Instagram limits (3-90s for Reels) and use supported aspect ratios (9:16 for Reels, 1.91:1 to 4:5 for feed).';
          }
          (err as unknown as { meta?: Record<string, unknown> }).meta = meta;
          throw err;
        }
      } catch (e) {
        if ((e as Error)?.message?.startsWith('Instagram media processing error')) {
          throw e;
        }
        logger.warn('Failed to check Instagram media status', {
          creationId,
          attempt,
          error: (e as Error).message,
        });
      }

      attempt += 1;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    const waitedMs = Date.now() - started;
    logger.warn('Timed out waiting for Instagram media readiness', {
      creationId,
      isVideo,
      waitedMs,
      lastStatus: lastStatus || 'UNKNOWN',
    });

    if (throwOnTimeout) {
      const err = new Error('Media is not ready for publishing after waiting');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_READY_TIMEOUT',
        waitedMs,
        lastStatus: lastStatus || 'UNKNOWN',
        isVideo,
      };
      throw err;
    }
    return false;
  }

  async publish(schedule: Schedule, credentials: Credentials): Promise<PublishResult> {
    try {
      const formattedCaption = this.formatCaption(schedule.caption, schedule.hashtags);
      const contentType = (schedule.contentType || '').toLowerCase();
      const isReel = contentType === 'reel';
      const isStory = contentType === 'story';

      const resolvedMedia: ResolvedMedia[] = [];

      if (!schedule.mediaAssets || schedule.mediaAssets.length === 0) {
        throw new Error('Media assets are required for Instagram publishing');
      }

      logger.info('Resolving structured mediaAssets for publishing', {
        assetCount: schedule.mediaAssets.length,
        types: schedule.mediaAssets.map((a) => a.type).join(','),
      });

      for (const asset of schedule.mediaAssets) {
        const signedUrl =
          asset.type === 'video'
            ? await getSignedVideoUrl(asset.key)
            : await getSignedImageUrlFromKey(asset.key);

        if (signedUrl) {
          resolvedMedia.push({
            kind: asset.type,
            url: signedUrl,
          });
        }
      }

      logger.info('Resolved media URLs for Instagram publish', {
        assets: resolvedMedia.map((m, idx) => ({
          idx,
          kind: m.kind,
          ...sanitizeUrlForLog(m.url),
        })),
      });

      if (!resolvedMedia.length) {
        throw new Error('Media URL is required for Instagram publishing');
      }

      if (isStory) {
        const hasVideoAsset = resolvedMedia.some((m) => m.kind === 'video');
        const storyMedia = hasVideoAsset
          ? resolvedMedia.filter((m) => m.kind === 'video')
          : resolvedMedia.filter((m) => m.kind === 'image');

        if (!storyMedia.length) {
          throw new Error('Media URL is required for Instagram publishing');
        }

        const published: PublishedMedia[] = [];
        for (const asset of storyMedia.slice(0, 10)) {
          const single = await this.createAndPublishMedia({
            schedule,
            credentials,
            formattedCaption,
            mediaUrl: asset.url,
            isVideo: asset.kind === 'video',
            isReel,
            isStory,
            thumbOffset: asset.kind === 'video' ? schedule.thumbOffset : undefined,
          });
          published.push(single);
        }
        const first = published[0];
        return {
          success: true,
          platformPostId: first?.postId,
          platformUrl: first?.permalink,
        };
      }

      const isCarousel = !isReel && resolvedMedia.length > 1 && resolvedMedia.length <= 10;
      const hasVideoMedia = resolvedMedia.some((m) => m.kind === 'video');

      if (isCarousel) {
        const carousel = await this.createCarouselAndPublish({
          schedule,
          credentials,
          formattedCaption,
          media: resolvedMedia.slice(0, 10),
          hasVideoMedia,
        });
        return {
          success: true,
          platformPostId: carousel.postId,
          platformUrl: carousel.permalink,
        };
      }

      const primary = resolvedMedia[0];
      const single = await this.createAndPublishMedia({
        schedule,
        credentials,
        formattedCaption,
        mediaUrl: primary.url,
        isVideo: primary.kind === 'video',
        isReel,
        isStory,
        thumbOffset: schedule.thumbOffset,
      });

      return {
        success: true,
        platformPostId: single.postId,
        platformUrl: single.permalink,
      };
    } catch (error) {
      const err = error as Error;
      const meta = (error as unknown as { meta?: Record<string, unknown> }).meta || {};
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

  private async createAndPublishMedia(params: {
    schedule: Schedule;
    credentials: Credentials;
    formattedCaption: string;
    mediaUrl: string;
    isVideo: boolean;
    isReel: boolean;
    isStory: boolean;
    thumbOffset?: number;
  }): Promise<PublishedMedia> {
    const {
      schedule,
      credentials,
      formattedCaption,
      mediaUrl,
      isVideo,
      isReel,
      isStory,
      thumbOffset,
    } = params;

    const createMediaUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media`;
    const createMediaParams = new URLSearchParams({
      caption: formattedCaption,
      access_token: credentials.accessToken,
    });
    if (isVideo) {
      createMediaParams.set('video_url', mediaUrl);
      if (isReel) {
        createMediaParams.set('media_type', 'REELS');
        let shareToFeed = true;
        if (schedule.contentType === 'reel' && typeof schedule.shareToFeed === 'boolean') {
          shareToFeed = schedule.shareToFeed;
        }
        createMediaParams.set('share_to_feed', shareToFeed ? 'true' : 'false');

        if (thumbOffset !== undefined && thumbOffset >= 0) {
          createMediaParams.set('thumb_offset', thumbOffset.toString());
        }
      } else if (isStory) {
        createMediaParams.set('media_type', 'STORIES');
      } else {
        const shareToFeed = typeof schedule.shareToFeed === 'boolean' ? schedule.shareToFeed : true;
        createMediaParams.set('media_type', 'REELS');
        createMediaParams.set('share_to_feed', shareToFeed ? 'true' : 'false');

        if (thumbOffset !== undefined && thumbOffset >= 0) {
          createMediaParams.set('thumb_offset', thumbOffset.toString());
        }
      }
    } else {
      createMediaParams.set('image_url', mediaUrl);
      if (isStory) {
        createMediaParams.set('media_type', 'STORIES');
      }
    }

    logger.info('Creating Instagram media container', {
      accountId: credentials.accountId,
      hasMediaUrl: !!mediaUrl,
      mediaUrl: sanitizeUrlForLog(mediaUrl),
      mediaKind: (() => {
        if (isReel) {
          return 'reel';
        }
        if (isStory && isVideo) {
          return 'story_video';
        }
        if (isStory) {
          return 'story_image';
        }
        if (isVideo) {
          return 'video';
        }
        return 'image';
      })(),
      contentType: schedule.contentType,
    });

    const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
      method: 'POST',
    });

    if (!createResponse.ok) {
      const raw = await createResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to create Instagram media container', {
        status: createResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create media: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: createResponse.status,
      };
      throw err;
    }

    const createResult = await createResponse.json();
    const creationId = createResult.id;

    if (!creationId) {
      const err = new Error('No creation ID returned from Instagram');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    if (isVideo) {
      await this.waitForMediaReady(creationId, credentials.accessToken, true, {
        throwOnTimeout: true,
      });
    }

    const publishUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media_publish`;
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: credentials.accessToken,
    });

    const tryPublish = async () => {
      logger.info('Publishing Instagram media', { creationId });
      const resp = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });
      if (resp.ok) {
        return { resp };
      }
      const raw = await resp.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      return { resp, raw, igMsg, igTitle };
    };

    let publishAttempt = await tryPublish();

    const notReady =
      publishAttempt.igMsg &&
      /not ready|not\s+ready\s+for\s+publishing|finish processing|processing|cannot\s+be\s+found/i.test(
        publishAttempt.igMsg
      );
    if (!publishAttempt.resp.ok && notReady) {
      logger.warn('Instagram reported media not ready; waiting before retry', {
        creationId,
        isVideo,
        message: publishAttempt.igMsg,
      });
      if (isVideo) {
        await this.waitForMediaReady(creationId, credentials.accessToken, true, {
          throwOnTimeout: true,
        });
      } else {
        await new Promise((r) => setTimeout(r, 60_000));
      }
      publishAttempt = await tryPublish();
    }

    if (!publishAttempt.resp.ok) {
      const igMsg =
        publishAttempt.igMsg ||
        publishAttempt.raw ||
        `HTTP ${publishAttempt.resp.status} from Instagram`;
      const igTitle = publishAttempt.igTitle;
      logger.error('Failed to publish Instagram media', {
        status: publishAttempt.resp.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to publish: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_PUBLISH_FAILED',
        httpStatus: publishAttempt.resp.status,
        title: igTitle,
      };
      throw err;
    }

    const publishResult = await publishAttempt.resp.json();
    const postId = publishResult.id;

    const permalinkUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${postId}`;
    const permalinkParams = new URLSearchParams({
      fields: 'permalink',
      access_token: credentials.accessToken,
    });

    const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
    let permalink = '';

    if (permalinkResponse.ok) {
      const permalinkResult = await permalinkResponse.json();
      permalink = permalinkResult.permalink || '';
    }

    logger.info('Instagram content published successfully', {
      postId,
      permalink,
    });

    return { postId, permalink };
  }

  private async createCarouselAndPublish(params: {
    schedule?: Schedule;
    credentials: Credentials;
    formattedCaption: string;
    media: ResolvedMedia[];
    hasVideoMedia: boolean;
  }): Promise<PublishedMedia> {
    const { credentials, formattedCaption, media, hasVideoMedia } = params;

    const childIds: string[] = [];
    for (const asset of media) {
      const creationId = await this.createChildContainer({
        credentials,
        mediaUrl: asset.url,
        isVideo: asset.kind === 'video',
      });
      childIds.push(creationId);
    }

    if (!childIds.length) {
      const err = new Error('No carousel children were created');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    const createMediaUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media`;
    const createMediaParams = new URLSearchParams({
      caption: formattedCaption,
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      access_token: credentials.accessToken,
    });

    logger.info('Creating Instagram carousel container', {
      accountId: credentials.accountId,
      childCount: childIds.length,
    });

    const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
      method: 'POST',
    });

    if (!createResponse.ok) {
      const raw = await createResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to create Instagram carousel container', {
        status: createResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create carousel: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: createResponse.status,
      };
      throw err;
    }

    const createResult = await createResponse.json();
    const creationId = createResult.id;

    if (!creationId) {
      const err = new Error('No creation ID returned from Instagram for carousel');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    if (hasVideoMedia) {
      await this.waitForMediaReady(creationId, credentials.accessToken, true, {
        throwOnTimeout: true,
      });
    }

    const publishUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${credentials.accountId}/media_publish`;
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: credentials.accessToken,
    });

    const tryPublish = async () => {
      logger.info('Publishing Instagram carousel', { creationId });
      const resp = await fetch(`${publishUrl}?${publishParams}`, {
        method: 'POST',
      });
      if (resp.ok) {
        return { resp };
      }
      const raw = await resp.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      return { resp, raw, igMsg, igTitle };
    };

    let publishAttempt = await tryPublish();
    const notReady =
      publishAttempt.igMsg &&
      /not ready|not\s+ready\s+for\s+publishing|finish processing|processing|cannot\s+be\s+found/i.test(
        publishAttempt.igMsg
      );

    if (!publishAttempt.resp.ok && notReady) {
      logger.warn('Carousel not ready; waiting before retry', {
        creationId,
        message: publishAttempt.igMsg,
      });
      if (hasVideoMedia) {
        await this.waitForMediaReady(creationId, credentials.accessToken, true, {
          throwOnTimeout: true,
        });
      } else {
        await new Promise((r) => setTimeout(r, 60_000));
      }
      publishAttempt = await tryPublish();
    }

    if (!publishAttempt.resp.ok) {
      const igMsg =
        publishAttempt.igMsg ||
        publishAttempt.raw ||
        `HTTP ${publishAttempt.resp.status} from Instagram`;
      const igTitle = publishAttempt.igTitle;
      logger.error('Failed to publish Instagram carousel', {
        status: publishAttempt.resp.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to publish carousel: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_PUBLISH_FAILED',
        httpStatus: publishAttempt.resp.status,
        title: igTitle,
      };
      throw err;
    }

    const publishResult = await publishAttempt.resp.json();
    const postId = publishResult.id;

    const permalinkUrl = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}/${postId}`;
    const permalinkParams = new URLSearchParams({
      fields: 'permalink',
      access_token: credentials.accessToken,
    });

    const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
    let permalink = '';

    if (permalinkResponse.ok) {
      const permalinkResult = await permalinkResponse.json();
      permalink = permalinkResult.permalink || '';
    }

    logger.info('Instagram carousel published successfully', {
      postId,
      permalink,
    });

    return { postId, permalink };
  }

  private async createChildContainer(params: {
    credentials: Credentials;
    mediaUrl: string;
    isVideo: boolean;
  }): Promise<string> {
    const { credentials, mediaUrl, isVideo } = params;
    const graphBase = `${API_BASE_URLS.FACEBOOK_GRAPH}/${API_VERSIONS.FACEBOOK_GRAPH}`;

    if (!isVideo) {
      const createMediaUrl = `${graphBase}/${credentials.accountId}/media`;
      const createMediaParams = new URLSearchParams({
        access_token: credentials.accessToken,
        is_carousel_item: 'true',
        image_url: mediaUrl,
      });

      const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
        method: 'POST',
      });

      logger.info('Creating Instagram carousel child (image)', {
        accountId: credentials.accountId,
        media: sanitizeUrlForLog(mediaUrl),
      });

      if (!createResponse.ok) {
        const raw = await createResponse.text();
        const parsed = asIGErrorPayload(safeParseJson(raw));
        const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
        const igTitle = parsed?.error?.error_user_title;
        logger.error('Failed to create Instagram carousel child', {
          status: createResponse.status,
          error: igMsg,
          title: igTitle,
        });
        const err = new Error(`Failed to create carousel child: ${igMsg}`);
        (err as unknown as { meta?: Record<string, unknown> }).meta = {
          errorCode: 'IG_MEDIA_CREATE_FAILED',
          httpStatus: createResponse.status,
        };
        throw err;
      }

      const createResult = await createResponse.json();
      const creationId = createResult.id;

      if (!creationId) {
        const err = new Error('No creation ID returned for carousel child');
        (err as unknown as { meta?: Record<string, unknown> }).meta = {
          errorCode: 'IG_MEDIA_CREATE_FAILED',
        };
        throw err;
      }

      return creationId;
    }

    // Instagram requires explicit media_type for carousel video children per API docs.
    const createMediaUrl = `${graphBase}/${credentials.accountId}/media`;
    const createMediaParams = new URLSearchParams({
      access_token: credentials.accessToken,
      is_carousel_item: 'true',
      media_type: 'VIDEO',
      video_url: mediaUrl,
    });

    logger.info('Creating Instagram carousel child (video)', {
      accountId: credentials.accountId,
      media: sanitizeUrlForLog(mediaUrl),
    });

    const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
      method: 'POST',
    });

    if (!createResponse.ok) {
      const raw = await createResponse.text();
      const parsed = asIGErrorPayload(safeParseJson(raw));
      const igMsg = parsed?.error?.error_user_msg || parsed?.error?.message || raw;
      const igTitle = parsed?.error?.error_user_title;
      logger.error('Failed to create Instagram carousel video child', {
        status: createResponse.status,
        error: igMsg,
        title: igTitle,
      });
      const err = new Error(`Failed to create carousel child: ${igMsg}`);
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
        httpStatus: createResponse.status,
      };
      throw err;
    }

    const createResult = await createResponse.json();
    const creationId = createResult.id;

    if (!creationId) {
      const err = new Error('No creation ID returned for carousel video child');
      (err as unknown as { meta?: Record<string, unknown> }).meta = {
        errorCode: 'IG_MEDIA_CREATE_FAILED',
      };
      throw err;
    }

    await this.waitForMediaReady(creationId, credentials.accessToken, true, {
      throwOnTimeout: true,
    });

    return creationId;
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
