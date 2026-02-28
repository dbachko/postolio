import type { Logger } from '@aws-lambda-powertools/logger';
import type { Credentials } from '../../types';
import {
  buildInstagramError,
  graphBaseUrl,
  isNotReadyMessage,
  parseInstagramErrorResponse,
  sleep,
} from './shared';
import { waitForMediaReady, type WaitForMediaReadyOptions } from './status';

async function tryPublish(
  creationId: string,
  credentials: Credentials
): Promise<{
  ok: boolean;
  status: number;
  postId?: string;
  message?: string;
  title?: string;
}> {
  const publishUrl = `${graphBaseUrl()}/${credentials.accountId}/media_publish`;
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: credentials.accessToken,
  });

  const response = await fetch(`${publishUrl}?${publishParams}`, {
    method: 'POST',
  });

  if (response.ok) {
    const result = await response.json();
    return {
      ok: true,
      status: response.status,
      postId: result.id,
    };
  }

  const errorData = await parseInstagramErrorResponse(response);
  return {
    ok: false,
    status: response.status,
    message: errorData.message,
    title: errorData.title,
  };
}

function throwPublishError(
  scope: 'media' | 'carousel',
  status: number,
  message: string,
  title?: string
): never {
  const label = scope === 'carousel' ? 'carousel' : 'media';
  throw buildInstagramError(`Failed to publish ${label}: ${message}`, {
    errorCode: 'IG_PUBLISH_FAILED',
    httpStatus: status,
    title,
  });
}

export async function publishWithRetry(params: {
  creationId: string;
  credentials: Credentials;
  logger: Logger;
  hasVideoMedia: boolean;
  scope: 'media' | 'carousel';
}): Promise<string> {
  params.logger.info(`Publishing Instagram ${params.scope}`, { creationId: params.creationId });

  let publishResult = await tryPublish(params.creationId, params.credentials);
  if (!publishResult.ok && isNotReadyMessage(publishResult.message)) {
    params.logger.warn(`Instagram ${params.scope} not ready; waiting before retry`, {
      creationId: params.creationId,
      message: publishResult.message,
    });

    if (params.hasVideoMedia) {
      await waitForMediaReady({
        creationId: params.creationId,
        accessToken: params.credentials.accessToken,
        isVideo: true,
        logger: params.logger,
        options: { throwOnTimeout: true },
      });
    } else {
      await sleep(60_000);
    }

    publishResult = await tryPublish(params.creationId, params.credentials);
  }

  if (!publishResult.ok || !publishResult.postId) {
    throwPublishError(
      params.scope,
      publishResult.status,
      publishResult.message || `HTTP ${publishResult.status}`,
      publishResult.title
    );
  }

  return publishResult.postId;
}

export async function fetchPermalink(postId: string, accessToken: string): Promise<string> {
  const permalinkUrl = `${graphBaseUrl()}/${postId}`;
  const permalinkParams = new URLSearchParams({
    fields: 'permalink',
    access_token: accessToken,
  });

  const permalinkResponse = await fetch(`${permalinkUrl}?${permalinkParams}`);
  if (!permalinkResponse.ok) {
    return '';
  }

  const permalinkResult = await permalinkResponse.json();
  return permalinkResult.permalink || '';
}
