/**
 * Content Response Builder Service
 * Provides standardized response formatting for content endpoints
 * Centralizes CDN URL building and response structure
 */

/**
 * Minimal content fields required for building a response
 */
export interface ContentBase {
  id: string;
  caption: string;
  hashtags: string[];
  primaryAssetCdnUrl: string | null;
  status: string;
  createdAt: Date;
}

/**
 * Extended content fields with additional metadata
 */
export interface ContentWithMetadata extends ContentBase {
  updatedAt?: Date;
  scheduledAt?: Date | null;
  postedAt?: Date | null;
  brandId?: string;
  generationParams?: unknown;
  primaryAssetId?: string | null;
  primaryAssetWidth?: number | null;
  primaryAssetHeight?: number | null;
  mediaType?: string | null;
  contentType?: string | null;
  videoUrl?: string | null;
  shareToFeed?: boolean | null;
}

/**
 * Standard content response format
 */
export interface ContentResponse {
  id: string;
  caption: string;
  hashtags: string[];
  imageUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  scheduledAt?: Date | null;
  postedAt?: Date | null;
  brandId?: string;
  generationParams?: unknown;
  mediaType?: string | null;
  contentType?: string | null;
  videoUrl?: string | null;
  shareToFeed?: boolean | null;
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
    hashtags: content.hashtags,
    imageUrl: content.primaryAssetCdnUrl || null,
    status: content.status,
    createdAt: content.createdAt,
  };

  // Add optional fields if present
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
  if (content.generationParams !== undefined) {
    response.generationParams = content.generationParams;
  }
  if (content.mediaType !== undefined) {
    response.mediaType = content.mediaType;
  }
  if (content.contentType !== undefined) {
    response.contentType = content.contentType;
  }
  if (content.videoUrl !== undefined) {
    response.videoUrl = content.videoUrl;
  }
  if (content.shareToFeed !== undefined) {
    response.shareToFeed = content.shareToFeed;
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
  hashtags: string[];
  imageUrl: string | null;
  status: string;
  createdAt: Date;
} {
  return {
    id: content.id,
    caption: content.caption,
    hashtags: content.hashtags,
    imageUrl: content.primaryAssetCdnUrl || null,
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
  hashtags: string[];
  imageUrl: string | null;
  status: string;
  createdAt: Date;
}> {
  return contents.map(buildSimpleContentResponse);
}
