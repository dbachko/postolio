/**
 * Video Upload Client
 * Proxies uploads through the API, which delegates to the assets service
 */

import { CSRFTokenManager } from '@postolio/csrf-client';

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '';

const csrf = new CSRFTokenManager({
  apiEndpoint: `${API_BASE_URL}/api/csrf-token`,
  storage: 'session',
  bufferMs: 60_000,
  maxRetries: 3,
  retryDelayMs: 1_000,
});

export interface VideoUploadUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn?: number;
  message?: string;
}

export interface VideoUploadCompleteResponse {
  success: boolean;
  cdnUrl: string;
  key: string;
  assetId?: string;
  message?: string;
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
    if (token) {
      headers['csrf-token'] = token;
    }
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
   * Initiate upload (via assets service)
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
        contentType: file.type || 'video/mp4',
        brandId,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Failed to initiate upload');
    }

    return response.json();
  }

  /**
   * Upload file to presigned URL with progress updates
   */
  static async uploadFile(
    file: File,
    uploadInfo: VideoUploadUrlResponse,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadInfo.uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');

      xhr.upload.onprogress = (event) => {
        if (!onProgress || !event.lengthComputable) {
          return;
        }
        const uploadedBytes = event.loaded;
        const totalBytes = event.total || file.size;
        onProgress({
          uploadedBytes,
          totalBytes,
          uploadedParts: 1,
          totalParts: 1,
          percentage: Math.round((uploadedBytes / totalBytes) * 100),
        });
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) {
            onProgress({
              uploadedBytes: file.size,
              totalBytes: file.size,
              uploadedParts: 1,
              totalParts: 1,
              percentage: 100,
            });
          }
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error while uploading video'));
      xhr.send(file);
    });
  }

  /**
   * Complete upload by creating the asset record
   */
  static async completeUpload(
    params: {
      brandId: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      s3Key: string;
      durationSeconds?: number | null;
    },
    apiBaseUrl = '/api'
  ): Promise<VideoUploadCompleteResponse> {
    const response = await csrfFetch(`${apiBaseUrl}/video/upload-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brandId: params.brandId,
        fileName: params.fileName,
        fileSize: params.fileSize,
        mimeType: params.mimeType || 'video/mp4',
        s3Key: params.s3Key,
        duration: params.durationSeconds ?? undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error || 'Failed to complete upload');
    }

    return response.json();
  }

  /**
   * Abort upload (best-effort; single PUT uploads cannot be cancelled server-side)
   */
  static async abortUpload(_uploadId: string, _key: string, apiBaseUrl = '/api'): Promise<void> {
    await csrfFetch(`${apiBaseUrl}/video/upload-abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  /**
   * Upload video file with progress tracking
   * Complete upload flow: initiate → upload file → complete
   */
  static async uploadVideo(
    file: File,
    brandId: string,
    onProgress?: (progress: UploadProgress) => void,
    options?: { durationSeconds?: number | null }
  ): Promise<{ cdnUrl: string; key: string; assetId?: string }> {
    let uploadInfo: VideoUploadUrlResponse | null = null;

    try {
      uploadInfo = await this.initiateUpload(file, brandId);

      await this.uploadFile(file, uploadInfo, onProgress);

      const result = await this.completeUpload(
        {
          brandId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || 'video/mp4',
          s3Key: uploadInfo.s3Key,
          durationSeconds: options?.durationSeconds,
        },
        '/api'
      );

      return { cdnUrl: result.cdnUrl, key: result.key, assetId: result.assetId };
    } catch (error) {
      if (uploadInfo) {
        await this.abortUpload('', uploadInfo.s3Key).catch(() => undefined);
      }
      throw error;
    }
  }
}
