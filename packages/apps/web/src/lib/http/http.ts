import { CSRFTokenManager } from '@postolio/csrf-client';
import { makeCachedTimezoneGetter } from './timezone';
import { isPublicPath } from './public-paths';

// Debug flag to trace /api/auth/me 401 -> refresh behavior (enable via Vite env)
const DEBUG_AUTH_ME_REFRESH = Boolean(
  (import.meta as any).env?.VITE_DEBUG_AUTH_ME_REFRESH === 'true'
);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_ERROR_CODES = new Set([
  'CSRF_TOKEN_MISSING',
  'CSRF_TOKEN_INVALID',
  'CSRF_VALIDATION_FAILED',
]);

export type HttpRequest = (path: string, init?: RequestInit) => Promise<any>;

type ErrorPayload = { errorText: string; errorData: any };

function getRequestMethod(options: RequestInit): string {
  return (options.method || 'GET').toUpperCase();
}

function createRequestHeaders(
  options: RequestInit,
  getTimezone: () => string
): Record<string, string> {
  const headers: Record<string, string> = { ...(options.headers as any) };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }
  headers['X-Timezone'] = getTimezone();
  return headers;
}

async function addCsrfHeaderIfNeeded(
  csrf: CSRFTokenManager,
  method: string,
  headers: Record<string, string>
): Promise<void> {
  if (!MUTATING_METHODS.has(method)) {
    return;
  }
  const csrfToken = await csrf.ensureToken();
  if (csrfToken) {
    headers['csrf-token'] = csrfToken;
  }
}

async function parseErrorPayload(response: Response): Promise<ErrorPayload> {
  let errorText = '';
  let errorData: any = null;
  try {
    errorText = await response.text();
    if (errorText) {
      errorData = JSON.parse(errorText);
    }
  } catch {
    // Ignore non-JSON error bodies.
  }
  return { errorText, errorData };
}

function isCsrfErrorCode(code: unknown): boolean {
  return typeof code === 'string' && CSRF_ERROR_CODES.has(code);
}

async function retryRequestAfterCsrfFailure(params: {
  response: Response;
  csrf: CSRFTokenManager;
  errorData: any;
  url: string;
  options: RequestInit;
  headers: Record<string, string>;
}): Promise<any | null> {
  const { response, csrf, errorData, url, options, headers } = params;
  if (response.status !== 403 || !isCsrfErrorCode(errorData?.code)) {
    return null;
  }
  csrf.clearToken();
  const newToken = await csrf.fetchToken();
  if (!newToken) {
    return null;
  }

  headers['csrf-token'] = newToken;
  const retryResponse = await fetch(url, { ...options, headers, credentials: 'include' });
  if (retryResponse.ok) {
    return retryResponse.json();
  }
  return null;
}

async function handleUnauthorizedResponse(
  response: Response,
  endpoint: string,
  headers: Record<string, string>,
  options: RequestInit,
  request: HttpRequest
): Promise<any | null> {
  const isRetry = String(headers['x-skip-auth-retry']) === 'true';
  if (response.status !== 401 || endpoint === '/api/auth/refresh' || isRetry) {
    return null;
  }

  const { AuthInterceptor } = await import('../auth-interceptor');
  if (DEBUG_AUTH_ME_REFRESH && endpoint === '/api/auth/me') {
    console.warn('[AuthDebug] /api/auth/me 401 detected, attempting refresh...');
  }

  const retryResult = await AuthInterceptor.handleUnauthorized(() =>
    request(endpoint, {
      ...options,
      headers: {
        ...(options.headers as any),
        'x-skip-auth-retry': 'true',
      },
    })
  );

  if (DEBUG_AUTH_ME_REFRESH && endpoint === '/api/auth/me') {
    console.warn('[AuthDebug] /api/auth/me refresh result', {
      shouldRetry: retryResult.shouldRetry,
      hasResult: Boolean(retryResult.result),
    });
  }

  if (retryResult.shouldRetry && retryResult.result) {
    return retryResult.result;
  }
  if (retryResult.isOffline) {
    const offlineError = new Error('Network unavailable during auth refresh');
    (offlineError as any).code = 'NETWORK_OFFLINE';
    (offlineError as any).status = 0;
    throw offlineError;
  }
  if (DEBUG_AUTH_ME_REFRESH && endpoint === '/api/auth/me') {
    console.warn('[AuthDebug] /api/auth/me refresh failed, redirecting to /login');
  }
  if (!isPublicPath(window.location.pathname)) {
    window.location.href = '/login';
  }
  return null;
}

function throwRequestError(response: Response, payload: ErrorPayload): never {
  const { errorText, errorData } = payload;
  if (response.status === 413) {
    throw new Error('Image too large. Please optimize your image to be under 10MB.');
  }
  if (errorData) {
    const primaryMessage =
      errorData.error ||
      errorData.message ||
      (Array.isArray(errorData.errors) ? errorData.errors[0] : undefined) ||
      'Request failed';
    const err = new Error(primaryMessage);
    (err as any).status = response.status;
    (err as any).data = errorData;
    throw err;
  }
  if (response.status === 404) {
    throw new Error('Resource not found');
  }
  if (response.status === 500) {
    throw new Error('Server error. Please try again later.');
  }
  if (errorText) {
    throw new Error(errorText);
  }
  throw new Error(`Request failed with status ${response.status}`);
}

export function createHttp(): HttpRequest {
  const API_BASE_URL = (import.meta as any).env.VITE_API_BASE_URL || '';
  const csrf = new CSRFTokenManager({
    apiEndpoint: `${API_BASE_URL}/api/csrf-token`,
    storage: 'session',
    bufferMs: 60_000,
    maxRetries: 3,
    retryDelayMs: 1_000,
  });
  const getTimezone = makeCachedTimezoneGetter(30_000);

  const request: HttpRequest = async (
    endpoint: string,
    options: RequestInit = {}
  ): Promise<any> => {
    const url = `${API_BASE_URL}${endpoint}`;
    const method = getRequestMethod(options);
    const headers = createRequestHeaders(options, getTimezone);
    await addCsrfHeaderIfNeeded(csrf, method, headers);

    const response = await fetch(url, { ...options, headers, credentials: 'include' });
    if (response.ok) {
      return response.json();
    }

    const errorPayload = await parseErrorPayload(response);
    const csrfRetryResult = await retryRequestAfterCsrfFailure({
      response,
      csrf,
      errorData: errorPayload.errorData,
      url,
      options,
      headers,
    });
    if (csrfRetryResult !== null) {
      return csrfRetryResult;
    }

    const unauthorizedRetryResult = await handleUnauthorizedResponse(
      response,
      endpoint,
      headers,
      options,
      request
    );
    if (unauthorizedRetryResult !== null) {
      return unauthorizedRetryResult;
    }

    throwRequestError(response, errorPayload);
  };

  return request;
}

export function createHttpMethods(http: HttpRequest) {
  return {
    get: (path: string, options?: RequestInit) => http(path, { ...options, method: 'GET' }),
    post: (path: string, body?: unknown, options?: RequestInit) =>
      http(path, {
        ...options,
        method: 'POST',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    put: (path: string, body?: unknown, options?: RequestInit) =>
      http(path, {
        ...options,
        method: 'PUT',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    del: (path: string, options?: RequestInit) => http(path, { ...options, method: 'DELETE' }),
  };
}
