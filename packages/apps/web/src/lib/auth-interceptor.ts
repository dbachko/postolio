import { auth as authApi } from './api';

/**
 * AuthInterceptor - Manages automatic token refresh
 *
 * Key features:
 * - Automatically refreshes access tokens every 12 minutes (before 15-min expiry)
 * - Refreshes on page visibility change (when user returns to tab)
 * - Handles refresh failures gracefully
 * - Prevents concurrent refresh requests
 */
export class AuthInterceptor {
  private static refreshPromise: Promise<void> | null = null;
  private static lastRefreshTime = 0;
  private static readonly SHARED_REFRESH_KEY = 'postolio:lastRefreshTime';
  private static readonly SHARED_REFRESH_GRACE_MS = 15_000; // Avoid double rotation when another tab just refreshed
  private static readonly LS_REFRESH_LOCK_KEY = 'postolio:authRefreshLock';
  private static readonly LS_REFRESH_LOCK_TTL_MS = 10_000;
  private static readonly REFRESH_INTERVAL = 12 * 60 * 1000; // 12 minutes
  private static refreshTimer: ReturnType<typeof setInterval> | null = null;
  private static autoRefreshEnabled = false;
  private static listenersAttached = false;

  private static isNetworkError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    return (
      error instanceof TypeError ||
      message.includes('Failed to fetch') ||
      message.includes('NetworkError') ||
      message.includes('ERR_NETWORK_CHANGED')
    );
  }

  /**
   * Start automatic token refresh
   * Call this once when the app initializes
   */
  static startAutoRefresh() {
    this.autoRefreshEnabled = true;
    if (this.refreshTimer) {
      return;
    }
    console.log('[Auth] Starting automatic token refresh (every 12 minutes)');

    if (!this.listenersAttached) {
      document.addEventListener('visibilitychange', () => {
        if (!this.autoRefreshEnabled) {
          return;
        }
        if (document.visibilityState === 'visible') {
          void this.refreshIfNeeded('visibility').catch(() => undefined);
        }
      });

      window.addEventListener('beforeunload', () => {
        this.stopAutoRefresh();
      });

      this.listenersAttached = true;
    }

    // Refresh immediately on start (if user is logged in)
    void this.refreshIfNeeded('startup').catch(() => undefined);

    // Then refresh every 12 minutes
    this.refreshTimer = setInterval(() => {
      if (!this.autoRefreshEnabled) {
        return;
      }
      void this.refreshIfNeeded('interval').catch(() => undefined);
    }, this.REFRESH_INTERVAL);
  }

  /**
   * Stop automatic token refresh
   */
  static stopAutoRefresh() {
    this.autoRefreshEnabled = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Start a refresh cycle with a shared promise to avoid concurrent rotations
   */
  private static startRefresh(reason: string): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Use a shared promise to prevent concurrent refresh calls (which can invalidate tokens)
    this.refreshPromise = this.performRefresh(reason).finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  /**
   * Public entrypoint to force a refresh with shared locking (used outside the HTTP layer)
   */
  static refreshNow(reason = 'manual'): Promise<void> {
    return this.startRefresh(reason);
  }

  /**
   * Read the most recent refresh timestamp shared across tabs (best-effort)
   */
  private static getSharedLastRefreshTime(): number {
    if (typeof localStorage === 'undefined') {
      return 0;
    }
    try {
      const raw = localStorage.getItem(this.SHARED_REFRESH_KEY);
      if (!raw) {
        return 0;
      }
      const parsed = parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Persist the last refresh timestamp for other tabs to observe (best-effort)
   */
  private static setSharedLastRefreshTime(timestamp: number) {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      localStorage.setItem(this.SHARED_REFRESH_KEY, String(timestamp));
    } catch {
      // Swallow storage errors (e.g., privacy mode)
    }
  }

  /**
   * Cross-tab lock to prevent simultaneous refresh calls that would trigger token reuse invalidation.
   */
  private static async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockManager =
      typeof navigator !== 'undefined' && (navigator as any)?.locks
        ? (navigator as any).locks
        : null;
    if (lockManager?.request) {
      return lockManager.request('auth-refresh', async () => fn());
    }
    return this.withLocalStorageLock(fn);
  }

  private static parseLock(raw: string | null): { id: string; expiresAt: number } | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; expiresAt?: unknown };
      if (typeof parsed?.id !== 'string' || typeof parsed?.expiresAt !== 'number') {
        return null;
      }
      return { id: parsed.id, expiresAt: parsed.expiresAt };
    } catch {
      return null;
    }
  }

  private static async withLocalStorageLock<T>(fn: () => Promise<T>): Promise<T> {
    if (typeof localStorage === 'undefined') {
      return fn();
    }

    const now = Date.now();
    const id = `${now}-${Math.random().toString(16).slice(2)}`;
    const expiresAt = now + this.LS_REFRESH_LOCK_TTL_MS;

    const tryAcquire = (): boolean => {
      const existing = this.parseLock(localStorage.getItem(this.LS_REFRESH_LOCK_KEY));
      if (existing && existing.expiresAt > Date.now()) {
        return false;
      }
      try {
        localStorage.setItem(this.LS_REFRESH_LOCK_KEY, JSON.stringify({ id, expiresAt }));
        const confirmed = this.parseLock(localStorage.getItem(this.LS_REFRESH_LOCK_KEY));
        return Boolean(confirmed?.id === id);
      } catch {
        return false;
      }
    };

    let acquired = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      acquired = tryAcquire();
      if (acquired) {
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    try {
      return await fn();
    } finally {
      if (acquired) {
        try {
          const existing = this.parseLock(localStorage.getItem(this.LS_REFRESH_LOCK_KEY));
          if (existing?.id === id) {
            localStorage.removeItem(this.LS_REFRESH_LOCK_KEY);
          }
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Refresh token if needed (throttled)
   * Only refreshes if:
   * - More than 11 minutes since last refresh
   * - No refresh currently in progress
   */
  private static async refreshIfNeeded(reason: string): Promise<void> {
    const now = Date.now();
    // Use the freshest timestamp across tabs to avoid double rotations
    const effectiveLastRefresh = Math.max(this.lastRefreshTime, this.getSharedLastRefreshTime());
    const timeSinceLastRefresh = now - effectiveLastRefresh;

    // Don't refresh if we just did (within last 11 minutes)
    if (timeSinceLastRefresh < 11 * 60 * 1000) {
      return;
    }

    await this.startRefresh(reason);
  }

  /**
   * Perform the actual token refresh
   * Silently fails if user is not logged in
   */
  private static async performRefresh(trigger: string): Promise<void> {
    await this.withRefreshLock(async () => {
      const now = Date.now();
      // If another tab refreshed very recently, skip to avoid double rotation
      const sharedLast = Math.max(this.lastRefreshTime, this.getSharedLastRefreshTime());
      if (now - sharedLast < this.SHARED_REFRESH_GRACE_MS) {
        this.lastRefreshTime = sharedLast;
        return;
      }

      try {
        console.log(`[Auth] Refreshing token (trigger: ${trigger})...`);
        await authApi.refreshToken();
        const refreshedAt = Date.now();
        this.lastRefreshTime = refreshedAt;
        this.setSharedLastRefreshTime(refreshedAt);
        console.log(`[Auth] Token refreshed successfully (trigger: ${trigger})`);
      } catch (error) {
        // Update last refresh time to avoid tight retry loops if user is logged out
        const failedAt = Date.now();
        this.lastRefreshTime = failedAt;
        this.setSharedLastRefreshTime(failedAt);
        // Don't throw - user will be logged out on next API request if refresh failed
        console.warn(`[Auth] Token refresh failed (trigger: ${trigger}):`, error);
        throw error;
      }
    });
  }

  /**
   * Handle 401 errors by attempting refresh
   * Returns true if refresh succeeded, false if user should be logged out
   *
   * @param retryRequest - Function to retry the original request after refresh
   * @returns true if refresh succeeded and request should be retried, false otherwise
   */
  static async handleUnauthorized<T>(
    retryRequest: () => Promise<T>
  ): Promise<{ shouldRetry: boolean; result?: T; isOffline?: boolean }> {
    try {
      // Attempt to refresh the token (shared promise prevents concurrent refreshes)
      await this.startRefresh('401');
      // Refresh succeeded, retry the original request
      try {
        const result = await retryRequest();
        return { shouldRetry: true, result };
      } catch (_error) {
        // Request still failing after successful refresh
        return { shouldRetry: false };
      }
    } catch (error) {
      if (this.isNetworkError(error)) {
        console.warn('[Auth] Refresh failed due to network issues, treating as offline');
        return { shouldRetry: false, isOffline: true };
      }

      console.error('[Auth] Could not refresh token, logging out');
      return { shouldRetry: false };
    }
  }
}
