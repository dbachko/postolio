import { randomUUID } from 'crypto';
import axios, { type AxiosRequestConfig } from 'axios';
import type { CacheValue, RequestWithMeta } from './content-scheduler-client.schemas.js';
import type { ErrorDetails } from './content-scheduler-client.errors.js';

type ClientLike = any;
const USER_CONTEXT_HEADER_KEYS = [
  'X-User-Context',
  'x-user-context',
  'X-User-Id',
  'x-user-id',
  'User-Id',
  'user-id',
] as const;

function trimString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function firstTrimmedString(values: unknown[]): string | undefined {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function setupInterceptors(client: ClientLike): void {
  setupRequestLoggingInterceptor(client);
  setupResponseLoggingInterceptor(client);
}

function setupRequestLoggingInterceptor(client: ClientLike): void {
  client.client.interceptors.request.use(
    (config: AxiosRequestConfig) => {
      const requestId = applyRequestTracingHeaders(client, config);
      if (client.debug) {
        logRequest(client, config, requestId);
      }
      return config;
    },
    (error: unknown) => Promise.reject(error)
  );
}

export function applyRequestTracingHeaders(client: ClientLike, config: AxiosRequestConfig): string {
  config.headers = config.headers || {};
  const headers = config.headers as Record<string, unknown>;
  const meta = (config as RequestWithMeta).__meta || {
    id: generateRequestId(),
    start: Date.now(),
    attempt: 0,
  };

  headers['X-Request-ID'] = meta.id;
  headers['X-Request-Timestamp'] = new Date().toISOString();
  headers['X-Amzn-Trace-Id'] =
    `Root=1-${Math.floor(Date.now() / 1000).toString(16)}-${meta.id.replace(/-/g, '').substring(0, 24)}`;
  headers['X-Caller-Service'] = 'postolio-backend';
  headers['X-Caller-Version'] = process.env.APP_VERSION || '1.0.0';

  const userContext = resolveUserContext(client, config);
  if (userContext) {
    headers['X-User-Context'] = userContext;
  }
  return meta.id;
}

function logRequest(client: ClientLike, config: AxiosRequestConfig, requestId: string): void {
  const fullUrl = composeFullUrl(config.baseURL || client.config.baseURL, config.url || '');
  const headers = (config.headers || {}) as Record<string, unknown>;
  const hasAuth = !!(headers['Authorization'] || headers['authorization']);
  if (!hasAuth && (config.method || 'get').toUpperCase() !== 'OPTIONS') {
    log(client, 'warn', 'scheduler.auth.no_authorization_header', {
      url: config.url,
      fullUrl,
      headers: Object.keys(config.headers || {}),
    });
  }

  const meta = (config as RequestWithMeta).__meta;
  log(client, 'info', 'scheduler.http.request', {
    id: requestId,
    method: (config.method || 'get').toUpperCase(),
    url: config.url,
    baseURL: config.baseURL || client.config.baseURL,
    fullUrl,
    region: client.region,
    timeout: config.timeout,
    attempt: (meta?.attempt || 0) + 1,
  });
}

function setupResponseLoggingInterceptor(client: ClientLike): void {
  client.client.interceptors.response.use(
    (response: any) => {
      if (client.debug) {
        const meta = (response.config as RequestWithMeta).__meta;
        const duration = meta ? Date.now() - meta.start : undefined;
        log(client, 'info', 'scheduler.http.response', {
          id: meta?.id,
          method: (response.config.method || 'get').toUpperCase(),
          url: response.config.url,
          status: response.status,
          durationMs: duration,
          size: safeSize(response.data),
        });
      }
      return response;
    },
    (error: any) => {
      if (client.debug) {
        logResponseError(client, error);
      }
      return Promise.reject(error);
    }
  );
}

function logResponseError(client: ClientLike, error: any): void {
  const cfg = error.config || {};
  const meta = (cfg as RequestWithMeta).__meta;
  const duration = meta ? Date.now() - meta.start : undefined;
  if (
    error.response?.status === 403 &&
    error.response?.data?.message === 'Missing Authentication Token'
  ) {
    log(client, 'error', 'scheduler.auth.missing_auth_token', {
      url: cfg.url,
      baseURL: cfg.baseURL,
      fullURL: composeFullUrl(cfg.baseURL || client.config.baseURL, cfg.url || ''),
      headers: cfg.headers,
      AWS_REGION: process.env.AWS_REGION,
      isECS: !!process.env.ECS_CONTAINER_METADATA_URI_V4,
      errorData: error.response?.data,
    });
  }
  log(client, 'error', 'scheduler.http.error', {
    id: meta?.id,
    method: (cfg.method || 'get').toUpperCase(),
    url: cfg.url,
    status: error.response?.status,
    durationMs: duration,
    data: error.response?.data,
    message: error.message,
  });
}

export function setupCircuitBreakerEvents(client: ClientLike): void {
  client.circuitBreaker.on('open', () => {
    log(client, 'warn', 'scheduler.circuit.open', {
      baseURL: client.config.baseURL,
      timestamp: new Date().toISOString(),
      stats: client.circuitBreaker.stats,
    });
  });
  client.circuitBreaker.on('halfOpen', () => {
    log(client, 'info', 'scheduler.circuit.half_open', {
      baseURL: client.config.baseURL,
      timestamp: new Date().toISOString(),
      stats: client.circuitBreaker.stats,
    });
  });
  client.circuitBreaker.on('close', () => {
    log(client, 'info', 'scheduler.circuit.close', {
      baseURL: client.config.baseURL,
      timestamp: new Date().toISOString(),
      stats: client.circuitBreaker.stats,
    });
  });
  client.circuitBreaker.on('timeout', () => {
    log(client, 'error', 'scheduler.circuit.timeout', {
      baseURL: client.config.baseURL,
      timeout: client.config.timeout,
      timestamp: new Date().toISOString(),
      stats: client.circuitBreaker.stats,
    });
  });
  client.circuitBreaker.on('failure', (error: Error) => {
    log(client, 'error', 'scheduler.circuit.failure', {
      baseURL: client.config.baseURL,
      error: error.message,
      timestamp: new Date().toISOString(),
      stats: client.circuitBreaker.stats,
    });
  });
  client.circuitBreaker.on('success', () => {
    if (process.env.NODE_ENV === 'dev') {
      log(client, 'debug', 'scheduler.circuit.success', {
        baseURL: client.config.baseURL,
        timestamp: new Date().toISOString(),
        stats: client.circuitBreaker.stats,
      });
    }
  });
}

export function resolveUserContext(
  client: ClientLike,
  config: AxiosRequestConfig
): string | undefined {
  const headers = (config.headers || {}) as Record<string, unknown>;
  const headerUser = firstTrimmedString(
    USER_CONTEXT_HEADER_KEYS.map((headerKey) => headers[headerKey])
  );
  if (headerUser) {
    return headerUser;
  }

  const payload = config.data as Record<string, unknown> | undefined;
  const payloadUser = firstTrimmedString([payload?.userId]);
  if (payloadUser) {
    return payloadUser;
  }

  const params = config.params as { userId?: unknown } | undefined;
  const paramsUser = firstTrimmedString([params?.userId]);
  if (paramsUser) {
    return paramsUser;
  }

  return firstTrimmedString([client.config.userId]);
}

export function generateRequestId(): string {
  const timestamp = Date.now().toString(16).toUpperCase();
  const randomHex = randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase();
  return `${timestamp}${randomHex}`;
}

export function log(
  client: ClientLike,
  level: 'info' | 'warn' | 'error' | 'debug',
  event: string,
  details: ErrorDetails
): void {
  const message = String(event);
  if (level === 'error') {
    client.logger.error(message, details);
  } else if (level === 'warn') {
    client.logger.warn(message, details);
  } else if (level === 'debug') {
    client.logger.debug(message, details);
  } else {
    client.logger.info(message, details);
  }
}

export function summarizeError(err: unknown): Record<string, unknown> {
  if (!err) {
    return { type: 'unknown' };
  }
  if (axios.isAxiosError(err)) {
    return {
      type: 'AxiosError',
      message: err.message,
      code: err.code,
      status: err.response?.status,
      data:
        err.response?.data && safeSize(err.response.data) < 2048 ? err.response.data : undefined,
    };
  }
  if (err instanceof Error) {
    return { type: err.name, message: err.message };
  }
  return { type: typeof err, value: String(err) };
}

export function composeFullUrl(base: string, path: string): string {
  if (!base.endsWith('/') && !path.startsWith('/')) {
    return `${base}/${path}`;
  }
  if (base.endsWith('/') && path.startsWith('/')) {
    return base + path.substring(1);
  }
  return base + path;
}

export function safeSize(data: unknown): number {
  try {
    if (data == null) {
      return 0;
    }
    if (typeof data === 'string') {
      return data.length;
    }
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getCachedResponse(client: ClientLike, key: string): CacheValue | null {
  const cached = client.cache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
    client.cache.delete(key);
    return null;
  }
  return cached.data;
}

export function setCachedResponse(
  client: ClientLike,
  key: string,
  data: CacheValue,
  etag?: string
): void {
  client.cache.set(key, {
    data,
    timestamp: Date.now(),
    ...(etag ? { etag } : {}),
  });

  const maxCacheSize = 100;
  if (client.cache.size < maxCacheSize) {
    return;
  }
  const iterator = client.cache.keys();
  const itemsToDelete = client.cache.size - maxCacheSize + 1;
  for (let i = 0; i < itemsToDelete; i++) {
    const { value: cacheKey, done } = iterator.next();
    if (!done && cacheKey !== undefined) {
      client.cache.delete(cacheKey);
    }
  }
}
