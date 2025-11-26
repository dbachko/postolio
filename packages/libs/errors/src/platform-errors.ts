/**
 * Platform-Specific Error Codes and Retry Strategies
 *
 * This module defines error codes for each social media platform and their
 * corresponding retry strategies. It helps standardize error handling across
 * different platform APIs.
 */

export type Platform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'tiktok' | 'youtube';

/**
 * Standard platform error codes
 */
export enum PlatformErrorCode {
  // Instagram
  INSTAGRAM_INVALID_TOKEN = 'IG_190',
  INSTAGRAM_PERMISSION_DENIED = 'IG_10',
  INSTAGRAM_RATE_LIMIT = 'IG_4',
  INSTAGRAM_MEDIA_NOT_READY = 'IG_9001',
  INSTAGRAM_DUPLICATE_MEDIA = 'IG_9002',
  INSTAGRAM_INVALID_MEDIA_TYPE = 'IG_9003',
  INSTAGRAM_CAPTION_TOO_LONG = 'IG_100',

  // Facebook
  FACEBOOK_INVALID_TOKEN = 'FB_190',
  FACEBOOK_PERMISSION_DENIED = 'FB_10',
  FACEBOOK_RATE_LIMIT = 'FB_4',
  FACEBOOK_SPAM_DETECTED = 'FB_368',
  FACEBOOK_DUPLICATE_POST = 'FB_506',
  FACEBOOK_INVALID_IMAGE_FORMAT = 'FB_324',
  FACEBOOK_VIDEO_TOO_LARGE = 'FB_1363041',
  FACEBOOK_PAGE_LIMIT_REACHED = 'FB_341',

  // LinkedIn
  LINKEDIN_INVALID_TOKEN = 'LI_401',
  LINKEDIN_FORBIDDEN = 'LI_403',
  LINKEDIN_NOT_FOUND = 'LI_404',
  LINKEDIN_RATE_LIMIT = 'LI_429',
  LINKEDIN_QUOTA_EXCEEDED = 'LI_DAILY_LIMIT',
  LINKEDIN_INVALID_URN = 'LI_INVALID_URN',
  LINKEDIN_MEDIA_TOO_LARGE = 'LI_MEDIA_SIZE',
  LINKEDIN_UNSUPPORTED_MEDIA_TYPE = 'LI_MEDIA_TYPE',

  // TikTok
  TIKTOK_INVALID_TOKEN = 'TT_401',
  TIKTOK_FORBIDDEN = 'TT_403',
  TIKTOK_RATE_LIMIT = 'TT_RATE_LIMIT',
  TIKTOK_DAILY_POST_LIMIT = 'TT_DAILY_LIMIT',
  TIKTOK_VIDEO_TOO_LARGE = 'TT_FILE_SIZE',
  TIKTOK_VIDEO_TOO_LONG = 'TT_DURATION',
  TIKTOK_INVALID_VIDEO_FORMAT = 'TT_FORMAT',
  TIKTOK_UPLOAD_FAILED = 'TT_UPLOAD_ERROR',

  // Twitter/X
  TWITTER_INVALID_TOKEN = 'TW_401',
  TWITTER_FORBIDDEN = 'TW_403',
  TWITTER_RATE_LIMIT = 'TW_429',
  TWITTER_DUPLICATE_CONTENT = 'TW_187',
  TWITTER_TWEET_TOO_LONG = 'TW_186',
  TWITTER_MEDIA_SIZE_LIMIT = 'TW_324',
  TWITTER_GIF_LIMIT = 'TW_323',
  TWITTER_VIDEO_LIMIT = 'TW_325',

  // YouTube
  YOUTUBE_INVALID_TOKEN = 'YT_401',
  YOUTUBE_FORBIDDEN = 'YT_403',
  YOUTUBE_RATE_LIMIT = 'YT_429',
  YOUTUBE_QUOTA_EXCEEDED = 'YT_QUOTA',
  YOUTUBE_VIDEO_TOO_LARGE = 'YT_FILE_SIZE',
  YOUTUBE_UNSUPPORTED_FORMAT = 'YT_FORMAT',
  YOUTUBE_COPYRIGHT_CLAIM = 'YT_COPYRIGHT',

  // Generic Errors
  UNKNOWN_ERROR = 'UNKNOWN',
  NETWORK_ERROR = 'NETWORK',
  TIMEOUT_ERROR = 'TIMEOUT',
  VALIDATION_ERROR = 'VALIDATION',
}

/**
 * Retry strategy configuration
 */
export interface RetryStrategy {
  /**
   * Number of seconds to wait before retrying
   */
  retryAfter: number;

  /**
   * Maximum number of retry attempts
   * 0 = don't retry
   */
  maxRetries: number;

  /**
   * Whether to use exponential backoff
   */
  exponentialBackoff?: boolean;

  /**
   * Human-readable description of the strategy
   */
  description: string;
}

/**
 * Platform-specific retry strategies mapped to error codes
 */
export const PLATFORM_RETRY_STRATEGIES: Record<PlatformErrorCode, RetryStrategy> = {
  // Instagram
  [PlatformErrorCode.INSTAGRAM_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.INSTAGRAM_PERMISSION_DENIED]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Permission denied - check app permissions',
  },
  [PlatformErrorCode.INSTAGRAM_RATE_LIMIT]: {
    retryAfter: 3600, // 1 hour
    maxRetries: 3,
    exponentialBackoff: true,
    description: 'Rate limit exceeded - retry after 1 hour',
  },
  [PlatformErrorCode.INSTAGRAM_MEDIA_NOT_READY]: {
    retryAfter: 60, // 1 minute
    maxRetries: 10,
    description: 'Media processing - retry every minute for 10 minutes',
  },
  [PlatformErrorCode.INSTAGRAM_DUPLICATE_MEDIA]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Duplicate media - do not retry',
  },
  [PlatformErrorCode.INSTAGRAM_INVALID_MEDIA_TYPE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Invalid media type - do not retry',
  },
  [PlatformErrorCode.INSTAGRAM_CAPTION_TOO_LONG]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Caption too long - requires manual fix',
  },

  // Facebook
  [PlatformErrorCode.FACEBOOK_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.FACEBOOK_PERMISSION_DENIED]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Permission denied - check app permissions',
  },
  [PlatformErrorCode.FACEBOOK_RATE_LIMIT]: {
    retryAfter: 3600, // 1 hour
    maxRetries: 3,
    exponentialBackoff: true,
    description: 'Rate limit exceeded - retry after 1 hour',
  },
  [PlatformErrorCode.FACEBOOK_SPAM_DETECTED]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Spam detected - do not retry',
  },
  [PlatformErrorCode.FACEBOOK_DUPLICATE_POST]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Duplicate post - do not retry',
  },
  [PlatformErrorCode.FACEBOOK_INVALID_IMAGE_FORMAT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Invalid image format - requires manual fix',
  },
  [PlatformErrorCode.FACEBOOK_VIDEO_TOO_LARGE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Video too large - requires compression',
  },
  [PlatformErrorCode.FACEBOOK_PAGE_LIMIT_REACHED]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Page limit reached - contact support',
  },

  // LinkedIn
  [PlatformErrorCode.LINKEDIN_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.LINKEDIN_FORBIDDEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Forbidden - check permissions',
  },
  [PlatformErrorCode.LINKEDIN_NOT_FOUND]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Resource not found',
  },
  [PlatformErrorCode.LINKEDIN_RATE_LIMIT]: {
    retryAfter: 86400, // 24 hours
    maxRetries: 1,
    description: 'Rate limit exceeded - retry after 24 hours',
  },
  [PlatformErrorCode.LINKEDIN_QUOTA_EXCEEDED]: {
    retryAfter: 86400, // 24 hours
    maxRetries: 1,
    description: 'Daily quota exceeded (500 calls/day) - retry tomorrow',
  },
  [PlatformErrorCode.LINKEDIN_INVALID_URN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Invalid URN - do not retry',
  },
  [PlatformErrorCode.LINKEDIN_MEDIA_TOO_LARGE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Media too large - requires compression',
  },
  [PlatformErrorCode.LINKEDIN_UNSUPPORTED_MEDIA_TYPE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Unsupported media type - do not retry',
  },

  // TikTok
  [PlatformErrorCode.TIKTOK_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.TIKTOK_FORBIDDEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Forbidden - check permissions',
  },
  [PlatformErrorCode.TIKTOK_RATE_LIMIT]: {
    retryAfter: 3600, // 1 hour
    maxRetries: 2,
    description: 'Rate limit exceeded - retry after 1 hour',
  },
  [PlatformErrorCode.TIKTOK_DAILY_POST_LIMIT]: {
    retryAfter: 86400, // 24 hours
    maxRetries: 1,
    description: 'Daily post limit reached (100/day) - retry tomorrow',
  },
  [PlatformErrorCode.TIKTOK_VIDEO_TOO_LARGE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Video too large (max 4GB) - requires compression',
  },
  [PlatformErrorCode.TIKTOK_VIDEO_TOO_LONG]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Video too long (max 10 min) - requires trimming',
  },
  [PlatformErrorCode.TIKTOK_INVALID_VIDEO_FORMAT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Invalid video format - requires conversion',
  },
  [PlatformErrorCode.TIKTOK_UPLOAD_FAILED]: {
    retryAfter: 300, // 5 minutes
    maxRetries: 3,
    exponentialBackoff: true,
    description: 'Upload failed - retry with backoff',
  },

  // Twitter/X
  [PlatformErrorCode.TWITTER_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.TWITTER_FORBIDDEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Forbidden - check permissions',
  },
  [PlatformErrorCode.TWITTER_RATE_LIMIT]: {
    retryAfter: 900, // 15 minutes
    maxRetries: 3,
    description: 'Rate limit exceeded - retry after 15 min',
  },
  [PlatformErrorCode.TWITTER_DUPLICATE_CONTENT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Duplicate content - do not retry',
  },
  [PlatformErrorCode.TWITTER_TWEET_TOO_LONG]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Tweet too long (max 280 chars) - requires manual fix',
  },
  [PlatformErrorCode.TWITTER_MEDIA_SIZE_LIMIT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Media size limit exceeded - requires compression',
  },
  [PlatformErrorCode.TWITTER_GIF_LIMIT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'GIF limit exceeded (1 per tweet)',
  },
  [PlatformErrorCode.TWITTER_VIDEO_LIMIT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Video limit exceeded (1 per tweet)',
  },

  // YouTube
  [PlatformErrorCode.YOUTUBE_INVALID_TOKEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Token invalid - user must re-authenticate',
  },
  [PlatformErrorCode.YOUTUBE_FORBIDDEN]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Forbidden - check permissions',
  },
  [PlatformErrorCode.YOUTUBE_RATE_LIMIT]: {
    retryAfter: 3600, // 1 hour
    maxRetries: 3,
    description: 'Rate limit exceeded - retry after 1 hour',
  },
  [PlatformErrorCode.YOUTUBE_QUOTA_EXCEEDED]: {
    retryAfter: 86400, // 24 hours
    maxRetries: 1,
    description: 'Daily quota exceeded - retry tomorrow',
  },
  [PlatformErrorCode.YOUTUBE_VIDEO_TOO_LARGE]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Video too large (max 256GB) - requires compression',
  },
  [PlatformErrorCode.YOUTUBE_UNSUPPORTED_FORMAT]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Unsupported format - requires conversion',
  },
  [PlatformErrorCode.YOUTUBE_COPYRIGHT_CLAIM]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Copyright claim - do not retry',
  },

  // Generic
  [PlatformErrorCode.UNKNOWN_ERROR]: {
    retryAfter: 300, // 5 minutes
    maxRetries: 2,
    exponentialBackoff: true,
    description: 'Unknown error - retry with caution',
  },
  [PlatformErrorCode.NETWORK_ERROR]: {
    retryAfter: 60, // 1 minute
    maxRetries: 5,
    exponentialBackoff: true,
    description: 'Network error - retry with exponential backoff',
  },
  [PlatformErrorCode.TIMEOUT_ERROR]: {
    retryAfter: 120, // 2 minutes
    maxRetries: 3,
    exponentialBackoff: true,
    description: 'Timeout error - retry with exponential backoff',
  },
  [PlatformErrorCode.VALIDATION_ERROR]: {
    retryAfter: 0,
    maxRetries: 0,
    description: 'Validation error - do not retry',
  },
};

/**
 * Platform error metadata
 */
export interface PlatformError {
  code: PlatformErrorCode;
  message: string;
  platform: Platform;
  originalError?: any;
  retryStrategy: RetryStrategy;
  retryable: boolean;
}

/**
 * Create a standardized platform error
 */
export function createPlatformError(
  code: PlatformErrorCode,
  platform: Platform,
  message: string,
  originalError?: any
): PlatformError {
  const retryStrategy = PLATFORM_RETRY_STRATEGIES[code];
  const retryable = retryStrategy.maxRetries > 0;

  return {
    code,
    message,
    platform,
    originalError,
    retryStrategy,
    retryable,
  };
}

/**
 * Get retry strategy for an error code
 */
export function getRetryStrategy(errorCode: PlatformErrorCode): RetryStrategy {
  return (
    PLATFORM_RETRY_STRATEGIES[errorCode] ||
    PLATFORM_RETRY_STRATEGIES[PlatformErrorCode.UNKNOWN_ERROR]
  );
}

/**
 * Calculate retry delay with exponential backoff
 */
export function calculateRetryDelay(strategy: RetryStrategy, attemptNumber: number): number {
  if (!strategy.exponentialBackoff) {
    return strategy.retryAfter * 1000; // Convert to milliseconds
  }

  // Exponential backoff: retryAfter * (2 ^ attemptNumber)
  const delay = strategy.retryAfter * Math.pow(2, attemptNumber - 1);
  return Math.min(delay, 3600) * 1000; // Cap at 1 hour, convert to ms
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: PlatformError, currentAttempt: number): boolean {
  if (!error.retryable) {
    return false;
  }

  if (currentAttempt >= error.retryStrategy.maxRetries) {
    return false;
  }

  return true;
}
