import { CSRFTokenManager } from '@postolio/csrf-client';
import { makeCachedTimezoneGetter } from './timezone';

// Debug flag to trace /api/auth/me 401 -> refresh behavior (enable via Vite env)
const DEBUG_AUTH_ME_REFRESH = Boolean(
  (import.meta as any).env?.VITE_DEBUG_AUTH_ME_REFRESH === 'true'
);

export type HttpRequest = (path: string, init?: RequestInit) => Promise<any>;

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
    const headers: Record<string, string> = { ...(options.headers as any) };

    if (options.body) headers['Content-Type'] = 'application/json';
    headers['X-Timezone'] = getTimezone();

    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = await csrf.ensureToken();
      if (csrfToken) headers['csrf-token'] = csrfToken;
    }

    const exec = () =>
      fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

    const response = await exec();

    if (!response.ok) {
      let errorText = '';
      let errorData: any = null;
      try {
        errorText = await response.text();
        if (errorText) errorData = JSON.parse(errorText);
      } catch {
        // ignore JSON parse errors for error bodies
      }

      if (response.status === 403) {
        const code = errorData?.code;
        if (
          code === 'CSRF_TOKEN_MISSING' ||
          code === 'CSRF_TOKEN_INVALID' ||
          code === 'CSRF_VALIDATION_FAILED'
        ) {
          csrf.clearToken();
          const newToken = await csrf.fetchToken();
          if (newToken) {
            headers['csrf-token'] = newToken;
            const retryResponse = await fetch(url, { ...options, headers, credentials: 'include' });
            if (retryResponse.ok) return retryResponse.json();
          }
        }
      }

      // Guard against infinite 401 -> refresh -> retry loops.
      // If this request is already a post-refresh retry, skip re-invoking the interceptor.
      const isRetry = String(headers['x-skip-auth-retry']) === 'true';

      if (response.status === 401 && endpoint !== '/api/auth/refresh' && !isRetry) {
        const { AuthInterceptor } = await import('../auth-interceptor');
        if (DEBUG_AUTH_ME_REFRESH && endpoint === '/api/auth/me') {
          console.debug('[AuthDebug] /api/auth/me 401 detected, attempting refresh...');
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
          console.debug('[AuthDebug] /api/auth/me refresh result', {
            shouldRetry: retryResult.shouldRetry,
            hasResult: Boolean(retryResult.result),
          });
        }
        if (retryResult.shouldRetry && retryResult.result) return retryResult.result;

        // If refresh failed due to network issues, surface an offline error instead of forcing logout
        if (retryResult.isOffline) {
          const offlineError = new Error('Network unavailable during auth refresh');
          (offlineError as any).code = 'NETWORK_OFFLINE';
          (offlineError as any).status = 0;
          throw offlineError;
        }
        if (DEBUG_AUTH_ME_REFRESH && endpoint === '/api/auth/me') {
          console.debug('[AuthDebug] /api/auth/me refresh failed, redirecting to /login');
        }
        if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
      }

      if (response.status === 413)
        throw new Error('Image too large. Please optimize your image to be under 10MB.');
      if (errorData) {
        const primaryMessage =
          errorData.error ||
          errorData.message ||
          (Array.isArray(errorData.errors) ? errorData.errors[0] : undefined) ||
          'Request failed';
        const err = new Error(primaryMessage);
        // Attach status and data for richer client error handling (e.g., 429 throttling)
        (err as any).status = response.status;
        (err as any).data = errorData;
        throw err;
      }
      if (response.status === 404) throw new Error('Resource not found');
      if (response.status === 500) throw new Error('Server error. Please try again later.');
      if (errorText) throw new Error(errorText);
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response.json();
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
