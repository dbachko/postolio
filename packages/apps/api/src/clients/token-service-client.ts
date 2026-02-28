/**
 * Token Service Client SDK
 */

import type { StoreTokenParams, TokenData } from '../types/token-service.js';
import { TokenServiceError } from '../errors/token-service-errors.js';
import type { TokenServiceConfig } from './token-service-client/base.js';
import { TokenServiceClientRequestSupport } from './token-service-client/request-support.js';

export class TokenServiceClient extends TokenServiceClientRequestSupport {
  constructor(config?: TokenServiceConfig) {
    super(config);
  }

  async getToken(userId: string, brandId: string, platform: string): Promise<TokenData | null> {
    await this.ensureInitialized();

    const cacheKey = `token:${userId}:${brandId}:${platform}`;
    if (this.config.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logDebug('Cache hit', { cacheKey });
        return cached;
      }
    }

    const pendingKey = `get:${cacheKey}`;
    const pending = this.pendingRequests.get(pendingKey);
    if (pending) {
      this.logDebug('Request deduplication', { pendingKey });
      return pending;
    }

    if (this.config.enableRateLimit) {
      await this.checkRateLimit('getToken');
    }

    const promise = this.fetchToken({ userId, brandId, platform, cacheKey, pathSuffix: '' });
    this.pendingRequests.set(pendingKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(pendingKey);
    }
  }

  async getTokenForSocialAccount(
    userId: string,
    brandId: string,
    platform: string,
    socialAccountId: string
  ): Promise<TokenData | null> {
    await this.ensureInitialized();

    const cacheKey = `token:${userId}:${brandId}:${platform}:social:${socialAccountId}`;
    if (this.config.enableCache) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logDebug('Cache hit', { cacheKey });
        return cached;
      }
    }

    const pendingKey = `get:${cacheKey}`;
    const pending = this.pendingRequests.get(pendingKey);
    if (pending) {
      this.logDebug('Request deduplication', { pendingKey });
      return pending;
    }

    if (this.config.enableRateLimit) {
      await this.checkRateLimit('getTokenForSocialAccount');
    }

    const promise = this.fetchToken({
      userId,
      brandId,
      platform,
      cacheKey,
      pathSuffix: `/social-accounts/${socialAccountId}`,
      auditContext: { socialAccountId },
    });
    this.pendingRequests.set(pendingKey, promise);

    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(pendingKey);
    }
  }

  async storeToken(params: StoreTokenParams): Promise<void> {
    await this.ensureInitialized();
    this.validateStoreTokenParams(params);

    if (this.config.enableRateLimit) {
      await this.checkRateLimit('storeToken');
    }

    const path = `/tokens/${params.userId}/${params.platform}/${params.brandId}`;
    const cacheKey = `token:${params.userId}:${params.brandId}:${params.platform}`;
    await this.storeTokenInternal(path, cacheKey, params, {});
  }

  async storeTokenForSocialAccount(
    params: StoreTokenParams & { socialAccountId: string }
  ): Promise<void> {
    await this.ensureInitialized();
    this.validateStoreTokenParams(params);

    if (this.config.enableRateLimit) {
      await this.checkRateLimit('storeTokenForSocialAccount');
    }

    const path = `/tokens/${params.userId}/${params.platform}/${params.brandId}/social-accounts/${params.socialAccountId}`;
    const cacheKey = `token:${params.userId}:${params.brandId}:${params.platform}:social:${params.socialAccountId}`;
    await this.storeTokenInternal(path, cacheKey, params, {
      socialAccountId: params.socialAccountId,
    });
  }

  async deleteTokenForSocialAccount(
    userId: string,
    brandId: string,
    platform: string,
    socialAccountId: string
  ): Promise<boolean> {
    await this.ensureInitialized();

    if (this.config.enableRateLimit) {
      await this.checkRateLimit('deleteTokenForSocialAccount');
    }

    return this.circuitBreaker!.fire(async () => {
      const path = `/tokens/${userId}/${platform}/${brandId}/social-accounts/${socialAccountId}`;
      const response = await this.makeRequest(path, 'DELETE');

      if (response.status === 404) {
        return false;
      }
      if (!response.ok) {
        const error = await response.text();
        throw new TokenServiceError(
          `Failed to delete token: ${error}`,
          'TOKEN_DELETE_FAILED',
          response.status,
          response.status >= 500
        );
      }

      if (this.config.enableCache) {
        const cacheKey = `token:${userId}:${brandId}:${platform}:social:${socialAccountId}`;
        this.cache.delete(cacheKey);
      }

      if (this.config.enableAuditLog) {
        await this.auditLog('DELETE_TOKEN', { userId, brandId, platform, socialAccountId });
      }

      return true;
    }) as Promise<boolean>;
  }

  private async fetchToken(params: {
    userId: string;
    brandId: string;
    platform: string;
    cacheKey: string;
    pathSuffix: string;
    auditContext?: Record<string, unknown>;
  }): Promise<TokenData | null> {
    return this.circuitBreaker!.fire(async () => {
      const path = `/tokens/${params.userId}/${params.platform}/${params.brandId}${params.pathSuffix}`;
      const response = await this.makeRequest(path, 'GET');

      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        const error = await response.text();
        throw new TokenServiceError(
          `Failed to get token: ${error}`,
          'TOKEN_GET_FAILED',
          response.status,
          response.status >= 500
        );
      }

      const data = (await response.json()) as TokenData;
      if (this.config.enableCache && data) {
        this.setInCache(params.cacheKey, data);
      }

      if (this.config.enableAuditLog) {
        await this.auditLog('GET_TOKEN', {
          userId: params.userId,
          brandId: params.brandId,
          platform: params.platform,
          ...(params.auditContext || {}),
        });
      }

      return data;
    }) as Promise<TokenData | null>;
  }

  private async storeTokenInternal(
    path: string,
    cacheKey: string,
    params: StoreTokenParams,
    auditContext: Record<string, unknown>
  ): Promise<void> {
    await this.circuitBreaker!.fire(async () => {
      const response = await this.makeRequest(path, 'PUT', {
        accessToken: params.accessToken,
        refreshToken: params.refreshToken,
        expiresAt: params.expiresAt,
        metadata: params.metadata,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new TokenServiceError(
          `Failed to store token: ${error}`,
          'TOKEN_STORE_FAILED',
          response.status,
          response.status >= 500
        );
      }

      if (this.config.enableCache) {
        this.cache.delete(cacheKey);
      }

      if (this.config.enableAuditLog) {
        await this.auditLog('STORE_TOKEN', {
          userId: params.userId,
          brandId: params.brandId,
          platform: params.platform,
          ...auditContext,
        });
      }
    });
  }
}

export const tokenServiceClient = new TokenServiceClient();
