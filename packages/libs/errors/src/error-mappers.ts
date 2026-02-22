/**
 * Platform-Specific Error Mappers
 *
 * This module maps platform-specific API errors to our standardized PlatformErrorCode
 */

import {
  type Platform,
  PlatformErrorCode,
  type PlatformError,
  createPlatformError,
} from './platform-errors.js';

/**
 * Instagram/Facebook Graph API Error Response
 */
interface GraphAPIError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * LinkedIn API Error Response
 */
interface LinkedInError {
  status: number;
  serviceErrorCode?: number;
  message?: string;
  error?: string;
}

/**
 * TikTok API Error Response
 */
interface TikTokError {
  data: {
    error_code: number;
    description: string;
    log_id: string;
  };
}

/**
 * Twitter API v2 Error Response
 */
interface TwitterError {
  errors: Array<{
    message: string;
    code: number;
    title?: string;
  }>;
}

/**
 * Map Instagram Graph API error to PlatformErrorCode
 */
export function mapInstagramError(error: any): PlatformError {
  const graphError = error.response?.data as GraphAPIError;

  if (!graphError?.error) {
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      'instagram',
      error.message || 'Unknown Instagram error',
      error
    );
  }

  const { code, error_subcode } = graphError.error;

  // Invalid or expired token
  if (code === 190) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_INVALID_TOKEN,
      'instagram',
      'Instagram access token is invalid or expired',
      error
    );
  }

  // Permission denied
  if (code === 10 || code === 200) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_PERMISSION_DENIED,
      'instagram',
      'Missing required Instagram permissions',
      error
    );
  }

  // Rate limit
  if (code === 4 || code === 32 || code === 613) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_RATE_LIMIT,
      'instagram',
      'Instagram API rate limit exceeded',
      error
    );
  }

  // Media not ready
  if (code === 9001) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_MEDIA_NOT_READY,
      'instagram',
      'Instagram media container is not ready yet',
      error
    );
  }

  // Duplicate media
  if (error_subcode === 2207051) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_DUPLICATE_MEDIA,
      'instagram',
      'This media has already been posted to Instagram',
      error
    );
  }

  // Caption too long
  if (code === 100 && graphError.error.message.includes('caption')) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_CAPTION_TOO_LONG,
      'instagram',
      'Instagram caption exceeds 2200 character limit',
      error
    );
  }

  // Invalid media type
  if (code === 9003) {
    return createPlatformError(
      PlatformErrorCode.INSTAGRAM_INVALID_MEDIA_TYPE,
      'instagram',
      'Invalid media type for Instagram',
      error
    );
  }

  // Default unknown error
  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    'instagram',
    graphError.error.message || 'Unknown Instagram error',
    error
  );
}

/**
 * Map Facebook Graph API error to PlatformErrorCode
 */
export function mapFacebookError(error: any): PlatformError {
  const graphError = error.response?.data as GraphAPIError;

  if (!graphError?.error) {
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      'facebook',
      error.message || 'Unknown Facebook error',
      error
    );
  }

  const { code, error_subcode } = graphError.error;

  // Invalid or expired token
  if (code === 190) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_INVALID_TOKEN,
      'facebook',
      'Facebook access token is invalid or expired',
      error
    );
  }

  // Permission denied
  if (code === 10 || code === 200) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_PERMISSION_DENIED,
      'facebook',
      'Missing required Facebook permissions',
      error
    );
  }

  // Rate limit
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_RATE_LIMIT,
      'facebook',
      'Facebook API rate limit exceeded',
      error
    );
  }

  // Spam detected
  if (code === 368) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_SPAM_DETECTED,
      'facebook',
      'Facebook detected this post as spam',
      error
    );
  }

  // Duplicate post
  if (code === 506) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_DUPLICATE_POST,
      'facebook',
      'This post has already been published to Facebook',
      error
    );
  }

  // Invalid image format
  if (code === 324) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_INVALID_IMAGE_FORMAT,
      'facebook',
      'Invalid image format for Facebook',
      error
    );
  }

  // Video too large
  if (code === 1363041) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_VIDEO_TOO_LARGE,
      'facebook',
      'Video file size exceeds Facebook limits',
      error
    );
  }

  // Page limit reached
  if (code === 341) {
    return createPlatformError(
      PlatformErrorCode.FACEBOOK_PAGE_LIMIT_REACHED,
      'facebook',
      'Facebook Page limit reached',
      error
    );
  }

  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    'facebook',
    graphError.error.message || 'Unknown Facebook error',
    error
  );
}

/**
 * Map LinkedIn API error to PlatformErrorCode
 */
export function mapLinkedInError(error: any): PlatformError {
  const linkedInError = error.response?.data as LinkedInError;
  const status = error.response?.status || 500;

  if (!linkedInError) {
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      'linkedin',
      error.message || 'Unknown LinkedIn error',
      error
    );
  }

  // Invalid or expired token
  if (status === 401) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_INVALID_TOKEN,
      'linkedin',
      'LinkedIn access token is invalid or expired',
      error
    );
  }

  // Forbidden
  if (status === 403) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_FORBIDDEN,
      'linkedin',
      'Forbidden - check LinkedIn app permissions',
      error
    );
  }

  // Not found
  if (status === 404) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_NOT_FOUND,
      'linkedin',
      'LinkedIn resource not found',
      error
    );
  }

  // Rate limit
  if (status === 429) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_RATE_LIMIT,
      'linkedin',
      'LinkedIn API rate limit exceeded (500 calls/day)',
      error
    );
  }

  // Check for daily quota exceeded
  if (linkedInError.message?.includes('quota') || linkedInError.message?.includes('limit')) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_QUOTA_EXCEEDED,
      'linkedin',
      'LinkedIn daily API quota exceeded',
      error
    );
  }

  // Invalid URN
  if (
    linkedInError.message?.includes('URN') ||
    linkedInError.serviceErrorCode === 100 ||
    linkedInError.serviceErrorCode === 404
  ) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_INVALID_URN,
      'linkedin',
      'Invalid LinkedIn URN format',
      error
    );
  }

  // Media too large
  if (linkedInError.message?.includes('size') || linkedInError.serviceErrorCode === 413) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_MEDIA_TOO_LARGE,
      'linkedin',
      'Media file exceeds LinkedIn size limits',
      error
    );
  }

  // Unsupported media type
  if (linkedInError.message?.includes('format') || linkedInError.serviceErrorCode === 415) {
    return createPlatformError(
      PlatformErrorCode.LINKEDIN_UNSUPPORTED_MEDIA_TYPE,
      'linkedin',
      'Unsupported media type for LinkedIn',
      error
    );
  }

  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    'linkedin',
    linkedInError.message || linkedInError.error || 'Unknown LinkedIn error',
    error
  );
}

/**
 * Map TikTok API error to PlatformErrorCode
 */
export function mapTikTokError(error: any): PlatformError {
  const tiktokError = error.response?.data as TikTokError;

  if (!tiktokError?.data) {
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      'tiktok',
      error.message || 'Unknown TikTok error',
      error
    );
  }

  const { error_code } = tiktokError.data;

  // Invalid or expired token
  if (error_code === 10006 || error_code === 10007) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_INVALID_TOKEN,
      'tiktok',
      'TikTok access token is invalid or expired',
      error
    );
  }

  // Forbidden
  if (error_code === 10002) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_FORBIDDEN,
      'tiktok',
      'Forbidden - check TikTok app permissions',
      error
    );
  }

  // Rate limit
  if (error_code === 10003) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_RATE_LIMIT,
      'tiktok',
      'TikTok API rate limit exceeded',
      error
    );
  }

  // Daily post limit
  if (error_code === 10004) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_DAILY_POST_LIMIT,
      'tiktok',
      'TikTok daily post limit reached (100 posts/day)',
      error
    );
  }

  // Video too large
  if (error_code === 20001) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_VIDEO_TOO_LARGE,
      'tiktok',
      'Video exceeds TikTok size limit (4GB)',
      error
    );
  }

  // Video too long
  if (error_code === 20002) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_VIDEO_TOO_LONG,
      'tiktok',
      'Video exceeds TikTok duration limit (10 minutes)',
      error
    );
  }

  // Invalid video format
  if (error_code === 20003) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_INVALID_VIDEO_FORMAT,
      'tiktok',
      'Invalid video format for TikTok',
      error
    );
  }

  // Upload failed
  if (error_code === 20004) {
    return createPlatformError(
      PlatformErrorCode.TIKTOK_UPLOAD_FAILED,
      'tiktok',
      'TikTok video upload failed',
      error
    );
  }

  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    'tiktok',
    tiktokError.data.description || 'Unknown TikTok error',
    error
  );
}

/**
 * Map Twitter API v2 error to PlatformErrorCode
 */
export function mapTwitterError(error: any): PlatformError {
  const twitterError = error.response?.data as TwitterError;
  const status = error.response?.status || 500;

  if (!twitterError?.errors || twitterError.errors.length === 0) {
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      'x',
      error.message || 'Unknown Twitter error',
      error
    );
  }

  const firstError = twitterError.errors[0];

  // Invalid or expired token
  if (status === 401) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_INVALID_TOKEN,
      'x',
      'Twitter access token is invalid or expired',
      error
    );
  }

  // Forbidden
  if (status === 403) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_FORBIDDEN,
      'x',
      'Forbidden - check Twitter app permissions',
      error
    );
  }

  // Rate limit
  if (status === 429 || firstError.code === 88) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_RATE_LIMIT,
      'x',
      'Twitter API rate limit exceeded',
      error
    );
  }

  // Duplicate content
  if (firstError.code === 187) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_DUPLICATE_CONTENT,
      'x',
      'This tweet has already been posted',
      error
    );
  }

  // Tweet too long
  if (firstError.code === 186) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_TWEET_TOO_LONG,
      'x',
      'Tweet exceeds 280 character limit',
      error
    );
  }

  // Media size limit
  if (firstError.code === 324) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_MEDIA_SIZE_LIMIT,
      'x',
      'Media file exceeds Twitter size limits',
      error
    );
  }

  // GIF limit
  if (firstError.code === 323) {
    return createPlatformError(
      PlatformErrorCode.TWITTER_GIF_LIMIT,
      'x',
      'Only one GIF allowed per tweet',
      error
    );
  }

  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    'x',
    firstError.message || 'Unknown Twitter error',
    error
  );
}

/**
 * Map generic network errors
 */
export function mapNetworkError(error: any, platform: Platform): PlatformError {
  // Timeout errors
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return createPlatformError(
      PlatformErrorCode.TIMEOUT_ERROR,
      platform,
      `Request to ${platform} API timed out`,
      error
    );
  }

  // Network connectivity errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ENETUNREACH') {
    return createPlatformError(
      PlatformErrorCode.NETWORK_ERROR,
      platform,
      `Network error connecting to ${platform} API`,
      error
    );
  }

  // Generic unknown error
  return createPlatformError(
    PlatformErrorCode.UNKNOWN_ERROR,
    platform,
    error.message || `Unknown error from ${platform}`,
    error
  );
}

/**
 * Main error mapper - routes to platform-specific mapper
 */
export function mapPlatformError(error: any, platform: Platform): PlatformError {
  try {
    switch (platform) {
      case 'instagram':
        return mapInstagramError(error);
      case 'facebook':
        return mapFacebookError(error);
      case 'linkedin':
        return mapLinkedInError(error);
      case 'tiktok':
        return mapTikTokError(error);
      case 'x':
        return mapTwitterError(error);
      case 'youtube':
        // TODO: Implement YouTube error mapping
        return mapNetworkError(error, platform);
      default:
        return mapNetworkError(error, platform);
    }
  } catch (mappingError) {
    // Fallback if error mapping itself fails
    return createPlatformError(
      PlatformErrorCode.UNKNOWN_ERROR,
      platform,
      error.message || `Failed to map ${platform} error`,
      error
    );
  }
}
