// Assets API client
const API_BASE_URL = import.meta.env.VITE_ASSETS_API_URL || 'http://localhost:3002/assets-api/v1';

interface Asset {
  id: string;
  brandId: string;
  fileName: string;
  fileType: 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  s3Key: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  altText?: string;
  description?: string;
  tags: string[];
  folderId?: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedAssets {
  assets: Asset[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface UploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
  message: string;
}

export const assetsApi = {
  // Get presigned upload URL
  async getUploadUrl(data: {
    brandId: string;
    fileName: string;
    contentType: string;
    fileType: 'image' | 'video';
  }): Promise<UploadUrlResponse> {
    const response = await fetch(`${API_BASE_URL}/assets/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }

    return response.json();
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
    title?: string;
    altText?: string;
    tags?: string[];
    folderId?: string;
  }): Promise<{ asset: Asset; message: string }> {
    const response = await fetch(`${API_BASE_URL}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to create asset');
    }

    return response.json();
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
  }): Promise<PaginatedAssets> {
    const queryParams = new URLSearchParams();

    if (params.brandId) queryParams.set('brandId', params.brandId);
    if (params.type) queryParams.set('type', params.type);
    if (params.search) queryParams.set('search', params.search);
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.limit) queryParams.set('limit', params.limit.toString());
    if (params.folderId) queryParams.set('folderId', params.folderId);
    if (params.tags) {
      params.tags.forEach((tag) => queryParams.append('tags', tag));
    }

    const response = await fetch(`${API_BASE_URL}/assets?${queryParams}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch assets');
    }

    return response.json();
  },

  // Get single asset
  async getAsset(id: string): Promise<{ asset: Asset }> {
    const response = await fetch(`${API_BASE_URL}/assets/${id}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to fetch asset');
    }

    return response.json();
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
    }
  ): Promise<{ asset: Asset; message: string }> {
    const response = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to update asset');
    }

    return response.json();
  },

  // Delete asset
  async deleteAsset(id: string): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`${API_BASE_URL}/assets/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error('Failed to delete asset');
    }

    return response.json();
  },
};

export type { Asset, PaginatedAssets, UploadUrlResponse };
