import { createHttp, createHttpMethods } from '@/lib/http/http';

// Assets API client for the web app; routed through main API
const API_BASE_URL = '/api/assets';

// Reuse the shared HTTP client so CSRF/timezone/auth interceptors run consistently
const http = createHttp();
const { get: httpGet, post: httpPost, del: httpDelete } = createHttpMethods(http);

export interface Asset {
  id: string;
  brandId: string;
  fileName: string;
  fileType: 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
  // New aspect ratio fields
  aspectRatio?: string; // "1:1", "4:5", "9:16", etc.
  aspectRatioDecimal?: number;
  orientationType?: 'portrait' | 'landscape' | 'square';
  s3Key: string;
  url: string;
  thumbnailUrl?: string | null;
  title?: string;
  altText?: string;
  description?: string;
  tags: string[];
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedAssets {
  assets: Asset[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
  message: string;
}

export interface AssetUsageEntry {
  assetId: string;
  usedInPosts: boolean;
  postCount: number;
}

export const assetsApi = {
  // Get presigned upload URL
  async getUploadUrl(data: {
    brandId: string;
    fileName: string;
    contentType: string;
    fileType: 'image' | 'video';
    fileSize: number;
  }): Promise<UploadUrlResponse> {
    return httpPost(`${API_BASE_URL}/upload-url`, data);
  },

  // Upload file to S3
  async uploadToS3(file: File, uploadUrl: string): Promise<void> {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!response.ok) throw new Error('Failed to upload file to S3');
  },

  // Create asset metadata
  async createAsset(data: {
    brandId: string;
    fileName: string;
    s3Key: string;
    fileSize: number;
    mimeType: string;
    fileType: 'image' | 'video';
    width?: number;
    height?: number;
    duration?: number;
    title?: string;
    altText?: string;
    tags?: string[];
    folderId?: string;
  }): Promise<{ asset: Asset; message: string }> {
    return httpPost(`${API_BASE_URL}`, data);
  },

  // List assets
  async listAssets(params: {
    brandId?: string;
    type?: 'image' | 'video';
    tags?: string[];
    search?: string;
    page?: number;
    limit?: number;
    folderId?: string;
    // New filter parameters
    aspectRatio?: string;
    aspectRatios?: string[];
    orientationTypes?: Array<'portrait' | 'landscape' | 'square'>;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    uploadedAfter?: string;
    uploadedBefore?: string;
    usageStatuses?: Array<'used' | 'unused'>;
  }): Promise<PaginatedAssets> {
    const queryParams = new URLSearchParams();
    if (params.brandId) queryParams.set('brandId', params.brandId);
    if (params.type) queryParams.set('type', params.type);
    if (params.search) queryParams.set('search', params.search);
    if (params.page) queryParams.set('page', String(params.page));
    if (params.limit) queryParams.set('limit', String(params.limit));
    if (params.folderId) queryParams.set('folderId', params.folderId);
    if (params.tags) params.tags.forEach((t) => queryParams.append('tags', t));

    // New filter parameters
    if (params.aspectRatio) queryParams.set('aspectRatio', params.aspectRatio);
    if (params.aspectRatios)
      params.aspectRatios.forEach((r) => queryParams.append('aspectRatios', r));
    if (params.orientationTypes)
      params.orientationTypes.forEach((o) => queryParams.append('orientationTypes', o));
    if (params.minWidth) queryParams.set('minWidth', String(params.minWidth));
    if (params.maxWidth) queryParams.set('maxWidth', String(params.maxWidth));
    if (params.minHeight) queryParams.set('minHeight', String(params.minHeight));
    if (params.maxHeight) queryParams.set('maxHeight', String(params.maxHeight));
    if (params.uploadedAfter) queryParams.set('uploadedAfter', params.uploadedAfter);
    if (params.uploadedBefore) queryParams.set('uploadedBefore', params.uploadedBefore);
    if (params.usageStatuses)
      params.usageStatuses.forEach((s) => queryParams.append('usageStatuses', s));

    return httpGet(`${API_BASE_URL}?${queryParams.toString()}`);
  },

  // Get single asset
  async getAsset(id: string): Promise<{ asset: Asset }> {
    return httpGet(`${API_BASE_URL}/${id}`);
  },

  async getBatchAssets(assetIds: string[]): Promise<{ assets: Record<string, Asset | null> }> {
    return httpPost(`${API_BASE_URL}/batch`, { assetIds });
  },

  async getUsage(assetIds: string[], brandId: string): Promise<{ usage: AssetUsageEntry[] }> {
    return httpPost(`${API_BASE_URL}/usage`, { assetIds, brandId });
  },

  // Update asset
  async updateAsset(
    id: string,
    data: {
      title?: string;
      altText?: string;
      description?: string;
      tags?: string[];
      folderId?: string | null;
      fileName?: string;
      mimeType?: string;
      fileType?: 'image' | 'video';
      fileSize?: number;
      s3Key?: string;
      width?: number;
      height?: number;
      duration?: number;
    }
  ): Promise<{ asset: Asset; message: string }> {
    return http(`${API_BASE_URL}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Delete asset (soft delete)
  async deleteAsset(id: string): Promise<{ success: boolean; message: string }> {
    return httpDelete(`${API_BASE_URL}/${id}`);
  },
};

export type { Asset as AssetType };
