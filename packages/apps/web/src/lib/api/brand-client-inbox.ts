import type {
  GetInboxItemsOptions,
  IngestInboxCommentsOptions,
  IngestInboxDMsOptions,
} from './brand-client-types';

function appendMany(params: URLSearchParams, key: string, values: string[] | undefined): void {
  for (const value of values || []) {
    if (value) {
      params.append(key, value);
    }
  }
}

function queryString(params: URLSearchParams): string {
  const value = params.toString();
  return value ? `?${value}` : '';
}

export function buildInboxItemsQuery(options?: GetInboxItemsOptions): string {
  const params = new URLSearchParams();
  appendMany(params, 'socialAccountId', options?.socialAccountIds);
  appendMany(params, 'channel', options?.channels);
  appendMany(params, 'platform', options?.platforms);
  if (options?.view) {
    params.set('view', options.view);
  }
  if (options?.limit) {
    params.set('limit', String(options.limit));
  }
  return queryString(params);
}

export function buildIngestInboxCommentsQuery(options?: IngestInboxCommentsOptions): string {
  const params = new URLSearchParams();
  appendMany(params, 'socialAccountId', options?.socialAccountIds);
  if (options?.sync) {
    params.set('sync', 'true');
  }
  if (options?.maxPosts) {
    params.set('maxPosts', String(options.maxPosts));
  }
  if (options?.perPostLimit) {
    params.set('perPostLimit', String(options.perPostLimit));
  }
  return queryString(params);
}

export function buildIngestInboxDMsQuery(options?: IngestInboxDMsOptions): string {
  const params = new URLSearchParams();
  appendMany(params, 'socialAccountId', options?.socialAccountIds);
  if (options?.sync) {
    params.set('sync', 'true');
  }
  if (options?.maxThreads) {
    params.set('maxThreads', String(options.maxThreads));
  }
  if (options?.perThreadLimit) {
    params.set('perThreadLimit', String(options.perThreadLimit));
  }
  return queryString(params);
}
