import type { Logger } from '@aws-lambda-powertools/logger';
import { safeParseJson } from '../../utils/media';
import { buildInstagramError, graphBaseUrl, sleep } from './shared';

export interface WaitForMediaReadyOptions {
  throwOnTimeout?: boolean;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

interface MediaStatusResponse {
  code: string;
  status: string;
  errorMessage: string;
  httpStatus: number;
  ok: boolean;
  rawBody: string;
  errorPayload?: {
    error_user_msg?: string;
    error_user_title?: string;
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function normalizeStatusField(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

async function fetchMediaStatus(
  accessToken: string,
  creationId: string
): Promise<MediaStatusResponse> {
  const params = new URLSearchParams({
    fields: 'status,status_code',
    access_token: accessToken,
  });

  const response = await fetch(`${graphBaseUrl()}/${creationId}?${params}`);
  const rawBody = await response.text().catch(() => '');
  const parsedBody = rawBody ? safeParseJson(rawBody) : null;
  const structuredBody =
    parsedBody && typeof parsedBody === 'object' ? (parsedBody as Record<string, unknown>) : null;

  const code = normalizeStatusField(structuredBody?.status_code).toUpperCase();
  const status = normalizeStatusField(structuredBody?.status);
  const errorMessage = normalizeStatusField(structuredBody?.error_message);
  const errorPayload =
    structuredBody && 'error' in structuredBody
      ? (structuredBody.error as MediaStatusResponse['errorPayload'])
      : undefined;

  return {
    code,
    status,
    errorMessage,
    httpStatus: response.status,
    ok: response.ok,
    rawBody,
    errorPayload,
  };
}

function logStatus(
  logger: Logger,
  creationId: string,
  attempt: number,
  statusResponse: MediaStatusResponse
): void {
  if (attempt !== 0 && attempt % 5 !== 0) {
    return;
  }

  logger.info('Instagram media status check', {
    creationId,
    attempt,
    status_code: statusResponse.code || 'UNKNOWN',
    status: statusResponse.status || undefined,
    error_message: statusResponse.errorMessage || undefined,
    httpStatus: statusResponse.httpStatus,
  });
}

function throwForTerminalHttpError(statusResponse: MediaStatusResponse, creationId: string): void {
  if (statusResponse.ok) {
    return;
  }

  const message =
    statusResponse.errorPayload?.error_user_msg ||
    statusResponse.errorPayload?.message ||
    `HTTP ${statusResponse.httpStatus}`;

  if (
    statusResponse.httpStatus < 400 ||
    statusResponse.httpStatus >= 500 ||
    statusResponse.httpStatus === 429
  ) {
    return;
  }

  throw buildInstagramError(
    `Instagram status endpoint returned ${statusResponse.httpStatus}: ${message}`,
    {
      errorCode: 'IG_MEDIA_STATUS_HTTP_ERROR',
      httpStatus: statusResponse.httpStatus,
      creationId,
      error_user_msg: statusResponse.errorPayload?.error_user_msg,
      error_user_title: statusResponse.errorPayload?.error_user_title,
      error_type: statusResponse.errorPayload?.type,
      error_code: statusResponse.errorPayload?.code,
      error_subcode: statusResponse.errorPayload?.error_subcode,
      fbtrace_id: statusResponse.errorPayload?.fbtrace_id,
      raw_body: statusResponse.rawBody || undefined,
    }
  );
}

function parseProcessingErrorCode(reason: string): string | undefined {
  const match = reason.match(/(?:code|error\s+code)\s+(\d{7})/i);
  return match?.[1];
}

function throwForTerminalMediaStatus(
  statusResponse: MediaStatusResponse,
  creationId: string,
  attempt: number,
  logger: Logger
): void {
  if (!['ERROR', 'EXPIRED'].includes(statusResponse.code)) {
    return;
  }

  const reason =
    statusResponse.errorMessage || statusResponse.status || statusResponse.rawBody || 'unknown';
  const processingCode = parseProcessingErrorCode(reason);
  const unsupportedVideoSpec = processingCode
    ? ['2207026', '2207076'].includes(processingCode)
    : false;

  logger.error('Instagram media processing error reported by API', {
    creationId,
    attempt,
    status_code: statusResponse.code || 'UNKNOWN',
    status: statusResponse.status || undefined,
    error_message: statusResponse.errorMessage || undefined,
    processing_error_code: processingCode || undefined,
    raw_body: statusResponse.rawBody || undefined,
  });

  if (unsupportedVideoSpec) {
    throw buildInstagramError(
      `Instagram rejected the video format/spec (code ${processingCode}). Re-encode to MP4 (H.264/AAC) with supported aspect ratio and duration.`,
      {
        errorCode: 'IG_VIDEO_UNSUPPORTED_SPEC',
        igProcessingCode: processingCode,
        httpStatus: statusResponse.httpStatus,
      }
    );
  }

  throw buildInstagramError(`Instagram media processing error: ${reason}`, {
    errorCode: 'IG_MEDIA_PROCESSING_ERROR',
    igStatusCode: statusResponse.code || undefined,
    igStatus: statusResponse.status || undefined,
    igErrorMessage: statusResponse.errorMessage || undefined,
    igProcessingCode: processingCode || undefined,
    httpStatus: statusResponse.httpStatus,
    raw_body: statusResponse.rawBody || undefined,
  });
}

export async function waitForMediaReady(params: {
  creationId: string;
  accessToken: string;
  isVideo: boolean;
  logger: Logger;
  options?: WaitForMediaReadyOptions;
}): Promise<boolean> {
  if (process.env.IG_SKIP_MEDIA_WAIT === 'true' || process.env.NODE_ENV === 'test') {
    return true;
  }

  const maxWaitMs = params.options?.maxWaitMs ?? (params.isVideo ? 900_000 : 300_000);
  const pollIntervalMs = params.options?.pollIntervalMs ?? 60_000;
  const throwOnTimeout = params.options?.throwOnTimeout ?? true;

  const started = Date.now();
  let attempt = 0;
  let lastStatus = '';

  while (Date.now() - started < maxWaitMs) {
    try {
      const statusResponse = await fetchMediaStatus(params.accessToken, params.creationId);
      logStatus(params.logger, params.creationId, attempt, statusResponse);

      if (statusResponse.code) {
        lastStatus = statusResponse.code;
      }

      throwForTerminalHttpError(statusResponse, params.creationId);

      if (!statusResponse.code) {
        params.logger.debug('Instagram media status response had no status code', {
          creationId: params.creationId,
          attempt,
          raw_body: statusResponse.rawBody || undefined,
          httpStatus: statusResponse.httpStatus,
        });
      }

      if (['FINISHED', 'PUBLISHED', 'READY'].includes(statusResponse.code)) {
        return true;
      }

      throwForTerminalMediaStatus(statusResponse, params.creationId, attempt, params.logger);
    } catch (error) {
      if ((error as Error)?.message?.startsWith('Instagram media processing error')) {
        throw error;
      }

      params.logger.warn('Failed to check Instagram media status', {
        creationId: params.creationId,
        attempt,
        error: (error as Error).message,
      });
    }

    attempt += 1;
    await sleep(pollIntervalMs);
  }

  const waitedMs = Date.now() - started;
  params.logger.warn('Timed out waiting for Instagram media readiness', {
    creationId: params.creationId,
    isVideo: params.isVideo,
    waitedMs,
    lastStatus: lastStatus || 'UNKNOWN',
  });

  if (throwOnTimeout) {
    throw buildInstagramError('Media is not ready for publishing after waiting', {
      errorCode: 'IG_MEDIA_READY_TIMEOUT',
      waitedMs,
      lastStatus: lastStatus || 'UNKNOWN',
      isVideo: params.isVideo,
    });
  }

  return false;
}
