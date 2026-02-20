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
  aspectRatio?: string | null;
  aspectRatioDecimal?: number | null;
  orientationType?: string | null;
  collectionId?: string | null;
  labelIds?: string[];
  s3Key: string;
  url: string;
  thumbnailKey?: string | null;
  thumbnailSmallKey?: string | null;
  thumbnailLargeKey?: string | null;
  createdAt: string;
  updatedAt: string;
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
  description?: string;
  labelIds?: string[];
  collectionId?: string;
  publishedAt?: string;
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

export interface ListAssetsParams {
  brandId: string;
  type?: 'image' | 'video';
  search?: string;
  page?: number;
  limit?: number;
  collectionId?: string;
  includeSubcollections?: boolean;
  labelIds?: string[] | string;
  labelMode?: 'any' | 'all';
  aspectRatio?: string;
  aspectRatios?: string[] | string;
  orientationTypes?:
    | Array<'portrait' | 'landscape' | 'square'>
    | 'portrait'
    | 'landscape'
    | 'square';
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  uploadedAfter?: string;
  uploadedBefore?: string;
  usage?: 'used' | 'unused' | 'any';
}

export interface ListAssetsResponse {
  assets: AssetRecord[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface CreateAssetParams {
  brandId: string;
  fileName: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  fileType: 'image' | 'video';
  uploadedBy?: string;
  width?: number;
  height?: number;
  duration?: number;
  title?: string;
  altText?: string;
  description?: string;
  collectionId?: string | null;
  labelIds?: string[];
}

export interface UpdateAssetParams {
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

export interface DeleteAssetResponse {
  success: boolean;
  message: string;
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

export interface ListTaxonomyParams {
  brandId: string;
  type: TaxonomyType;
  format?: 'tree' | 'flat';
  includeArchived?: boolean;
}

export interface ListTaxonomyResponse {
  collections?: CollectionNode[];
  labels?: LabelRecord[];
  unsortedAssetCount?: number;
}

export interface CreateTaxonomyParams {
  brandId: string;
  type: TaxonomyType;
  name: string;
  parentId?: string | null;
  color?: string;
  sortOrder?: number;
  isSystem?: boolean;
  createdBy?: string;
}

export interface UpdateTaxonomyParams {
  brandId?: string;
  name?: string;
  parentId?: string | null;
  sortOrder?: number;
  color?: string;
  createdBy?: string;
}

export interface DeleteTaxonomyParams {
  brandId?: string;
  onNotEmpty?: 'move_to_parent' | 'move_to_unsorted';
  createdBy?: string;
}

export interface MergeLabelsParams {
  brandId: string;
  fromLabelId: string;
  intoLabelId: string;
  createdBy?: string;
}

export type BulkAssetAction =
  | { move_to_collection: { collectionId?: string | null } }
  | { add_labels: { labelIds?: string[]; labelNames?: string[]; createdBy?: string } }
  | { remove_labels: { labelIds: string[] } }
  | { delete: Record<string, never> };

export interface BulkAssetsParams {
  assetIds: string[];
  brandId?: string;
  action: BulkAssetAction;
}

export interface BulkAssetsResponse {
  success: boolean;
}

export interface UploadUrlParams {
  brandId: string;
  fileName: string;
  contentType: string;
  fileType: 'image' | 'video';
  fileSize: number;
}

export interface UploadUrlResponse {
  uploadId: string;
  key: string;
  presignedUrls: { partNumber: number; url: string }[];
  partCount: number;
  message?: string;
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
      description: params.description,
      labelIds: params.labelIds,
      collectionId: params.collectionId,
      publishedAt: params.publishedAt,
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
      description: params.description,
      labelIds: params.labelIds,
      collectionId: params.collectionId,
      publishedAt: params.publishedAt,
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

  async getBatchAssets(assetIds: string[]): Promise<(AssetRecord | null)[]> {
    if (assetIds.length === 0) {
      return [];
    }

    try {
      const result = await this.post<{ assets: (AssetRecord | null)[] }>('/assets/batch', {
        assetIds,
      });
      return result.assets;
    } catch (error) {
      // Fallback: if batch endpoint is unavailable or not implemented in the
      // assets service, degrade gracefully by fetching each asset individually.
      if (error instanceof AssetsClientError && (error.status === 404 || error.status === 501)) {
        const assets = await Promise.all(
          assetIds.map(async (assetId) => {
            try {
              const asset = await this.getAsset(assetId);
              return asset;
            } catch (singleError) {
              // If an individual asset is missing, surface this as a null entry
              // to keep behavior consistent with the batch API contract.
              if (
                singleError instanceof AssetsClientError &&
                (singleError.status === 404 || singleError.status === 410)
              ) {
                return null;
              }
              throw singleError;
            }
          })
        );
        return assets;
      }

      throw error;
    }
  }

  async listAssets(params: ListAssetsParams): Promise<ListAssetsResponse> {
    const query = new URLSearchParams();
    query.set('brandId', params.brandId);
    if (params.type) query.set('type', params.type);
    if (params.search) query.set('search', params.search);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.collectionId) query.set('collectionId', params.collectionId);
    if (params.includeSubcollections) query.set('includeSubcollections', 'true');
    if (params.labelIds) {
      const labelIds = Array.isArray(params.labelIds) ? params.labelIds : [params.labelIds];
      labelIds.forEach((id) => query.append('labelIds', id));
    }
    if (params.labelMode) query.set('labelMode', params.labelMode);
    if (params.aspectRatio) query.set('aspectRatio', params.aspectRatio);
    if (params.aspectRatios) {
      const ratios = Array.isArray(params.aspectRatios)
        ? params.aspectRatios
        : [params.aspectRatios];
      ratios.forEach((r) => query.append('aspectRatios', r));
    }
    if (params.orientationTypes) {
      const orientations = Array.isArray(params.orientationTypes)
        ? params.orientationTypes
        : [params.orientationTypes];
      orientations.forEach((o) => query.append('orientationTypes', o));
    }
    if (params.minWidth) query.set('minWidth', String(params.minWidth));
    if (params.maxWidth) query.set('maxWidth', String(params.maxWidth));
    if (params.minHeight) query.set('minHeight', String(params.minHeight));
    if (params.maxHeight) query.set('maxHeight', String(params.maxHeight));
    if (params.uploadedAfter) query.set('uploadedAfter', params.uploadedAfter);
    if (params.uploadedBefore) query.set('uploadedBefore', params.uploadedBefore);
    if (params.usage) query.set('usage', params.usage);

    return this.get<ListAssetsResponse>(`/assets?${query.toString()}`);
  }

  async createAsset(params: CreateAssetParams): Promise<{ asset: AssetRecord; message: string }> {
    return this.post<{ asset: AssetRecord; message: string }>('/assets', params);
  }

  async updateAsset(
    assetId: string,
    params: UpdateAssetParams
  ): Promise<{ asset: AssetRecord; message: string }> {
    return this.request<{ asset: AssetRecord; message: string }>(`/assets/${assetId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteAsset(assetId: string): Promise<DeleteAssetResponse> {
    return this.request<DeleteAssetResponse>(`/assets/${assetId}`, { method: 'DELETE' });
  }

  async listTaxonomy(params: ListTaxonomyParams): Promise<ListTaxonomyResponse> {
    const query = new URLSearchParams();
    query.set('brandId', params.brandId);
    query.set('type', params.type);
    if (params.format) query.set('format', params.format);
    if (params.includeArchived) query.set('includeArchived', 'true');
    return this.get<ListTaxonomyResponse>(`/taxonomy?${query.toString()}`);
  }

  async createTaxonomy(params: CreateTaxonomyParams): Promise<{ item: TaxonomyItem }> {
    return this.post<{ item: TaxonomyItem }>('/taxonomy', params);
  }

  async updateTaxonomy(id: string, params: UpdateTaxonomyParams): Promise<{ item: TaxonomyItem }> {
    return this.request<{ item: TaxonomyItem }>(`/taxonomy/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async deleteTaxonomy(id: string, params?: DeleteTaxonomyParams): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/taxonomy/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: params ? JSON.stringify(params) : undefined,
    });
  }

  async archiveTaxonomy(id: string, params?: { brandId?: string; createdBy?: string }) {
    return this.post<{ item: TaxonomyItem }>(`/taxonomy/${id}/archive`, params ?? {});
  }

  async unarchiveTaxonomy(id: string, params?: { brandId?: string; createdBy?: string }) {
    return this.post<{ item: TaxonomyItem }>(`/taxonomy/${id}/unarchive`, params ?? {});
  }

  async mergeLabels(params: MergeLabelsParams): Promise<{ success: boolean }> {
    return this.post<{ success: boolean }>('/labels:merge', params);
  }

  async bulkAssets(params: BulkAssetsParams): Promise<BulkAssetsResponse> {
    return this.post<BulkAssetsResponse>('/assets/bulk', params);
  }

  async getUploadUrl(params: UploadUrlParams): Promise<UploadUrlResponse> {
    return this.post<UploadUrlResponse>('/assets/upload-url', params);
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
