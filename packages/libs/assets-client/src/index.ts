import { setTimeout as sleep } from 'node:timers/promises';

type FetchHeaders = Record<string, string>;

type FetchInit = {
  method?: string;
  headers?: FetchHeaders;
  body?: string;
  signal?: AbortSignal;
};

type FetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers?: {
    get(name: string): string | null;
  };
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type FetchLike = (url: string, init?: FetchInit) => Promise<FetchResponse>;

export interface AssetRecord {
  id: string;
  brandId: string;
  fileName: string;
  fileType: 'image' | 'video';
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  s3Key: string;
  url: string;
  thumbnailKey?: string | null;
  thumbnailSmallKey?: string | null;
  thumbnailLargeKey?: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  title?: string | null;
  altText?: string | null;
  description?: string | null;
}

export interface AssetsClientOptions {
  baseUrl: string;
  serviceToken: string;
  fetchImplementation?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ImportAssetBase {
  brandId: string;
  uploadedBy: string;
  fileName?: string;
  mimeType?: string;
  fileType?: 'image' | 'video';
  title?: string;
  altText?: string;
  tags?: string[];
}

export interface ImportAssetFromUrlParams extends ImportAssetBase {
  sourceUrl: string;
}

export interface ImportAssetFromBufferParams extends ImportAssetBase {
  dataBase64: string;
}

export interface VerifyAssetParams {
  assetId: string;
  brandId: string;
}

export interface VerifyAssetResponse {
  valid: boolean;
  asset: AssetRecord | null;
}

export class AssetsClientError extends Error {
  public readonly status?: number;
  public readonly responseBody?: string;

  constructor(message: string, status?: number, responseBody?: string) {
    super(message);
    this.name = 'AssetsClientError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class AssetsServiceClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: AssetsClientOptions) {
    if (!options.baseUrl) {
      throw new Error('AssetsServiceClient requires a baseUrl');
    }
    if (!options.serviceToken) {
      throw new Error('AssetsServiceClient requires a serviceToken');
    }

    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.serviceToken = options.serviceToken;
    this.fetchImpl = options.fetchImplementation || (globalThis.fetch as FetchLike);
    if (!this.fetchImpl) {
      throw new Error(
        'No fetch implementation available. Provide fetchImplementation when instantiating.'
      );
    }
    this.timeoutMs = options.timeoutMs ?? 10000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  async importFromUrl(params: ImportAssetFromUrlParams): Promise<AssetRecord> {
    const payload = {
      brandId: params.brandId,
      uploadedBy: params.uploadedBy,
      sourceUrl: params.sourceUrl,
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileType: params.fileType,
      title: params.title,
      altText: params.altText,
      tags: params.tags,
    };

    const response = await this.post<{ asset: AssetRecord }>('/assets/import', payload);
    return response.asset;
  }

  async importFromBase64(params: ImportAssetFromBufferParams): Promise<AssetRecord> {
    const payload = {
      brandId: params.brandId,
      uploadedBy: params.uploadedBy,
      dataBase64: params.dataBase64,
      fileName: params.fileName,
      mimeType: params.mimeType,
      fileType: params.fileType,
      title: params.title,
      altText: params.altText,
      tags: params.tags,
    };

    const response = await this.post<{ asset: AssetRecord }>('/assets/import', payload);
    return response.asset;
  }

  async verifyOwnership(params: VerifyAssetParams): Promise<VerifyAssetResponse> {
    const query = new URLSearchParams({ brandId: params.brandId });
    return this.get<VerifyAssetResponse>(`/assets/${params.assetId}/ownership?${query}`);
  }

  async getAsset(assetId: string): Promise<AssetRecord> {
    const result = await this.get<{ asset: AssetRecord }>(`/assets/${assetId}`);
    return result.asset;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async request<T>(path: string, init: FetchInit): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: FetchHeaders = {
      'x-postolio-service-token': this.serviceToken,
      ...(init.headers || {}),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
      if (typeof (timeoutHandle as NodeJS.Timeout).unref === 'function') {
        (timeoutHandle as NodeJS.Timeout).unref();
      }

      try {
        const response = await this.fetchImpl(url, {
          ...init,
          headers,
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new AssetsClientError(
            `Assets API request failed with status ${response.status}`,
            response.status,
            text
          );
        }

        const rawBody = await response.text();
        if (!rawBody) {
          return {} as T;
        }
        try {
          return JSON.parse(rawBody) as T;
        } catch (parseError) {
          throw new AssetsClientError(
            'Failed to parse Assets API response as JSON',
            response.status,
            rawBody
          );
        }
      } catch (error) {
        lastError = error;
        const shouldRetry =
          attempt < this.maxRetries && this.isRetryable(error instanceof Error ? error : undefined);
        if (!shouldRetry) {
          throw error;
        }
        const backoff = 200 * 2 ** attempt;
        await sleep(backoff);
      } finally {
        clearTimeout(timeoutHandle);
      }
    }

    throw lastError ?? new Error('Unknown assets client error');
  }

  private isRetryable(error?: Error): boolean {
    if (!error) return false;
    if (error instanceof AssetsClientError) {
      if (!error.status) return true;
      return error.status >= 500;
    }

    if ('name' in error && error.name === 'AbortError') {
      return true;
    }

    return false;
  }
}
