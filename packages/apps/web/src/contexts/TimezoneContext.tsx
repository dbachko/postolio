/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
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

type AuthUserTimezone = {
  id?: string;
  timezone?: string | null;
  timezoneAutoDetected?: boolean | null;
} | null;

const TimezoneContext = createContext<TimezoneContextType | undefined>(undefined);

function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function useUserTimezoneState(user: AuthUserTimezone) {
  const [timezone, setTimezoneState] = useState<string>(getUserTimezone());
  const [isAutoDetected, setIsAutoDetected] = useState<boolean>(true);

  useEffect(() => {
    if (user?.timezone && !user.timezoneAutoDetected) {
      setTimezoneState(user.timezone);
      setIsAutoDetected(false);
      return;
    }

    const detected = getUserTimezone();
    setTimezoneState(detected);
    setIsAutoDetected(true);
    setLocalSetting('userTimezone', detected);
  }, [user]);

  return {
    isAutoDetected,
    setIsAutoDetected,
    setTimezoneState,
    timezone,
  };
}

function useTimezoneUpdater({
  timezone,
  isAutoDetected,
  setTimezoneState,
  setIsAutoDetected,
}: {
  timezone: string;
  isAutoDetected: boolean;
  setTimezoneState: (timezone: string) => void;
  setIsAutoDetected: (value: boolean) => void;
}) {
  return useCallback(
    async (newTimezone: string, isAuto = false) => {
      if (!isAuto && !isValidTimezone(newTimezone)) {
        throw new Error('Invalid timezone provided');
      }

      const previousTimezone = timezone;
      const previousIsAutoDetected = isAutoDetected;
      const previousLocalStorage = getLocalSetting<string>('userTimezone');

      setTimezoneState(newTimezone);
      setIsAutoDetected(isAuto);
      setLocalSetting('userTimezone', newTimezone);

      try {
        await authApi.updateUserTimezone({
          timezone: newTimezone,
          timezoneAutoDetected: isAuto,
        });
      } catch (error) {
        setTimezoneState(previousTimezone);
        setIsAutoDetected(previousIsAutoDetected);
        if (previousLocalStorage) {
          setLocalSetting('userTimezone', previousLocalStorage);
        } else {
          removeLocalSetting('userTimezone');
        }
        throw error instanceof Error ? error : new Error('Failed to update timezone');
      }
    },
    [isAutoDetected, setIsAutoDetected, setTimezoneState, timezone]
  );
}

function useRefreshTimezone({
  setTimezoneState,
  setIsAutoDetected,
}: {
  setTimezoneState: (timezone: string) => void;
  setIsAutoDetected: (value: boolean) => void;
}) {
  return useCallback(async () => {
    try {
      const data = await authApi.getProfile();
      if (!data.user) {
        return;
      }
      if (data.user.timezone && !data.user.timezoneAutoDetected) {
        setTimezoneState(data.user.timezone);
        setIsAutoDetected(false);
        return;
      }
      const detected = getUserTimezone();
      setTimezoneState(detected);
      setIsAutoDetected(true);
    } catch (error) {
      console.error('Error refreshing timezone:', error);
    }
  }, [setIsAutoDetected, setTimezoneState]);
}

function useBrandTimezoneResolver({ timezone, userId }: { timezone: string; userId?: string }) {
  const [brandTimezones, setBrandTimezones] = useState<Map<string, string>>(new Map());
  const inFlightRequestsRef = useRef<Map<string, Promise<string>>>(new Map());

  useEffect(() => {
    setBrandTimezones(new Map());
  }, [userId]);

  const getBrandTimezone = useCallback(
    async (brandId: string): Promise<string> => {
      if (brandTimezones.has(brandId)) {
        return brandTimezones.get(brandId)!;
      }

      const inFlightRequests = inFlightRequestsRef.current;
      if (inFlightRequests.has(brandId)) {
        return inFlightRequests.get(brandId)!;
      }

      const requestPromise = (async () => {
        try {
          const data = await brandApi.getBrandTimezone(brandId);
          const brandTimezone = data.timezone || timezone;
          setBrandTimezones((prev) => new Map(prev).set(brandId, brandTimezone));
          return brandTimezone;
        } catch (error) {
          console.warn(`Failed to fetch brand timezone for ${brandId}, using user timezone`, error);
          return timezone;
        } finally {
          inFlightRequestsRef.current.delete(brandId);
        }
      })();

      inFlightRequestsRef.current.set(brandId, requestPromise);
      return requestPromise;
    },
    [brandTimezones, timezone]
  );

  return getBrandTimezone;
}

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

  const { timezone, isAutoDetected, setTimezoneState, setIsAutoDetected } = useUserTimezoneState(
    user as AuthUserTimezone
  );

  const setTimezone = useTimezoneUpdater({
    timezone,
    isAutoDetected,
    setTimezoneState,
    setIsAutoDetected,
  });

  const refreshTimezone = useRefreshTimezone({ setTimezoneState, setIsAutoDetected });

  const getBrandTimezone = useBrandTimezoneResolver({
    timezone,
    userId: user?.id,
  });

  const value: TimezoneContextType = {
    timezone,
    isAutoDetected,
    setTimezone,
    getBrandTimezone,
    refreshTimezone,
  };

  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>;
};
