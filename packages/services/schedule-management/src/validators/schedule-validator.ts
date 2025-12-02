/**
 * Schedule Request Validator
 *
 * Input validation for schedule requests
 * Separated for better testability and reusability
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ScheduleRequest {
  contentId: string;
  brandId: string;
  campaignId?: string;
  userId: string;
  platform: string;
  scheduledAt: string;
  // User-facing content type: post/reel/story
  contentType: string;
  // Media format: image/video/carousel/reel
  mediaType?: string;
  caption?: string;
  firstComment?: string;
  hashtags?: string[];
  metadata?: Record<string, unknown>;
  shareToFeed?: boolean;
}

/**
 * Validate a schedule request
 */
export function validateScheduleRequest(request: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Check required fields
  if (!request.contentId || typeof request.contentId !== 'string') {
    errors.push('contentId is required and must be a string');
  }

  if (!request.brandId || typeof request.brandId !== 'string') {
    errors.push('brandId is required and must be a string');
  }

  if (!request.userId || typeof request.userId !== 'string') {
    errors.push('userId is required and must be a string');
  }

  if (!request.platform || typeof request.platform !== 'string') {
    errors.push('platform is required and must be a string');
  }

  if (!request.scheduledAt || typeof request.scheduledAt !== 'string') {
    errors.push('scheduledAt is required and must be a string');
  } else {
    // Validate scheduledAt is a valid ISO date string
    const scheduledDate = new Date(request.scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      errors.push('scheduledAt must be a valid ISO 8601 date string');
    } else {
      // Check that scheduled time is in the future
      if (scheduledDate <= new Date()) {
        errors.push('scheduledAt must be in the future');
      }
    }
  }

  if (!request.contentType || typeof request.contentType !== 'string') {
    errors.push('contentType is required and must be a string');
  }

  if (request.mediaType !== undefined && typeof request.mediaType !== 'string') {
    errors.push('mediaType must be a string if provided');
  }

  // Validate optional fields
  if (request.campaignId !== undefined && typeof request.campaignId !== 'string') {
    errors.push('campaignId must be a string if provided');
  }

  if (request.caption !== undefined && typeof request.caption !== 'string') {
    errors.push('caption must be a string if provided');
  }

  if (request.firstComment !== undefined) {
    if (typeof request.firstComment !== 'string') {
      errors.push('firstComment must be a string if provided');
    } else if (request.firstComment.length > 2200) {
      errors.push('firstComment must be at most 2200 characters');
    }
  }

  if (request.hashtags !== undefined) {
    if (!Array.isArray(request.hashtags)) {
      errors.push('hashtags must be an array if provided');
    } else {
      const invalidHashtags = request.hashtags.filter((tag: unknown) => typeof tag !== 'string');
      if (invalidHashtags.length > 0) {
        errors.push('all hashtags must be strings');
      }
    }
  }

  if (request.metadata !== undefined && typeof request.metadata !== 'object') {
    errors.push('metadata must be an object if provided');
  }

  if (request.shareToFeed !== undefined && typeof request.shareToFeed !== 'boolean') {
    errors.push('shareToFeed must be a boolean if provided');
  }

  // Validate platform values
  const validPlatforms = ['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'];
  if (request.platform && !validPlatforms.includes((request.platform as string).toLowerCase())) {
    errors.push(`platform must be one of: ${validPlatforms.join(', ')}`);
  }

  // Validate content type values (user-facing type)
  const validContentTypes = ['post', 'reel', 'story'];
  if (
    request.contentType &&
    !validContentTypes.includes((request.contentType as string).toLowerCase())
  ) {
    errors.push(`contentType must be one of: ${validContentTypes.join(', ')}`);
  }

  // Validate media type values (media format)
  const validMediaTypes = ['image', 'video', 'carousel', 'reel'];
  if (request.mediaType && !validMediaTypes.includes((request.mediaType as string).toLowerCase())) {
    errors.push(`mediaType must be one of: ${validMediaTypes.join(', ')}`);
  }

  // Strict requirement: for image media, mediaAssets must be non-empty
  const mt = (request.mediaType as string | undefined)?.toLowerCase();
  if (mt === 'image') {
    const mediaAssets = (request as { mediaAssets?: unknown }).mediaAssets;
    const hasMediaAssets = Array.isArray(mediaAssets) && mediaAssets.length > 0;
    const hasInvalidMediaAssets =
      Array.isArray(mediaAssets) &&
      mediaAssets.some(
        (asset) =>
          !asset ||
          typeof asset !== 'object' ||
          typeof (asset as { key?: unknown }).key !== 'string' ||
          !(asset as { key: string }).key
      );

    if (!hasMediaAssets) {
      errors.push('mediaAssets must include at least one item for image content');
    } else if (hasInvalidMediaAssets) {
      errors.push('mediaAssets must contain valid asset objects with non-empty keys');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate campaign request
 */
export function validateCampaignRequest(request: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!request.campaignId || typeof request.campaignId !== 'string') {
    errors.push('campaignId is required and must be a string');
  }

  if (!request.brandId || typeof request.brandId !== 'string') {
    errors.push('brandId is required and must be a string');
  }

  if (!request.status || typeof request.status !== 'string') {
    errors.push('status is required and must be a string');
  } else {
    const validStatuses = ['active', 'paused', 'completed', 'failed'];
    if (!validStatuses.includes((request.status as string).toLowerCase())) {
      errors.push(`status must be one of: ${validStatuses.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate update request (allows partial updates)
 */
export function validateScheduleUpdateRequest(request: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // For updates, fields are optional but must be valid if provided
  if (request.scheduledAt !== undefined) {
    if (typeof request.scheduledAt !== 'string') {
      errors.push('scheduledAt must be a string if provided');
    } else {
      const scheduledDate = new Date(request.scheduledAt);
      if (isNaN(scheduledDate.getTime())) {
        errors.push('scheduledAt must be a valid ISO 8601 date string');
      } else if (scheduledDate <= new Date()) {
        errors.push('scheduledAt must be in the future');
      }
    }
  }

  if (request.caption !== undefined && typeof request.caption !== 'string') {
    errors.push('caption must be a string if provided');
  }

  if (request.firstComment !== undefined) {
    if (typeof request.firstComment !== 'string') {
      errors.push('firstComment must be a string if provided');
    } else if (request.firstComment.length > 2200) {
      errors.push('firstComment must be at most 2200 characters');
    }
  }

  if (request.hashtags !== undefined) {
    if (!Array.isArray(request.hashtags)) {
      errors.push('hashtags must be an array if provided');
    } else {
      const invalidHashtags = request.hashtags.filter((tag: unknown) => typeof tag !== 'string');
      if (invalidHashtags.length > 0) {
        errors.push('all hashtags must be strings');
      }
    }
  }

  if (request.metadata !== undefined && typeof request.metadata !== 'object') {
    errors.push('metadata must be an object if provided');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
