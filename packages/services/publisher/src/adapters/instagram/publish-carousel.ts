import type { Logger } from '@aws-lambda-powertools/logger';
import type { Credentials, PublishedMedia, ResolvedMedia } from '../../types';
import { buildInstagramError, graphBaseUrl, parseInstagramErrorResponse } from './shared';
import { waitForMediaReady } from './status';
import { fetchPermalink, publishWithRetry } from './publish-common';

async function createImageChildContainer(params: {
  credentials: Credentials;
  mediaUrl: string;
  logger: Logger;
}): Promise<string> {
  const createMediaUrl = `${graphBaseUrl()}/${params.credentials.accountId}/media`;
  const createMediaParams = new URLSearchParams({
    access_token: params.credentials.accessToken,
    is_carousel_item: 'true',
    image_url: params.mediaUrl,
  });

  params.logger.info('Creating Instagram carousel child (image)', {
    accountId: params.credentials.accountId,
  });

  const response = await fetch(`${createMediaUrl}?${createMediaParams}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await parseInstagramErrorResponse(response);
    throw buildInstagramError(`Failed to create carousel child: ${errorData.message}`, {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
      httpStatus: response.status,
      title: errorData.title,
    });
  }

  const result = await response.json();
  if (!result.id) {
    throw buildInstagramError('No creation ID returned for carousel child', {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
    });
  }

  return result.id;
}

async function createVideoChildContainer(params: {
  credentials: Credentials;
  mediaUrl: string;
  logger: Logger;
}): Promise<string> {
  const createMediaUrl = `${graphBaseUrl()}/${params.credentials.accountId}/media`;
  const createMediaParams = new URLSearchParams({
    access_token: params.credentials.accessToken,
    is_carousel_item: 'true',
    media_type: 'VIDEO',
    video_url: params.mediaUrl,
  });

  params.logger.info('Creating Instagram carousel child (video)', {
    accountId: params.credentials.accountId,
  });

  const response = await fetch(`${createMediaUrl}?${createMediaParams}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await parseInstagramErrorResponse(response);
    throw buildInstagramError(`Failed to create carousel child: ${errorData.message}`, {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
      httpStatus: response.status,
      title: errorData.title,
    });
  }

  const result = await response.json();
  if (!result.id) {
    throw buildInstagramError('No creation ID returned for carousel video child', {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
    });
  }

  await waitForMediaReady({
    creationId: result.id,
    accessToken: params.credentials.accessToken,
    isVideo: true,
    logger: params.logger,
    options: { throwOnTimeout: true },
  });

  return result.id;
}

export async function createChildContainer(params: {
  credentials: Credentials;
  mediaUrl: string;
  isVideo: boolean;
  logger: Logger;
}): Promise<string> {
  if (!params.isVideo) {
    return createImageChildContainer(params);
  }

  return createVideoChildContainer(params);
}

async function createCarouselContainer(params: {
  credentials: Credentials;
  formattedCaption: string;
  childIds: string[];
  logger: Logger;
}): Promise<string> {
  const createMediaUrl = `${graphBaseUrl()}/${params.credentials.accountId}/media`;
  const createMediaParams = new URLSearchParams({
    caption: params.formattedCaption,
    media_type: 'CAROUSEL',
    children: params.childIds.join(','),
    access_token: params.credentials.accessToken,
  });

  params.logger.info('Creating Instagram carousel container', {
    accountId: params.credentials.accountId,
    childCount: params.childIds.length,
  });

  const response = await fetch(`${createMediaUrl}?${createMediaParams}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const errorData = await parseInstagramErrorResponse(response);
    throw buildInstagramError(`Failed to create carousel: ${errorData.message}`, {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
      httpStatus: response.status,
      title: errorData.title,
    });
  }

  const result = await response.json();
  if (!result.id) {
    throw buildInstagramError('No creation ID returned from Instagram for carousel', {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
    });
  }

  return result.id;
}

export async function createCarouselAndPublish(params: {
  credentials: Credentials;
  formattedCaption: string;
  media: ResolvedMedia[];
  hasVideoMedia: boolean;
  logger: Logger;
}): Promise<PublishedMedia> {
  const childIds: string[] = [];
  for (const asset of params.media) {
    const childId = await createChildContainer({
      credentials: params.credentials,
      mediaUrl: asset.url,
      isVideo: asset.kind === 'video',
      logger: params.logger,
    });
    childIds.push(childId);
  }

  if (!childIds.length) {
    throw buildInstagramError('No carousel children were created', {
      errorCode: 'IG_MEDIA_CREATE_FAILED',
    });
  }

  const creationId = await createCarouselContainer({
    credentials: params.credentials,
    formattedCaption: params.formattedCaption,
    childIds,
    logger: params.logger,
  });

  if (params.hasVideoMedia) {
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
    hasVideoMedia: params.hasVideoMedia,
    scope: 'carousel',
  });

  const permalink = await fetchPermalink(postId, params.credentials.accessToken);
  params.logger.info('Instagram carousel published successfully', { postId, permalink });

  return {
    postId,
    permalink,
  };
}
