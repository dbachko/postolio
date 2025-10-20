import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { auth as authApi } from '../lib/api';

export function useTokenRefresh() {
  const { isAuthenticated, logout } = useAuthStore();
  const periodicCheckRef = useRef<NodeJS.Timeout | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const visibilityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastRefreshRef = useRef<number>(0);
  const isRefreshingRef = useRef(false);
  const refreshAttemptsRef = useRef(0);

  // Helper function to check if JWT is expired
  const isTokenExpired = useCallback((token: string): boolean => {
    try {
      if (typeof token !== 'string') return true;
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[1]) return true;

      // Validate base64 format before parsing
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(parts[1])) return true;

      const payload = JSON.parse(atob(parts[1]));
      if (!payload || typeof payload.exp !== 'number') return true;

      const expiryTime = payload.exp * 1000;
      return Date.now() >= expiryTime;
    } catch (error) {
      console.error('Failed to decode JWT:', error);
      return true;
    }
  }, []);

  // Helper function to get token expiry time
  const getTokenExpiryTime = useCallback((token: string): number | null => {
    try {
      if (typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[1]) return null;

      // Validate base64 format before parsing
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(parts[1])) return null;

      const payload = JSON.parse(atob(parts[1]));
      if (!payload || typeof payload.exp !== 'number') return null;

      return payload.exp * 1000;
    } catch (error) {
      console.error('Failed to decode JWT:', error);
      return null;
    }
  }, []);

  // Check if we should refresh based on time and activity
  const shouldRefreshToken = useCallback(
    (token: string): boolean => {
      const expiryTime = getTokenExpiryTime(token);
      if (!expiryTime) return false;

      const now = Date.now();
      const timeUntilExpiry = expiryTime - now;

      // Refresh if token expires in less than 10 minutes
      // OR if it's been more than 45 minutes since last refresh (safety net)
      const shouldRefreshByTime = timeUntilExpiry < 10 * 60 * 1000; // 10 minutes
      const shouldRefreshByActivity = now - lastRefreshRef.current > 45 * 60 * 1000; // 45 minutes

      return shouldRefreshByTime || shouldRefreshByActivity;
    },
    [getTokenExpiryTime]
  );

  // Refresh token function with retry logic
  const refreshToken = useCallback(async (): Promise<boolean> => {
    if (isRefreshingRef.current) return false;

    const token = localStorage.getItem('auth_token');
    if (!token || !shouldRefreshToken(token)) return false;

    try {
      isRefreshingRef.current = true;
      refreshAttemptsRef.current += 1;

      console.log(`Token refresh attempt #${refreshAttemptsRef.current}`);

      const response = await authApi.refreshToken();

      if (response.message) {
        // Token is now in HttpOnly cookie - no manual storage needed
        lastRefreshRef.current = Date.now();
        refreshAttemptsRef.current = 0;
        console.log('Token refreshed successfully');
        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);

      // If refresh fails 3 times, logout
      if (refreshAttemptsRef.current >= 3) {
        console.error('Token refresh failed 3 times, logging out');
        logout();
        return false;
      }
    } finally {
      isRefreshingRef.current = false;
    }

    return false;
  }, [shouldRefreshToken, logout]);

  // Handle visibility change (when user switches tabs)
  const handleVisibilityChange = useCallback(() => {
    if (document.visibilityState === 'visible') {
      console.log('Tab became visible, checking token status');

      // Clear any existing visibility timeout
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
      }

      // Check token status immediately when tab becomes visible
      const token = localStorage.getItem('auth_token');
      if (token && shouldRefreshToken(token)) {
        // Small delay to ensure page is fully loaded
        visibilityTimeoutRef.current = setTimeout(() => {
          refreshToken();
        }, 1000);
      }
    }
  }, [shouldRefreshToken, refreshToken]);

  // Schedule next refresh with multiple strategies
  const scheduleTokenRefresh = useCallback(
    (token: string) => {
      // Clear existing timeouts
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }

      const expiryTime = getTokenExpiryTime(token);
      if (!expiryTime) return;

      const now = Date.now();
      const timeUntilExpiry = expiryTime - now;

      // Calculate refresh time: 10 minutes before expiry for 1-hour tokens
      const refreshTime = timeUntilExpiry - 10 * 60 * 1000; // 10 minutes before expiry

      // If token expires soon, refresh immediately
      if (refreshTime <= 0) {
        refreshToken();
        return;
      }

      // Schedule refresh with setTimeout (will be throttled in inactive tabs)
      refreshTimeoutRef.current = setTimeout(
        async () => {
          const success = await refreshToken();
          if (success) {
            // After successful refresh, schedule next refresh
            const newToken = localStorage.getItem('auth_token');
            if (newToken) {
              scheduleTokenRefresh(newToken);
            }
          }
        },
        Math.min(refreshTime, 30 * 60 * 1000)
      ); // Max 30 minutes to prevent long timeouts

      console.log(`Token refresh scheduled in ${Math.round(refreshTime / 1000 / 60)} minutes`);
    },
    [refreshToken, getTokenExpiryTime]
  );

  // Handle user activity (clicks, scrolls, etc.)
  const handleUserActivity = useCallback(() => {
    const token = localStorage.getItem('auth_token');
    if (token && shouldRefreshToken(token)) {
      // Debounce activity checks
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
      }

      visibilityTimeoutRef.current = setTimeout(() => {
        refreshToken();
      }, 2000); // 2 second debounce
    }
  }, [shouldRefreshToken, refreshToken]);

  // Periodic check for token status (runs every 15 minutes)
  const startPeriodicCheck = useCallback(() => {
    if (periodicCheckRef.current) {
      clearInterval(periodicCheckRef.current);
    }

    periodicCheckRef.current = setInterval(
      () => {
        const token = localStorage.getItem('auth_token');
        if (token && shouldRefreshToken(token)) {
          console.log('Periodic check: Token needs refresh');
          refreshToken();
        }
      },
      15 * 60 * 1000
    ); // Check every 15 minutes
  }, [shouldRefreshToken, refreshToken]);

  // Stop periodic check
  const stopPeriodicCheck = useCallback(() => {
    if (periodicCheckRef.current) {
      clearInterval(periodicCheckRef.current);
      periodicCheckRef.current = null;
    }
  }, []);

  // Main effect to monitor token and schedule refresh
  useEffect(() => {
    if (!isAuthenticated) {
      // Clear all timeouts
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
      }
      stopPeriodicCheck();
      return;
    }

    const token = localStorage.getItem('auth_token');
    if (!token) return;

    // Check if token is already expired
    if (isTokenExpired(token)) {
      // Try to refresh immediately
      refreshToken();
    } else {
      // Schedule refresh for later
      scheduleTokenRefresh(token);
    }

    // Start periodic check
    startPeriodicCheck();

    // Set up visibility change listener
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Set up user activity listeners
    const events = ['click', 'scroll', 'keydown', 'touchstart'];
    events.forEach((event) => {
      document.addEventListener(event, handleUserActivity, { passive: true });
    });

    // Cleanup function
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      events.forEach((event) => {
        document.removeEventListener(event, handleUserActivity);
      });

      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
      }

      stopPeriodicCheck();
    };
  }, [
    isAuthenticated,
    isTokenExpired,
    refreshToken,
    scheduleTokenRefresh,
    handleVisibilityChange,
    handleUserActivity,
    startPeriodicCheck,
    stopPeriodicCheck,
  ]);

  // Return refresh function for manual use
  return { refreshToken };
}
