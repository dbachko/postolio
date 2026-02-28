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
  collectionId?: string | null;
  labelIds?: string[];
  s3Key: string;
  url: string;
  thumbnailUrl?: string | null;
  title?: string;
  altText?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type TaxonomyType = 'COLLECTION' | 'LABEL';

export interface TaxonomyItem {
  id: string;
  brandId: string;
  type: TaxonomyType;
  parentId?: string | null;
  sortOrder?: number | null;
  name: string;
  nameNorm?: string | null;
  color?: string | null;
  isSystem?: boolean;
  isHidden?: boolean;
  isArchived?: boolean;
  deletedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionNode extends TaxonomyItem {
  assetCount?: number;
  children: CollectionNode[];
}

export interface LabelRecord extends TaxonomyItem {
  assetCount?: number;
}

export type BulkAssetAction =
  | { move_to_collection: { collectionId?: string | null } }
  | { add_labels: { labelIds?: string[]; labelNames?: string[] } }
  | { remove_labels: { labelIds: string[] } }
  | { delete: Record<string, never> };

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

interface ListAssetsParams {
  brandId?: string;
  type?: 'image' | 'video';
  search?: string;
  page?: number;
  limit?: number;
  collectionId?: string;
  includeSubcollections?: boolean;
  labelIds?: string[];
  labelMode?: 'any' | 'all';
  aspectRatio?: string;
  aspectRatios?: string[];
  orientationTypes?: Array<'portrait' | 'landscape' | 'square'>;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  uploadedAfter?: string;
  uploadedBefore?: string;
  usage?: 'used' | 'unused' | 'any';
}

function appendMultiValue<T extends string>(
  queryParams: URLSearchParams,
  key: string,
  values?: T[]
) {
  values?.forEach((value) => queryParams.append(key, value));
}

function appendNumericValue(queryParams: URLSearchParams, key: string, value?: number) {
  if (value !== undefined) {
    queryParams.set(key, String(value));
  }
}

function buildListAssetsQueryParams(params: ListAssetsParams): URLSearchParams {
  const queryParams = new URLSearchParams();
  if (params.brandId) {
    queryParams.set('brandId', params.brandId);
  }
  if (params.type) {
    queryParams.set('type', params.type);
  }
  if (params.search) {
    queryParams.set('search', params.search);
  }
  appendNumericValue(queryParams, 'page', params.page);
  appendNumericValue(queryParams, 'limit', params.limit);
  if (params.collectionId) {
    queryParams.set('collectionId', params.collectionId);
  }
  if (params.includeSubcollections) {
    queryParams.set('includeSubcollections', 'true');
  }
  appendMultiValue(queryParams, 'labelIds', params.labelIds);
  if (params.labelMode) {
    queryParams.set('labelMode', params.labelMode);
  }
  if (params.aspectRatio) {
    queryParams.set('aspectRatio', params.aspectRatio);
  }
  appendMultiValue(queryParams, 'aspectRatios', params.aspectRatios);
  appendMultiValue(queryParams, 'orientationTypes', params.orientationTypes);
  appendNumericValue(queryParams, 'minWidth', params.minWidth);
  appendNumericValue(queryParams, 'maxWidth', params.maxWidth);
  appendNumericValue(queryParams, 'minHeight', params.minHeight);
  appendNumericValue(queryParams, 'maxHeight', params.maxHeight);
  if (params.uploadedAfter) {
    queryParams.set('uploadedAfter', params.uploadedAfter);
  }
  if (params.uploadedBefore) {
    queryParams.set('uploadedBefore', params.uploadedBefore);
  }
  if (params.usage) {
    queryParams.set('usage', params.usage);
  }
  return queryParams;
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
    if (!response.ok) {
      throw new Error('Failed to upload file to S3');
    }
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
    description?: string;
    collectionId?: string | null;
    labelIds?: string[];
  }): Promise<{ asset: Asset; message: string }> {
    return httpPost(`${API_BASE_URL}`, data);
  },

  // List assets
  async listAssets(params: ListAssetsParams): Promise<PaginatedAssets> {
    const queryParams = buildListAssetsQueryParams(params);
    return httpGet(`${API_BASE_URL}?${queryParams}`);
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

  async listTaxonomy(params: {
    brandId: string;
    type: TaxonomyType;
    format?: 'tree' | 'flat';
    includeArchived?: boolean;
  }): Promise<{
    collections?: CollectionNode[];
    labels?: LabelRecord[];
    unsortedAssetCount?: number;
  }> {
    const queryParams = new URLSearchParams();
    queryParams.set('brandId', params.brandId);
    queryParams.set('type', params.type);
    if (params.format) {
      queryParams.set('format', params.format);
    }
    if (params.includeArchived) {
      queryParams.set('includeArchived', 'true');
    }
    return httpGet(`${API_BASE_URL}/taxonomy?${queryParams.toString()}`);
  },

  async createTaxonomy(data: {
    brandId: string;
    type: TaxonomyType;
    name: string;
    parentId?: string | null;
    color?: string;
    sortOrder?: number;
  }): Promise<{ item: TaxonomyItem }> {
    return httpPost(`${API_BASE_URL}/taxonomy`, data);
  },

  async updateTaxonomy(
    id: string,
    data: {
      brandId: string;
      name?: string;
      parentId?: string | null;
      sortOrder?: number;
      color?: string;
    }
  ): Promise<{ item: TaxonomyItem }> {
    return http(`${API_BASE_URL}/taxonomy/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async deleteTaxonomy(
    id: string,
    data: { brandId: string; onNotEmpty?: 'move_to_parent' | 'move_to_unsorted' }
  ): Promise<{ success: boolean }> {
    return http(`${API_BASE_URL}/taxonomy/${id}`, {
      method: 'DELETE',
      body: JSON.stringify(data),
    });
  },

  async archiveTaxonomy(id: string, data: { brandId: string }): Promise<{ item: TaxonomyItem }> {
    return httpPost(`${API_BASE_URL}/taxonomy/${id}/archive`, data);
  },

  async unarchiveTaxonomy(id: string, data: { brandId: string }): Promise<{ item: TaxonomyItem }> {
    return httpPost(`${API_BASE_URL}/taxonomy/${id}/unarchive`, data);
  },

  async mergeLabels(data: {
    brandId: string;
    fromLabelId: string;
    intoLabelId: string;
  }): Promise<{ success: boolean }> {
    return httpPost(`${API_BASE_URL}/labels:merge`, data);
  },

  async bulkAssets(data: {
    brandId: string;
    assetIds: string[];
    action: BulkAssetAction;
  }): Promise<{ success: boolean }> {
    return httpPost(`${API_BASE_URL}/bulk`, data);
  },

  // Update asset
  async updateAsset(
    id: string,
    data: {
      title?: string;
      altText?: string;
      description?: string;
      collectionId?: string | null;
      labelIds?: string[];
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

  // Delete asset permanently
  async deleteAsset(id: string): Promise<{ success: boolean; message: string }> {
    return httpDelete(`${API_BASE_URL}/${id}`);
  },
};

export type { Asset as AssetType };
