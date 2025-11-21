/**
 * Video Upload Client
 * Handles chunked multipart uploads for large video files
 */

import { CSRFTokenManager } from '@postolio/csrf-client';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks (matches backend)
const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

const csrf = new CSRFTokenManager({
  apiEndpoint: `${API_BASE_URL}/api/csrf-token`,
  storage: 'session',
  bufferMs: 60_000,
  maxRetries: 3,
  retryDelayMs: 1_000,
});

export interface VideoUploadUrlResponse {
  uploadId: string;
  key: string;
  presignedUrls: Array<{ partNumber: number; url: string }>;
  partCount: number;
}

export interface VideoUploadCompleteResponse {
  success: boolean;
  cdnUrl: string;
  key: string;
}

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  uploadedParts: number;
  totalParts: number;
  percentage: number;
}

async function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };

  const method = (init.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const token = await csrf.ensureToken();
    if (token) headers['csrf-token'] = token;
  }

  const exec = () =>
    fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    });

  const response = await exec();

  if (response.status === 403) {
    let data: any = null;
    try {
      data = await response.clone().json();
    } catch {
      // ignore parse errors for retry logic
    }
    const code = data?.code;
    if (
      code === 'CSRF_TOKEN_MISSING' ||
      code === 'CSRF_TOKEN_INVALID' ||
      code === 'CSRF_VALIDATION_FAILED'
    ) {
      csrf.clearToken();
      const newToken = await csrf.fetchToken();
      if (newToken) {
        headers['csrf-token'] = newToken;
        return fetch(input, { ...init, headers, credentials: 'include' });
      }
    }
  }

  return response;
}

export class VideoUploadClient {
  /**
   * Initiate multipart upload
   */
  static async initiateUpload(
    file: File,
    brandId: string,
    apiBaseUrl = '/api'
  ): Promise<VideoUploadUrlResponse> {
    const response = await csrfFetch(`${apiBaseUrl}/video/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        brandId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to initiate upload');
    }

    return response.json();
  }

  /**
   * Upload file in chunks using presigned URLs
   */
  static async uploadChunks(
    file: File,
    uploadInfo: VideoUploadUrlResponse,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<Array<{ ETag: string; PartNumber: number }>> {
    const parts: Array<{ ETag: string; PartNumber: number }> = [];
    let uploadedBytes = 0;

    for (const { partNumber, url } of uploadInfo.presignedUrls) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const response = await fetch(url, {
        method: 'PUT',
        body: chunk,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload part ${partNumber}`);
      }

      const etag = response.headers.get('ETag');
      if (!etag) {
        throw new Error(`No ETag returned for part ${partNumber}`);
      }

      parts.push({
        ETag: etag.replace(/"/g, ''), // Remove quotes from ETag
        PartNumber: partNumber,
      });

      uploadedBytes += chunk.size;

      if (onProgress) {
        onProgress({
          uploadedBytes,
          totalBytes: file.size,
          uploadedParts: partNumber,
          totalParts: uploadInfo.partCount,
          percentage: Math.round((uploadedBytes / file.size) * 100),
        });
      }
    }

    return parts;
  }

  /**
   * Complete multipart upload
   */
  static async completeUpload(
    uploadId: string,
    key: string,
    parts: Array<{ ETag: string; PartNumber: number }>,
    apiBaseUrl = '/api'
  ): Promise<VideoUploadCompleteResponse> {
    const response = await csrfFetch(`${apiBaseUrl}/video/upload-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key, parts }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to complete upload');
    }

    return response.json();
  }

  /**
   * Abort multipart upload
   */
  static async abortUpload(uploadId: string, key: string, apiBaseUrl = '/api'): Promise<void> {
    await csrfFetch(`${apiBaseUrl}/video/upload-abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, key }),
    });
  }

  /**
   * Upload video file with progress tracking
   * Complete upload flow: initiate → upload chunks → complete
   */
  static async uploadVideo(
    file: File,
    brandId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<{ cdnUrl: string; key: string }> {
    let uploadInfo: VideoUploadUrlResponse | null = null;

    try {
      // Initiate multipart upload
      uploadInfo = await this.initiateUpload(file, brandId);

      // Upload all chunks
      const parts = await this.uploadChunks(file, uploadInfo, onProgress);

      // Complete the upload
      const result = await this.completeUpload(uploadInfo.uploadId, uploadInfo.key, parts);

      return { cdnUrl: result.cdnUrl, key: result.key };
    } catch (error) {
      // Abort upload on error
      if (uploadInfo) {
        await this.abortUpload(uploadInfo.uploadId, uploadInfo.key).catch(console.error);
      }
      throw error;
    }
  }
}
