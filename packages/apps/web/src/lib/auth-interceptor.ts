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
  private static readonly REFRESH_INTERVAL = 12 * 60 * 1000; // 12 minutes
  private static refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start automatic token refresh
   * Call this once when the app initializes
   */
  static startAutoRefresh() {
    console.log('[Auth] Starting automatic token refresh (every 12 minutes)');

    // Refresh immediately on start (if user is logged in)
    this.refreshIfNeeded('startup');

    // Then refresh every 12 minutes
    this.refreshTimer = setInterval(() => {
      this.refreshIfNeeded('interval');
    }, this.REFRESH_INTERVAL);

    // Also refresh when tab becomes visible (user returns)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.refreshIfNeeded('visibility');
      }
    });

    // Cleanup on unmount
    window.addEventListener('beforeunload', () => {
      this.stopAutoRefresh();
    });
  }

  /**
   * Stop automatic token refresh
   */
  static stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Start a refresh cycle with a shared promise to avoid concurrent rotations
   */
  private static startRefresh(reason: string): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;

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
    if (typeof localStorage === 'undefined') return 0;
    try {
      const raw = localStorage.getItem(this.SHARED_REFRESH_KEY);
      if (!raw) return 0;
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
    if (typeof localStorage === 'undefined') return;
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
    return fn();
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
  ): Promise<{ shouldRetry: boolean; result?: T }> {
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
    } catch (_error) {
      console.error('[Auth] Could not refresh token, logging out');
      return { shouldRetry: false };
    }
  }
}
