import { Logger } from '@aws-lambda-powertools/logger';
import { signRequest, getServiceUrl } from '@postolio/aws';
import type { TokenServiceResponse } from '../types';

const logger = new Logger({ serviceName: 'publisher' });

export async function getTokenFromTokenService(
  brandId: string,
  userId: string,
  platform: string
): Promise<TokenServiceResponse> {
  logger.info('Fetching token from Token Service', {
    brandId,
    userId,
    platform,
  });

  try {
    const tokenServiceUrl = await getServiceUrl('token-service');

    logger.info('Token Service URL retrieved', {
      url: tokenServiceUrl,
    });

    const url = new URL(tokenServiceUrl);
    const pathSegments = ['tokens', userId, platform, brandId].map((segment) =>
      encodeURIComponent(segment)
    );
    url.pathname = `/${pathSegments.join('/')}`;

    const headers = await signRequest({
      method: 'GET',
      url,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

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
      const errorCode =
        response.status === 404
          ? 'TOKEN_NOT_FOUND'
          : response.status === 401 || response.status === 403
            ? 'UNAUTHORIZED'
            : retryable
              ? 'SERVICE_UNAVAILABLE'
              : 'REQUEST_FAILED';
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
