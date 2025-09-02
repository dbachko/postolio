/**
 * Token Refresh Service
 * Platform-specific token refresh implementations
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import fetch from 'node-fetch';

const logger = new Logger({ serviceName: 'token-refresh' });
const metrics = new Metrics({ namespace: 'TokenService', serviceName: 'token-refresh' });

export interface RefreshTokenRequest {
  userId: string;
  brandId: string;
  platform: string;
  refreshToken: string;
  metadata?: Record<string, any>;
}

export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  metadata?: Record<string, any>;
}

/**
 * Instagram/Facebook Token Refresh
 * Uses Facebook Graph API to exchange tokens
 */
async function refreshInstagramToken(refreshToken: string, metadata?: any): Promise<RefreshTokenResponse> {
  logger.info('Refreshing Instagram token');
  
  try {
    // Instagram uses Facebook's token refresh endpoint
    const appId = process.env.FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    
    if (!appId || !appSecret) {
      throw new Error('Facebook app credentials not configured');
    }
    
    // Exchange for long-lived token (60 days)
    const url = `https://graph.facebook.com/v18.0/oauth/access_token`;
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: refreshToken,
    });
    
    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
    });
    
    if (!response.ok) {
      const error = await response.text();
      logger.error('Instagram token refresh failed', { error });
      throw new Error(`Instagram token refresh failed: ${error}`);
    }
    
    const data = await response.json() as any;
    
    // Calculate expiry (60 days for long-lived tokens)
    const expiresIn = data.expires_in || 5184000; // Default 60 days in seconds
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    metrics.addMetric('InstagramTokensRefreshed', MetricUnit.Count, 1);
    
    return {
      accessToken: data.access_token,
      refreshToken: data.access_token, // Instagram returns same token that can be refreshed again
      expiresAt,
      metadata: {
        ...metadata,
        tokenType: data.token_type || 'bearer',
        scope: data.scope,
        refreshedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error('Instagram token refresh error', error as Error);
    metrics.addMetric('InstagramTokenRefreshErrors', MetricUnit.Count, 1);
    throw error;
  }
}

/**
 * Facebook Token Refresh
 * Similar to Instagram (same Graph API)
 */
async function refreshFacebookToken(refreshToken: string, metadata?: any): Promise<RefreshTokenResponse> {
  // Facebook uses the same refresh mechanism as Instagram
  return refreshInstagramToken(refreshToken, metadata);
}

/**
 * LinkedIn Token Refresh
 * Uses LinkedIn OAuth 2.0 refresh token flow
 */
async function refreshLinkedInToken(refreshToken: string, metadata?: any): Promise<RefreshTokenResponse> {
  logger.info('Refreshing LinkedIn token');
  
  try {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('LinkedIn app credentials not configured');
    }
    
    const url = 'https://www.linkedin.com/oauth/v2/accessToken';
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    
    if (!response.ok) {
      const error = await response.text();
      logger.error('LinkedIn token refresh failed', { error });
      throw new Error(`LinkedIn token refresh failed: ${error}`);
    }
    
    const data = await response.json() as any;
    
    // LinkedIn tokens expire in 60 days
    const expiresIn = data.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    metrics.addMetric('LinkedInTokensRefreshed', MetricUnit.Count, 1);
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken, // LinkedIn may return new refresh token
      expiresAt,
      metadata: {
        ...metadata,
        tokenType: data.token_type || 'bearer',
        scope: data.scope,
        refreshedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error('LinkedIn token refresh error', error as Error);
    metrics.addMetric('LinkedInTokenRefreshErrors', MetricUnit.Count, 1);
    throw error;
  }
}

/**
 * TikTok Token Refresh
 * Uses TikTok OAuth 2.0 refresh token flow
 */
async function refreshTikTokToken(refreshToken: string, metadata?: any): Promise<RefreshTokenResponse> {
  logger.info('Refreshing TikTok token');
  
  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    
    if (!clientKey || !clientSecret) {
      throw new Error('TikTok app credentials not configured');
    }
    
    const url = 'https://open-api.tiktok.com/oauth/refresh_token/';
    const params = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    
    if (!response.ok) {
      const error = await response.text();
      logger.error('TikTok token refresh failed', { error });
      throw new Error(`TikTok token refresh failed: ${error}`);
    }
    
    const result = await response.json() as any;
    const data = result.data || {};
    
    // TikTok tokens expire in 24 hours for access token
    const expiresIn = data.expires_in || 86400;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    metrics.addMetric('TikTokTokensRefreshed', MetricUnit.Count, 1);
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // TikTok returns new refresh token
      expiresAt,
      metadata: {
        ...metadata,
        openId: data.open_id,
        scope: data.scope,
        refreshedAt: new Date().toISOString(),
        refreshExpiresIn: data.refresh_expires_in, // Refresh token expiry
      },
    };
  } catch (error) {
    logger.error('TikTok token refresh error', error as Error);
    metrics.addMetric('TikTokTokenRefreshErrors', MetricUnit.Count, 1);
    throw error;
  }
}

/**
 * Twitter/X Token Refresh
 * Uses Twitter OAuth 2.0 refresh token flow
 */
async function refreshTwitterToken(refreshToken: string, metadata?: any): Promise<RefreshTokenResponse> {
  logger.info('Refreshing Twitter token');
  
  try {
    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      throw new Error('Twitter app credentials not configured');
    }
    
    const url = 'https://api.twitter.com/2/oauth2/token';
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    
    if (!response.ok) {
      const error = await response.text();
      logger.error('Twitter token refresh failed', { error });
      throw new Error(`Twitter token refresh failed: ${error}`);
    }
    
    const data = await response.json() as any;
    
    // Twitter tokens expire in 2 hours for access token
    const expiresIn = data.expires_in || 7200;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    metrics.addMetric('TwitterTokensRefreshed', MetricUnit.Count, 1);
    
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt,
      metadata: {
        ...metadata,
        tokenType: data.token_type || 'bearer',
        scope: data.scope,
        refreshedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    logger.error('Twitter token refresh error', error as Error);
    metrics.addMetric('TwitterTokenRefreshErrors', MetricUnit.Count, 1);
    throw error;
  }
}

/**
 * Main refresh token function that routes to platform-specific implementations
 */
export async function refreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponse> {
  logger.info('Processing token refresh', { 
    userId: request.userId, 
    brandId: request.brandId, 
    platform: request.platform 
  });
  
  metrics.addMetric('TokenRefreshRequests', MetricUnit.Count, 1);
  
  try {
    let response: RefreshTokenResponse;
    
    switch (request.platform.toLowerCase()) {
      case 'instagram':
        response = await refreshInstagramToken(request.refreshToken, request.metadata);
        break;
        
      case 'facebook':
        response = await refreshFacebookToken(request.refreshToken, request.metadata);
        break;
        
      case 'linkedin':
        response = await refreshLinkedInToken(request.refreshToken, request.metadata);
        break;
        
      case 'tiktok':
        response = await refreshTikTokToken(request.refreshToken, request.metadata);
        break;
        
      case 'twitter':
      case 'x':
        response = await refreshTwitterToken(request.refreshToken, request.metadata);
        break;
        
      default:
        throw new Error(`Unsupported platform: ${request.platform}`);
    }
    
    // Add common metadata
    response.metadata = {
      ...response.metadata,
      userId: request.userId,
      brandId: request.brandId,
      platform: request.platform,
      lastRefreshed: new Date().toISOString(),
    };
    
    metrics.addMetric('TokenRefreshSuccess', MetricUnit.Count, 1);
    logger.info('Token refresh successful', { 
      userId: request.userId, 
      brandId: request.brandId, 
      platform: request.platform,
      expiresAt: response.expiresAt,
    });
    
    return response;
    
  } catch (error) {
    metrics.addMetric('TokenRefreshErrors', MetricUnit.Count, 1);
    logger.error('Token refresh failed', { 
      userId: request.userId, 
      brandId: request.brandId, 
      platform: request.platform,
      error: error as Error,
    });
    throw error;
  }
}

/**
 * Check if a token needs refresh based on expiry
 */
export function shouldRefreshToken(expiresAt: string, bufferDays: number = 7): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  const bufferTime = bufferDays * 24 * 60 * 60 * 1000;
  const refreshThreshold = Date.now() + bufferTime;
  
  return expiryTime < refreshThreshold;
}

/**
 * Validate refresh token before attempting refresh
 */
export function validateRefreshToken(refreshToken: string | undefined): boolean {
  if (!refreshToken) return false;
  
  // Basic validation - token should be non-empty string
  if (typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    return false;
  }
  
  // Additional platform-specific validation could be added here
  return true;
}