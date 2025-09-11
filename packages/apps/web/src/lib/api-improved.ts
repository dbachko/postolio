/**
 * Improved API Client
 * Better error handling, retry logic, and CSRF management
 */

import { CSRFManager } from './csrf-manager';

// Request interceptor type
type RequestInterceptor = (config: RequestConfig) => Promise<RequestConfig> | RequestConfig;
type ResponseInterceptor = (response: Response) => Promise<Response> | Response;

interface RequestConfig extends RequestInit {
  url: string;
  retries?: number;
  retryDelay?: number;
}

interface APIError extends Error {
  status: number;
  code?: string;
  details?: any;
}

export class APIClient {
  private static instance: APIClient;
  private baseURL: string;
  private authToken: string | null = null;
  private csrfManager: CSRFManager;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  
  // Configuration
  private config = {
    maxRetries: 3,
    retryDelay: 1000,
    timeout: 30000,
    retryStatusCodes: [408, 429, 500, 502, 503, 504],
  };

  private constructor() {
    this.baseURL = import.meta.env.VITE_API_BASE_URL || '';
    this.authToken = localStorage.getItem('auth_token');
    this.csrfManager = CSRFManager.getInstance();
    
    // Default interceptors
    this.setupDefaultInterceptors();
  }

  static getInstance(): APIClient {
    if (!APIClient.instance) {
      APIClient.instance = new APIClient();
    }
    return APIClient.instance;
  }

  /**
   * Setup default interceptors
   */
  private setupDefaultInterceptors(): void {
    // Request interceptor: Add auth token
    this.addRequestInterceptor(async (config) => {
      if (this.authToken) {
        config.headers = {
          ...config.headers,
          'Authorization': `Bearer ${this.authToken}`,
        };
      }
      return config;
    });

    // Request interceptor: Add CSRF token for state-changing methods
    this.addRequestInterceptor(async (config) => {
      const method = config.method?.toUpperCase();
      if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
        config.headers = await this.csrfManager.getHeaders(config.headers as Record<string, string>);
      }
      return config;
    });

    // Request interceptor: Add timezone header
    this.addRequestInterceptor((config) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      config.headers = {
        ...config.headers,
        'X-Timezone': timezone,
      };
      return config;
    });
  }

  /**
   * Add request interceptor
   */
  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * Execute request with interceptors and retry logic
   */
  private async executeRequest(config: RequestConfig): Promise<Response> {
    // Apply request interceptors
    let finalConfig = config;
    for (const interceptor of this.requestInterceptors) {
      finalConfig = await interceptor(finalConfig);
    }

    // Set default headers
    finalConfig.headers = {
      'Content-Type': 'application/json',
      ...finalConfig.headers,
    };

    // Add credentials
    finalConfig.credentials = 'include';

    // Execute request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    try {
      const response = await fetch(finalConfig.url, {
        ...finalConfig,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      // Apply response interceptors
      let finalResponse = response;
      for (const interceptor of this.responseInterceptors) {
        finalResponse = await interceptor(finalResponse);
      }
      
      return finalResponse;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw this.createError('Request timeout', 408);
      }
      
      throw error;
    }
  }

  /**
   * Request with automatic retry
   */
  private async requestWithRetry<T>(config: RequestConfig): Promise<T> {
    const maxRetries = config.retries ?? this.config.maxRetries;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.executeRequest(config);
        
        // Handle specific error codes
        if (!response.ok) {
          await this.handleErrorResponse(response, config);
        }
        
        // Parse and return response
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        
        return await response.text() as T;
      } catch (error) {
        lastError = error as Error;
        
        // Check if we should retry
        if (attempt < maxRetries && this.shouldRetry(error)) {
          const delay = this.calculateRetryDelay(attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError || this.createError('Max retries exceeded', 0);
  }

  /**
   * Handle error responses
   */
  private async handleErrorResponse(response: Response, config: RequestConfig): Promise<void> {
    const status = response.status;
    
    // Handle CSRF errors
    if (status === 403) {
      const text = await response.text();
      try {
        const error = JSON.parse(text);
        if (error.code === 'CSRF_TOKEN_MISSING' || error.code === 'CSRF_TOKEN_INVALID' || error.code === 'CSRF_TOKEN_MISMATCH') {
          // Try to refresh CSRF token and retry once
          const refreshed = await this.csrfManager.handleCSRFError();
          if (refreshed) {
            // Retry the request
            const retryResponse = await this.executeRequest(config);
            if (retryResponse.ok) {
              return;
            }
          }
        }
      } catch {
        // Not a JSON error
      }
    }
    
    // Handle authentication errors
    if (status === 401) {
      this.handleAuthError();
    }
    
    // Create appropriate error
    const errorText = await response.text();
    let errorMessage = `Request failed with status ${status}`;
    let errorCode: string | undefined;
    
    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.error || errorData.message || errorMessage;
      errorCode = errorData.code;
    } catch {
      if (errorText) {
        errorMessage = errorText;
      }
    }
    
    throw this.createError(errorMessage, status, errorCode);
  }

  /**
   * Check if request should be retried
   */
  private shouldRetry(error: any): boolean {
    if (error.name === 'NetworkError' || error.name === 'TypeError') {
      return true;
    }
    
    if (error.status && this.config.retryStatusCodes.includes(error.status)) {
      return true;
    }
    
    return false;
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }

  /**
   * Create API error
   */
  private createError(message: string, status: number, code?: string): APIError {
    const error = new Error(message) as APIError;
    error.status = status;
    error.code = code;
    return error;
  }

  /**
   * Handle authentication error
   */
  private handleAuthError(): void {
    this.authToken = null;
    localStorage.removeItem('auth_token');
    
    // Only redirect if not already on auth page
    const currentPath = window.location.pathname;
    if (!currentPath.startsWith('/login') && !currentPath.startsWith('/register')) {
      window.location.href = '/login';
    }
  }

  /**
   * Set authentication token
   */
  setAuthToken(token: string): void {
    this.authToken = token;
    localStorage.setItem('auth_token', token);
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.authToken = null;
    localStorage.removeItem('auth_token');
    this.csrfManager.clearToken();
  }

  // HTTP Methods

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const url = new URL(`${this.baseURL}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }
    
    return this.requestWithRetry<T>({
      url: url.toString(),
      method: 'GET',
    });
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.requestWithRetry<T>({
      url: `${this.baseURL}${endpoint}`,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.requestWithRetry<T>({
      url: `${this.baseURL}${endpoint}`,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async patch<T>(endpoint: string, data?: any): Promise<T> {
    return this.requestWithRetry<T>({
      url: `${this.baseURL}${endpoint}`,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.requestWithRetry<T>({
      url: `${this.baseURL}${endpoint}`,
      method: 'DELETE',
    });
  }
}

// Export singleton instance
export const apiClient = APIClient.getInstance();