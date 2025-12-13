/**
 * Content Response Builder Service
 * Provides standardized response formatting for content endpoints
 * Centralizes response structure for content endpoints
 */

/**
 * Minimal content fields required for building a response
 */
export interface ContentBase {
  id: string;
  caption: string;
  status: string;
  createdAt: Date;
}

/**
 * Extended content fields with additional metadata
 */
export interface ContentWithMetadata extends ContentBase {
  hashtags?: string[];
  updatedAt?: Date;
  scheduledAt?: Date | null;
  postedAt?: Date | null;
  brandId?: string;
  campaignId?: string | null;
  schedulingError?: string | null;
  generationParams?: unknown;
  contentType?: string | null;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  firstCommentStatus?: string | null;
  firstCommentPostedAt?: Date | null;
  firstCommentError?: string | null;
  mediaAssets?: Array<{
    assetId: string;
    displayOrder: number;
  }>;
}

/**
 * Standard content response format
 */
export interface ContentResponse {
  id: string;
  caption: string;
  hashtags?: string[];
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  scheduledAt?: Date | null;
  postedAt?: Date | null;
  brandId?: string;
  campaignId?: string | null;
  schedulingError?: string | null;
  generationParams?: unknown;
  contentType?: string | null;
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  firstCommentStatus?: string | null;
  firstCommentPostedAt?: Date | null;
  firstCommentError?: string | null;
  mediaAssets?: Array<{
    assetId: string;
    displayOrder: number;
  }>;
  mediaAssetCount?: number;
  primaryAssetId?: string | null;
}

/**
 * Build a single content response with CDN URL
 *
 * @param content - Content record from database
 * @returns Formatted content response with CDN URL
 *
 * @example
 * const response = buildContentResponse(dbContent)
 * // Returns: { id, caption, hashtags, imageUrl, status, createdAt, ... }
 */
export function buildContentResponse(content: ContentWithMetadata): ContentResponse {
  const response: ContentResponse = {
    id: content.id,
    caption: content.caption,
    status: content.status,
    createdAt: content.createdAt,
  };

  // Add optional fields if present
  if (content.hashtags !== undefined) {
    response.hashtags = content.hashtags;
  }
  if (content.updatedAt !== undefined) {
    response.updatedAt = content.updatedAt;
  }
  if (content.scheduledAt !== undefined) {
    response.scheduledAt = content.scheduledAt;
  }
  if (content.postedAt !== undefined) {
    response.postedAt = content.postedAt;
  }
  if (content.brandId !== undefined) {
    response.brandId = content.brandId;
  }
  if (content.campaignId !== undefined) {
    response.campaignId = content.campaignId;
  }
  if (content.schedulingError !== undefined) {
    response.schedulingError = content.schedulingError;
  }
  if (content.generationParams !== undefined) {
    response.generationParams = content.generationParams;
  }
  if (content.contentType !== undefined) {
    response.contentType = content.contentType;
  }
  if (content.shareToFeed !== undefined) {
    response.shareToFeed = content.shareToFeed;
  }
  if (content.firstComment !== undefined) {
    response.firstComment = content.firstComment;
  }
  if (content.firstCommentStatus !== undefined) {
    response.firstCommentStatus = content.firstCommentStatus;
  }
  if (content.firstCommentPostedAt !== undefined) {
    response.firstCommentPostedAt = content.firstCommentPostedAt;
  }
  if (content.firstCommentError !== undefined) {
    response.firstCommentError = content.firstCommentError;
  }
  if (content.mediaAssets !== undefined) {
    response.mediaAssets = content.mediaAssets;
    response.mediaAssetCount = content.mediaAssets.length;
    response.primaryAssetId = content.mediaAssets[0]?.assetId ?? null;
  }

  return response;
}

/**
 * Build a list of content responses with CDN URLs
 *
 * @param contents - Array of content records from database
 * @returns Array of formatted content responses
 *
 * @example
 * const responses = buildContentListResponse(dbContents)
 * // Returns: [{ id, caption, ... }, { id, caption, ... }]
 */
export function buildContentListResponse(contents: ContentWithMetadata[]): ContentResponse[] {
  return contents.map(buildContentResponse);
}

/**
 * Build a simple content response (minimal fields)
 * Used for endpoints that only need basic content information
 *
 * @param content - Content record with minimal fields
 * @returns Formatted content response with CDN URL
 */
export function buildSimpleContentResponse(content: ContentBase): {
  id: string;
  caption: string;
  status: string;
  createdAt: Date;
} {
  return {
    id: content.id,
    caption: content.caption,
    status: content.status,
    createdAt: content.createdAt,
  };
}

/**
 * Build a list of simple content responses
 *
 * @param contents - Array of content records with minimal fields
 * @returns Array of formatted simple content responses
 */
export function buildSimpleContentListResponse(contents: ContentBase[]): Array<{
  id: string;
  caption: string;
  status: string;
  createdAt: Date;
}> {
  return contents.map(buildSimpleContentResponse);
}
