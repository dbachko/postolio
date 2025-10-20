import { CSRFTokenManager } from '@postolio/csrf-client';
import { makeCachedTimezoneGetter } from './timezone';

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

      if (
        response.status === 401 &&
        endpoint !== '/api/auth/me' &&
        endpoint !== '/api/auth/refresh'
      ) {
        const { AuthInterceptor } = await import('../auth-interceptor');
        const retryResult = await AuthInterceptor.handleUnauthorized(() =>
          request(endpoint, options)
        );
        if (retryResult.shouldRetry && retryResult.result) return retryResult.result;
        if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
      }

      if (response.status === 413)
        throw new Error('Image too large. Please optimize your image to be under 10MB.');
      if (errorData) throw new Error(errorData.error || errorData.message || 'Request failed');
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
