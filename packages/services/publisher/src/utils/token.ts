import { Logger } from '@aws-lambda-powertools/logger';
import { signRequest, getServiceUrl } from '@postolio/aws';
import type { TokenServiceResponse } from '../types';

const logger = new Logger({ serviceName: 'publisher' });

export async function getTokenFromTokenService(
  brandId: string,
  userId: string,
  platform: string,
  socialAccountId?: string
): Promise<TokenServiceResponse> {
  const normalizedSocialAccountId =
    typeof socialAccountId === 'string' && socialAccountId.trim().length > 0
      ? socialAccountId.trim()
      : undefined;

  logger.info('Fetching token from Token Service', {
    brandId,
    userId,
    platform,
    socialAccountId: normalizedSocialAccountId,
  });

  try {
    const tokenServiceUrl = await getServiceUrl('token-service');

    logger.info('Token Service URL retrieved', {
      url: tokenServiceUrl,
    });

    const url = new URL(tokenServiceUrl);
    const basePathSegments = ['tokens', userId, platform, brandId].map((segment) =>
      encodeURIComponent(segment)
    );

    if (normalizedSocialAccountId) {
      url.pathname = `/${[
        ...basePathSegments,
        'social-accounts',
        encodeURIComponent(normalizedSocialAccountId),
      ].join('/')}`;
    } else {
      url.pathname = `/${basePathSegments.join('/')}`;
    }

    const fetchSigned = async (targetUrl: URL) => {
      const headers = await signRequest({
        method: 'GET',
        url: targetUrl,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return fetch(targetUrl.toString(), {
        method: 'GET',
        headers,
      });
    };

    let response = await fetchSigned(url);

    // Backwards compatibility: if an account-scoped lookup 404s, try legacy (brand-scoped) lookup.
    if (!response.ok && response.status === 404 && normalizedSocialAccountId) {
      const legacyUrl = new URL(tokenServiceUrl);
      legacyUrl.pathname = `/${basePathSegments.join('/')}`;
      logger.warn('Account-scoped token not found; falling back to legacy lookup', {
        brandId,
        userId,
        platform,
        socialAccountId: normalizedSocialAccountId,
      });
      response = await fetchSigned(legacyUrl);
    }

    if (!response.ok) {
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
      const err = new Error(baseMessage) as Error & { meta?: Record<string, unknown> };
      const retryable = response.status === 429 || response.status >= 500;
      let errorCode = 'REQUEST_FAILED';
      if (response.status === 404) {
        errorCode = 'TOKEN_NOT_FOUND';
      } else if (response.status === 401 || response.status === 403) {
        errorCode = 'UNAUTHORIZED';
      } else if (retryable) {
        errorCode = 'SERVICE_UNAVAILABLE';
      }
      err.meta = {
        service: 'token-service',
        httpStatus: response.status,
        errorCode,
        retryable,
      };
      throw err;
    }

    interface RawTokenResponse {
      accessToken: string;
      expiresAt?: string;
      metadata?: { accountId?: string; pageId?: string };
    }
    const tokenData = (await response.json()) as RawTokenResponse;

    if (!tokenData.accessToken) {
      throw new Error('Token Service returned no access token');
    }

    logger.info('Successfully fetched token from Token Service');
    return {
      accessToken: tokenData.accessToken,
      expiresAt: tokenData.expiresAt,
      accountId: tokenData.metadata?.accountId,
      pageId: tokenData.metadata?.pageId,
    };
  } catch (error) {
    logger.error('Failed to get token from Token Service', { error });
    const err = error as Error & { meta?: Record<string, unknown> };
    if (!err.meta) {
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('token not found')) {
        err.meta = {
          errorCode: 'TOKEN_NOT_FOUND',
          httpStatus: 404,
          retryable: false,
          service: 'token-service',
        };
      }
    }
    throw err;
  }
}
