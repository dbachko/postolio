import type { Logger } from '@aws-lambda-powertools/logger';
import type { Credentials, PublishedMedia, Schedule } from '../../types';
import { buildInstagramError, graphBaseUrl, parseInstagramErrorResponse } from './shared';
import { waitForMediaReady } from './status';
import { fetchPermalink, publishWithRetry } from './publish-common';

function buildCreateMediaParams(params: {
  schedule: Schedule;
  credentials: Credentials;
  formattedCaption: string;
  mediaUrl: string;
  isVideo: boolean;
  isReel: boolean;
  isStory: boolean;
  thumbOffset?: number;
}): URLSearchParams {
  const createMediaParams = new URLSearchParams({
    caption: params.formattedCaption,
    access_token: params.credentials.accessToken,
  });

  if (params.isVideo) {
    createMediaParams.set('video_url', params.mediaUrl);
    const mediaType = params.isStory ? 'STORIES' : 'REELS';
    createMediaParams.set('media_type', mediaType);

    const shareToFeed =
      params.schedule.contentType === 'reel' && typeof params.schedule.shareToFeed === 'boolean'
        ? params.schedule.shareToFeed
        : typeof params.schedule.shareToFeed === 'boolean'
          ? params.schedule.shareToFeed
          : true;

    if (!params.isStory) {
      createMediaParams.set('share_to_feed', shareToFeed ? 'true' : 'false');
    }

    if (params.thumbOffset !== undefined && params.thumbOffset >= 0) {
      createMediaParams.set('thumb_offset', params.thumbOffset.toString());
    }

    return createMediaParams;
  }

  createMediaParams.set('image_url', params.mediaUrl);
  if (params.isStory) {
    createMediaParams.set('media_type', 'STORIES');
  }

  return createMediaParams;
}

async function createMediaContainer(params: {
  schedule: Schedule;
  credentials: Credentials;
  formattedCaption: string;
  mediaUrl: string;
  isVideo: boolean;
  isReel: boolean;
  isStory: boolean;
  thumbOffset?: number;
  logger: Logger;
}): Promise<string> {
  const createMediaUrl = `${graphBaseUrl()}/${params.credentials.accountId}/media`;
  const createMediaParams = buildCreateMediaParams(params);

  params.logger.info('Creating Instagram media container', {
    accountId: params.credentials.accountId,
    hasMediaUrl: !!params.mediaUrl,
    contentType: params.schedule.contentType,
  });

  const createResponse = await fetch(`${createMediaUrl}?${createMediaParams}`, {
    method: 'POST',
  });

  if (!createResponse.ok) {
    const errorData = await parseInstagramErrorResponse(createResponse);
    throw buildInstagramError(`Failed to create media: ${errorData.message}`, {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
      httpStatus: createResponse.status,
      title: errorData.title,
    });
  }

  const createResult = await createResponse.json();
  const creationId = createResult.id;
  if (!creationId) {
    throw buildInstagramError('No creation ID returned from Instagram', {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
    });
  }

  return creationId;
}

export async function createAndPublishSingleMedia(params: {
  schedule: Schedule;
  credentials: Credentials;
  formattedCaption: string;
  mediaUrl: string;
  isVideo: boolean;
  isReel: boolean;
  isStory: boolean;
  thumbOffset?: number;
  logger: Logger;
}): Promise<PublishedMedia> {
  const creationId = await createMediaContainer(params);

  if (params.isVideo) {
    await waitForMediaReady({
      creationId,
      accessToken: params.credentials.accessToken,
      isVideo: true,
      logger: params.logger,
      options: { throwOnTimeout: true },
    });
  }

  const postId = await publishWithRetry({
    creationId,
    credentials: params.credentials,
    logger: params.logger,
    hasVideoMedia: params.isVideo,
    scope: 'media',
  });

  const permalink = await fetchPermalink(postId, params.credentials.accessToken);

  params.logger.info('Instagram content published successfully', {
    postId,
    permalink,
  });

  return {
    postId,
    permalink,
  };
}
