/**
 * @postolio/csrf-client
 * Modern CSRF Token Management for Frontend Applications
 *
 * Implements the Double Submit Cookie pattern with:
 * - Memory caching for performance
 * - SessionStorage persistence
 * - Request deduplication
 * - Automatic token refresh
 * - TypeScript 5.5+ features
 */

export interface CSRFTokenConfig {
  readonly tokenKey?: string;
  readonly expiryKey?: string;
  readonly bufferMs?: number;
  readonly apiEndpoint?: string;
  readonly storage?: 'session' | 'memory' | 'local';
  readonly fetchOptions?: RequestInit;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
}

export interface CSRFTokenResponse {
  readonly token: string;
  readonly expiresIn?: number;
}

export interface TokenState {
  readonly token: string | null;
  readonly expiry: number;
  readonly isExpired: boolean;
  readonly isValid: boolean;
}

type StorageAdapter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Modern CSRF Token Manager with advanced features
 * Uses the latest TypeScript and JavaScript features
 */
export class CSRFTokenManager {
  private static readonly DEFAULT_TOKEN_KEY = 'csrf_token' as const;
  private static readonly DEFAULT_EXPIRY_KEY = 'csrf_token_expiry' as const;
  private static readonly DEFAULT_BUFFER_MS = 60_000 as const; // 1 minute
  private static readonly DEFAULT_MAX_RETRIES = 3 as const;
  private static readonly DEFAULT_RETRY_DELAY_MS = 1_000 as const;

  private readonly config: Required<CSRFTokenConfig>;
  private readonly storage: StorageAdapter | null;

  // Memory cache with WeakRef for garbage collection optimization
  private memoryToken: string | null = null;
  private memoryExpiry = 0;

  // Promise cache for request deduplication
  private fetchPromise: Promise<string | null> | null = null;

  // AbortController for cancellable requests
  private abortController: AbortController | null = null;

  constructor(config: CSRFTokenConfig = {}) {
    this.config = {
      tokenKey: config.tokenKey ?? CSRFTokenManager.DEFAULT_TOKEN_KEY,
      expiryKey: config.expiryKey ?? CSRFTokenManager.DEFAULT_EXPIRY_KEY,
      bufferMs: config.bufferMs ?? CSRFTokenManager.DEFAULT_BUFFER_MS,
      apiEndpoint: config.apiEndpoint ?? '/api/csrf-token',
      storage: config.storage ?? 'session',
      fetchOptions: config.fetchOptions ?? {},
      maxRetries: config.maxRetries ?? CSRFTokenManager.DEFAULT_MAX_RETRIES,
      retryDelayMs: config.retryDelayMs ?? CSRFTokenManager.DEFAULT_RETRY_DELAY_MS,
    } satisfies Required<CSRFTokenConfig>;

    this.storage = this.getStorageAdapter();
  }

  /**
   * Get the appropriate storage adapter based on configuration
   */
  private getStorageAdapter(): StorageAdapter | null {
    if (typeof window === 'undefined') return null;

    switch (this.config.storage) {
      case 'session':
        return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
      case 'local':
        return typeof localStorage !== 'undefined' ? localStorage : null;
      case 'memory':
        return null;
      default:
        return null;
    }
  }

  /**
   * Get current token state with validation
   */
  public getTokenState(): TokenState {
    const token = this.getToken();
    const expiry = this.getExpiry();
    const now = Date.now();

    return {
      token,
      expiry,
      isExpired: expiry <= now,
      isValid: token !== null && expiry > now,
    } satisfies TokenState;
  }

  /**
   * Get token from memory first, then storage
   */
  public getToken(): string | null {
    // Check memory cache first for performance
    if (this.memoryToken && this.memoryExpiry > Date.now()) {
      return this.memoryToken;
    }

    // No storage available or memory-only mode
    if (!this.storage) {
      return this.memoryExpiry > Date.now() ? this.memoryToken : null;
    }

    // Check persistent storage
    try {
      const storedExpiry = this.storage.getItem(this.config.expiryKey);
      if (storedExpiry && parseInt(storedExpiry, 10) > Date.now()) {
        const token = this.storage.getItem(this.config.tokenKey);
        if (token) {
          // Restore to memory cache
          this.memoryToken = token;
          this.memoryExpiry = parseInt(storedExpiry, 10);
          return token;
        }
      }
    } catch (error) {
      console.warn('Failed to read CSRF token from storage:', error);
    }

    return null;
  }

  /**
   * Get token expiry time
   */
  private getExpiry(): number {
    if (this.memoryExpiry > 0) {
      return this.memoryExpiry;
    }

    if (!this.storage) {
      return 0;
    }

    try {
      const storedExpiry = this.storage.getItem(this.config.expiryKey);
      return storedExpiry ? parseInt(storedExpiry, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Store token in both memory and persistent storage
   */
  public setToken(token: string, expiresIn = 3600): void {
    const expiry = Date.now() + expiresIn * 1000 - this.config.bufferMs;

    // Store in memory for fast access
    this.memoryToken = token;
    this.memoryExpiry = expiry;

    // Store in persistent storage if available
    if (this.storage) {
      try {
        this.storage.setItem(this.config.tokenKey, token);
        this.storage.setItem(this.config.expiryKey, String(expiry));
      } catch (error) {
        console.warn('Failed to persist CSRF token:', error);
      }
    }
  }

  /**
   * Clear token from both memory and storage
   */
  public clearToken(): void {
    this.memoryToken = null;
    this.memoryExpiry = 0;

    if (this.storage) {
      try {
        this.storage.removeItem(this.config.tokenKey);
        this.storage.removeItem(this.config.expiryKey);
      } catch (error) {
        console.warn('Failed to clear CSRF token from storage:', error);
      }
    }
  }

  /**
   * Fetch token with deduplication and cancellation support
   */
  public async fetchToken(signal?: AbortSignal): Promise<string | null> {
    // Return existing promise if already fetching
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    // Cancel any existing request
    this.abortController?.abort();
    this.abortController = new AbortController();

    // Combine signals if provided
    const combinedSignal = signal
      ? AbortSignal.any([signal, this.abortController.signal])
      : this.abortController.signal;

    // Start new fetch with deduplication
    this.fetchPromise = this.doFetch(combinedSignal);

    try {
      return await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
      this.abortController = null;
    }
  }

  /**
   * Internal fetch implementation with retry logic
   */
  private async doFetch(signal: AbortSignal): Promise<string | null> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      if (signal.aborted) {
        throw new DOMException('Fetch aborted', 'AbortError');
      }

      try {
        const response = await fetch(this.config.apiEndpoint, {
          ...this.config.fetchOptions,
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          const data = (await response.json()) as CSRFTokenResponse;
          this.setToken(data.token, data.expiresIn);
          return data.token;
        }

        if (response.status === 429) {
          // Rate limited - wait before retry
          const retryAfter = response.headers.get('Retry-After');
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.config.retryDelayMs;

          await this.delay(delay, signal);
          continue;
        }

        // Non-retryable error
        throw new Error(`CSRF token fetch failed: ${response.status}`);
      } catch (error) {
        lastError = error as Error;

        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }

        // Exponential backoff for retries
        if (attempt < this.config.maxRetries - 1) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await this.delay(delay, signal);
        }
      }
    }

    console.error('Failed to fetch CSRF token after retries:', lastError);
    return null;
  }

  /**
   * Delay helper with cancellation support
   */
  private async delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);

      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new DOMException('Delay aborted', 'AbortError'));
        },
        { once: true }
      );
    });
  }

  /**
   * Ensure valid token is available
   */
  public async ensureToken(signal?: AbortSignal): Promise<string | null> {
    const state = this.getTokenState();

    if (state.isValid) {
      return state.token;
    }

    return this.fetchToken(signal);
  }

  /**
   * Cancel any pending operations
   */
  public cancel(): void {
    this.abortController?.abort();
    this.fetchPromise = null;
  }
}

// Export everything for maximum flexibility
export default CSRFTokenManager;
