const VALID_PLATFORMS = ['instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'];
const VALID_CONTENT_TYPES = ['post', 'reel', 'story'];
const VALID_MEDIA_TYPES = ['image', 'video', 'carousel', 'reel'];
const FIRST_COMMENT_MAX_LENGTH = 2200;

export function requireStringField(
  request: Record<string, unknown>,
  fieldName: string,
  errors: string[]
): void {
  if (!request[fieldName] || typeof request[fieldName] !== 'string') {
    errors.push(`${fieldName} is required and must be a string`);
  }
}

export function validateScheduledAt(
  request: Record<string, unknown>,
  errors: string[],
  options: { required: boolean; mustBeFuture: boolean }
): void {
  const value = request.scheduledAt;

  if (value === undefined || value === null) {
    if (options.required) {
      errors.push('scheduledAt is required and must be a string');
    }
    return;
  }

  if (typeof value !== 'string') {
    errors.push(
      options.required
        ? 'scheduledAt is required and must be a string'
        : 'scheduledAt must be a string if provided'
    );
    return;
  }

  const scheduledDate = new Date(value);
  if (isNaN(scheduledDate.getTime())) {
    errors.push('scheduledAt must be a valid ISO 8601 date string');
    return;
  }

  if (options.mustBeFuture && scheduledDate <= new Date()) {
    errors.push('scheduledAt must be in the future');
  }
}

export function validateOptionalString(
  request: Record<string, unknown>,
  fieldName: string,
  errors: string[]
): void {
  if (request[fieldName] !== undefined && typeof request[fieldName] !== 'string') {
    errors.push(`${fieldName} must be a string if provided`);
  }
}

export function validateFirstComment(request: Record<string, unknown>, errors: string[]): void {
  const firstComment = request.firstComment;
  if (firstComment === undefined) {
    return;
  }

  if (typeof firstComment !== 'string') {
    errors.push('firstComment must be a string if provided');
    return;
  }

  if (firstComment.length > FIRST_COMMENT_MAX_LENGTH) {
    errors.push(`firstComment must be at most ${FIRST_COMMENT_MAX_LENGTH} characters`);
  }
}

export function validateHashtags(request: Record<string, unknown>, errors: string[]): void {
  const hashtags = request.hashtags;
  if (hashtags === undefined) {
    return;
  }

  if (!Array.isArray(hashtags)) {
    errors.push('hashtags must be an array if provided');
    return;
  }

  if (hashtags.some((tag) => typeof tag !== 'string')) {
    errors.push('all hashtags must be strings');
  }
}

export function validateMetadata(request: Record<string, unknown>, errors: string[]): void {
  if (request.metadata !== undefined && typeof request.metadata !== 'object') {
    errors.push('metadata must be an object if provided');
  }
}

export function validateShareToFeed(request: Record<string, unknown>, errors: string[]): void {
  if (request.shareToFeed !== undefined && typeof request.shareToFeed !== 'boolean') {
    errors.push('shareToFeed must be a boolean if provided');
  }
}

export function validateThumbOffset(request: Record<string, unknown>, errors: string[]): void {
  const thumbOffset = request.thumbOffset;
  if (thumbOffset === undefined) {
    return;
  }

  if (typeof thumbOffset !== 'number') {
    errors.push('thumbOffset must be a number if provided');
    return;
  }

  if (thumbOffset < 0) {
    errors.push('thumbOffset must be greater than or equal to 0');
  }
}

export function validateEnums(request: Record<string, unknown>, errors: string[]): void {
  validateEnumField(request, 'platform', VALID_PLATFORMS, errors);
  validateEnumField(request, 'contentType', VALID_CONTENT_TYPES, errors);
  validateEnumField(request, 'mediaType', VALID_MEDIA_TYPES, errors);
}

export function validateImageMediaAssets(request: Record<string, unknown>, errors: string[]): void {
  const mediaType = (request.mediaType as string | undefined)?.toLowerCase();
  if (mediaType !== 'image') {
    return;
  }

  const mediaAssets = (request as { mediaAssets?: unknown }).mediaAssets;
  const hasMediaAssets = Array.isArray(mediaAssets) && mediaAssets.length > 0;
  const hasInvalidMediaAssets =
    Array.isArray(mediaAssets) && mediaAssets.some((asset) => !isValidMediaAsset(asset));

  if (!hasMediaAssets) {
    errors.push('mediaAssets must include at least one item for image content');
    return;
  }

  if (hasInvalidMediaAssets) {
    errors.push('mediaAssets must contain valid asset objects with non-empty keys');
  }
}

function validateEnumField(
  request: Record<string, unknown>,
  fieldName: 'platform' | 'contentType' | 'mediaType',
  validValues: string[],
  errors: string[]
): void {
  const value = request[fieldName];
  if (!value) {
    return;
  }

  if (!validValues.includes((value as string).toLowerCase())) {
    errors.push(`${fieldName} must be one of: ${validValues.join(', ')}`);
  }
}

function isValidMediaAsset(asset: unknown): boolean {
  return (
    !!asset &&
    typeof asset === 'object' &&
    typeof (asset as { key?: unknown }).key === 'string' &&
    !!(asset as { key: string }).key
  );
}
