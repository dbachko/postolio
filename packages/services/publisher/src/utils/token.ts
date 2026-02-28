import { Logger } from '@aws-lambda-powertools/logger';
import { signRequest, getServiceUrl } from '@postolio/aws';
import type { TokenServiceResponse } from '../types';

const logger = new Logger({ serviceName: 'publisher' });

interface RawTokenResponse {
  accessToken: string;
  expiresAt?: string;
  metadata?: { accountId?: string; pageId?: string };
}

function normalizeSocialAccountId(socialAccountId?: string): string | undefined {
  if (typeof socialAccountId !== 'string') {
    return undefined;
  }

  const trimmed = socialAccountId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildBasePathSegments(userId: string, platform: string, brandId: string): string[] {
  return ['tokens', userId, platform, brandId].map((segment) => encodeURIComponent(segment));
}

function buildLookupUrl(
  tokenServiceUrl: string,
  basePathSegments: string[],
  socialAccountId?: string
): URL {
  const url = new URL(tokenServiceUrl);

  if (socialAccountId) {
    url.pathname = `/${[
      ...basePathSegments,
      'social-accounts',
      encodeURIComponent(socialAccountId),
    ].join('/')}`;
    return url;
  }

  url.pathname = `/${basePathSegments.join('/')}`;
  return url;
}

async function fetchSigned(url: URL): Promise<Response> {
  const headers = await signRequest({
    method: 'GET',
    url,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  return fetch(url.toString(), {
    method: 'GET',
    headers,
  });
}

async function fetchWithLegacyFallback(
  tokenServiceUrl: string,
  basePathSegments: string[],
  socialAccountId?: string,
  logContext?: Record<string, unknown>
): Promise<Response> {
  let response = await fetchSigned(
    buildLookupUrl(tokenServiceUrl, basePathSegments, socialAccountId)
  );

  if (!response.ok || response.status !== 404 || !socialAccountId) {
    return response;
  }

  logger.warn('Account-scoped token not found; falling back to legacy lookup', logContext);
  response = await fetchSigned(buildLookupUrl(tokenServiceUrl, basePathSegments));
  return response;
}

async function buildTokenServiceError(
  response: Response
): Promise<Error & { meta?: Record<string, unknown> }> {
  let errorBody: string | undefined;
  try {
    errorBody = await response.text();
  } catch (parseError) {
    logger.warn('Failed to read Token Service error body', { parseError });
  }

  logger.error('Token Service request failed', {
    status: response.status,
    statusText: response.statusText,
    body: errorBody,
  });

  const baseMessage =
    response.status === 404
      ? 'Token not found'
      : `Token Service error: ${response.status} ${response.statusText}`;
  const error = new Error(baseMessage) as Error & { meta?: Record<string, unknown> };

  const retryable = response.status === 429 || response.status >= 500;
  let errorCode = 'REQUEST_FAILED';
  if (response.status === 404) {
    errorCode = 'TOKEN_NOT_FOUND';
  } else if (response.status === 401 || response.status === 403) {
    errorCode = 'UNAUTHORIZED';
  } else if (retryable) {
    errorCode = 'SERVICE_UNAVAILABLE';
  }

  error.meta = {
    service: 'token-service',
    httpStatus: response.status,
    errorCode,
    retryable,
  };

  return error;
}

function toTokenServiceResponse(tokenData: RawTokenResponse): TokenServiceResponse {
  return {
    accessToken: tokenData.accessToken,
    expiresAt: tokenData.expiresAt,
    accountId: tokenData.metadata?.accountId,
    pageId: tokenData.metadata?.pageId,
  };
}

function ensureErrorMetadata(error: Error & { meta?: Record<string, unknown> }): void {
  if (error.meta) {
    return;
  }

  const message = (error.message || '').toLowerCase();
  if (!message.includes('token not found')) {
    return;
  }

  error.meta = {
    errorCode: 'TOKEN_NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    service: 'token-service',
  };
}

export async function getTokenFromTokenService(
  brandId: string,
  userId: string,
  platform: string,
  socialAccountId?: string
): Promise<TokenServiceResponse> {
  const normalizedSocialAccountId = normalizeSocialAccountId(socialAccountId);

  logger.info('Fetching token from Token Service', {
    brandId,
    userId,
    platform,
    socialAccountId: normalizedSocialAccountId,
  });

  try {
    const tokenServiceUrl = await getServiceUrl('token-service');
    logger.info('Token Service URL retrieved', { url: tokenServiceUrl });

    const basePathSegments = buildBasePathSegments(userId, platform, brandId);
    const response = await fetchWithLegacyFallback(
      tokenServiceUrl,
      basePathSegments,
      normalizedSocialAccountId,
      {
        brandId,
        userId,
        platform,
        socialAccountId: normalizedSocialAccountId,
      }
    );

    if (!response.ok) {
      throw await buildTokenServiceError(response);
    }

    const tokenData = (await response.json()) as RawTokenResponse;
    if (!tokenData.accessToken) {
      throw new Error('Token Service returned no access token');
    }

    logger.info('Successfully fetched token from Token Service');
    return toTokenServiceResponse(tokenData);
  } catch (error) {
    logger.error('Failed to get token from Token Service', { error });
    const typedError = error as Error & { meta?: Record<string, unknown> };
    ensureErrorMetadata(typedError);
    throw typedError;
  }
}
