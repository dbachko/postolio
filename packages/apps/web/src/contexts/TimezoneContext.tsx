/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { getUserTimezone } from '../lib/timezone';
import { getLocalSetting, setLocalSetting, removeLocalSetting } from '@/lib/settings/localSettings';
import { useAuthStore } from '../stores/authStore';
import { auth as authApi, brand as brandApi } from '../lib/api';

interface TimezoneContextType {
  // Current timezone being used
  timezone: string;
  // Whether timezone is auto-detected
  isAutoDetected: boolean;
  // Update timezone (also updates backend)
  setTimezone: (timezone: string, isAuto?: boolean) => Promise<void>;
  // Get timezone for a specific brand
  getBrandTimezone: (brandId: string) => Promise<string>;
  // Refresh timezone from user settings
  refreshTimezone: () => Promise<void>;
}

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined);

export const useTimezone = () => {
  const context = useContext(TimezoneContext);
  if (!context) {
    throw new Error('useTimezone must be used within a TimezoneProvider');
  }
  return context;
};

interface TimezoneProviderProps {
  children: ReactNode;
}

export const TimezoneProvider: React.FC<TimezoneProviderProps> = ({ children }) => {
  const { user } = useAuthStore();
  const [timezone, setTimezoneState] = useState<string>(getUserTimezone());
  const [isAutoDetected, setIsAutoDetected] = useState<boolean>(true);
  const [brandTimezones, setBrandTimezones] = useState<Map<string, string>>(new Map());
  // Use ref for synchronous access to in-flight requests (prevents race conditions)
  const inFlightRequestsRef = useRef<Map<string, Promise<string>>>(new Map());

  // Initialize timezone on mount and when user changes
  useEffect(() => {
    if (user?.timezone && !user.timezoneAutoDetected) {
      // User has manually set timezone
      setTimezoneState(user.timezone);
      setIsAutoDetected(false);
    } else {
      // Auto-detect from browser
      const detected = getUserTimezone();
      setTimezoneState(detected);
      setIsAutoDetected(true);
      setLocalSetting('userTimezone', detected);
    }
  }, [user]);

  // Validate timezone helper
  const isValidTimezone = (tz: string): boolean => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  };

  // Update timezone and sync with backend
  const setTimezone = async (newTimezone: string, isAuto: boolean = false) => {
    // Validate timezone before setting
    if (!isAuto && !isValidTimezone(newTimezone)) {
      throw new Error('Invalid timezone provided');
    }

    // Store previous values for rollback
    const previousTimezone = timezone;
    const previousIsAutoDetected = isAutoDetected;
    const previousLocalStorage = getLocalSetting<string>('userTimezone');

    // Update local state optimistically
    setTimezoneState(newTimezone);
    setIsAutoDetected(isAuto);
    setLocalSetting('userTimezone', newTimezone);

    try {
      await authApi.updateUserTimezone({
        timezone: newTimezone,
        timezoneAutoDetected: isAuto,
      });
    } catch (error) {
      // Rollback local state on failure
      setTimezoneState(previousTimezone);
      setIsAutoDetected(previousIsAutoDetected);
      if (previousLocalStorage) setLocalSetting('userTimezone', previousLocalStorage);
      else removeLocalSetting('userTimezone');

      // Re-throw error for caller to handle
      throw error instanceof Error ? error : new Error('Failed to update timezone');
    }
  };

  // Get timezone for a specific brand (with caching and request deduplication)
  const getBrandTimezone = async (brandId: string): Promise<string> => {
    // Check cache first
    if (brandTimezones.has(brandId)) {
      return brandTimezones.get(brandId)!;
    }

    // Check if there's already a request in flight for this brandId (using ref for synchronous access)
    const inFlightRequests = inFlightRequestsRef.current;
    if (inFlightRequests.has(brandId)) {
      return inFlightRequests.get(brandId)!;
    }

    // Create a new request
    const fetchBrandTimezone = async () => {
      try {
        const data = await brandApi.getBrandTimezone(brandId);
        const brandTz = data.timezone || timezone;

        // Cache the result
        setBrandTimezones((prev) => new Map(prev).set(brandId, brandTz));

        // Remove from in-flight requests
        inFlightRequestsRef.current.delete(brandId);

        return brandTz;
      } catch (error) {
        // Remove from in-flight requests
        inFlightRequestsRef.current.delete(brandId);

        // Log error but don't throw - fallback to user timezone
        console.warn(`Failed to fetch brand timezone for ${brandId}, using user timezone`, error);
        return timezone;
      }
    };
    const requestPromise = fetchBrandTimezone();

    // Store the promise to deduplicate concurrent requests (synchronous operation)
    inFlightRequestsRef.current.set(brandId, requestPromise);

    return requestPromise;
  };

  // Refresh timezone from user settings
  const refreshTimezone = async () => {
    try {
      const data = await authApi.getProfile();
      if (data.user) {
        if (data.user.timezone && !data.user.timezoneAutoDetected) {
          setTimezoneState(data.user.timezone);
          setIsAutoDetected(false);
        } else {
          const detected = getUserTimezone();
          setTimezoneState(detected);
          setIsAutoDetected(true);
        }
      }
    } catch (error) {
      console.error('Error refreshing timezone:', error);
    }
  };

  // Clear brand timezone cache when user changes
  useEffect(() => {
    setBrandTimezones(new Map());
  }, [user?.id]);

  const value: TimezoneContextType = {
    timezone,
    isAutoDetected,
    setTimezone,
    getBrandTimezone,
    refreshTimezone,
  };

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
};
