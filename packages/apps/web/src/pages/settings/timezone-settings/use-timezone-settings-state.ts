import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useTimezone } from '@/contexts/TimezoneContext';
import { auth as authApi, brand as brandApi } from '@/lib/api';
import { getUserTimezone } from '@/lib/timezone';
import { useAuthStore, type AuthState } from '@/stores/authStore';
import { useBrandStore } from '@/stores/brandStore';
import type { ImageProvider } from '@/types/image-providers';

function createHandleSaveSettings(params: {
  setIsSaving: (value: boolean) => void;
  setTimezone: (timezone: string, autoDetected: boolean) => Promise<void>;
  autoDetect: boolean;
  detectedTimezone: string;
  localTimezone: string;
}) {
  return async () => {
    params.setIsSaving(true);
    try {
      await params.setTimezone(
        params.autoDetect ? params.detectedTimezone : params.localTimezone,
        params.autoDetect
      );
      toast.success('Timezone settings saved successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings';
      toast.error(message);
      console.error('Error saving settings:', error);
    } finally {
      params.setIsSaving(false);
    }
  };
}

function createHandleSaveBrandTimezone(params: {
  selectedBrandId?: string;
  brandTimezone: string | null;
  setIsSaving: (value: boolean) => void;
}) {
  return async () => {
    if (!params.selectedBrandId) {
      return;
    }

    params.setIsSaving(true);
    try {
      await brandApi.updateBrandTimezone(params.selectedBrandId, params.brandTimezone);
      toast.success('Brand timezone settings saved successfully');
    } catch (error) {
      toast.error('Failed to save brand timezone');
      console.error('Error saving brand timezone:', error);
    } finally {
      params.setIsSaving(false);
    }
  };
}

function createHandleSaveBrandImageProvider(params: {
  selectedBrandId?: string;
  brandImageProvider: ImageProvider | null;
  setIsSaving: (value: boolean) => void;
}) {
  return async () => {
    if (!params.selectedBrandId) {
      return;
    }

    params.setIsSaving(true);
    try {
      await brandApi.updateBrandImageProvider(params.selectedBrandId, params.brandImageProvider);
      toast.success('Brand image provider saved successfully');
    } catch (error) {
      toast.error('Failed to save brand image provider');
      console.error('Error saving brand image provider:', error);
    } finally {
      params.setIsSaving(false);
    }
  };
}

function createHandleSaveWeekStart(params: {
  setIsSaving: (value: boolean) => void;
  weekStart: 'monday' | 'sunday';
  user: AuthState['user'];
  setUser: AuthState['setUser'];
}) {
  return async () => {
    params.setIsSaving(true);
    try {
      await authApi.updateUserWeekStart({ weekStart: params.weekStart });
      if (params.user) {
        params.setUser({ ...params.user, weekStart: params.weekStart });
      }
      toast.success('Calendar preference saved');
    } catch {
      toast.error('Failed to save calendar preference');
    } finally {
      params.setIsSaving(false);
    }
  };
}

function useBrandTimezone(selectedBrandId?: string) {
  const [brandTimezone, setBrandTimezone] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedBrandId) {
      return;
    }

    void (async () => {
      try {
        const response = await brandApi.getBrandTimezone(selectedBrandId);
        setBrandTimezone(response.timezone || null);
      } catch (error) {
        console.error('Failed to fetch brand timezone:', error);
      }
    })();
  }, [selectedBrandId]);

  return { brandTimezone, setBrandTimezone };
}

function useBrandImageProvider(selectedBrandId?: string) {
  const [brandImageProvider, setBrandImageProvider] = useState<ImageProvider | null>(null);

  useEffect(() => {
    if (!selectedBrandId) {
      return;
    }

    void (async () => {
      try {
        const response = await brandApi.getBrandImageProvider(selectedBrandId);
        setBrandImageProvider(response.imageProvider || null);
      } catch (error) {
        console.error('Failed to fetch brand image provider:', error);
      }
    })();
  }, [selectedBrandId]);

  return { brandImageProvider, setBrandImageProvider };
}

export function useTimezoneSettingsState() {
  const { timezone, isAutoDetected, setTimezone } = useTimezone();
  const { selectedBrand } = useBrandStore();
  const { user, setUser } = useAuthStore();

  const [localTimezone, setLocalTimezone] = useState(timezone);
  const [autoDetect, setAutoDetect] = useState(isAutoDetected);
  const brandTimezoneState = useBrandTimezone(selectedBrand?.id);
  const brandImageProviderState = useBrandImageProvider(selectedBrand?.id);
  const [isSaving, setIsSaving] = useState(false);
  const [detectedTimezone] = useState(getUserTimezone());
  const [weekStart, setWeekStart] = useState<'monday' | 'sunday'>(
    (user?.weekStart as 'monday' | 'sunday') || 'monday'
  );

  return {
    timezone,
    selectedBrand,
    localTimezone,
    autoDetect,
    brandTimezone: brandTimezoneState.brandTimezone,
    brandImageProvider: brandImageProviderState.brandImageProvider,
    isSaving,
    detectedTimezone,
    weekStart,
    setBrandTimezone: brandTimezoneState.setBrandTimezone,
    setBrandImageProvider: brandImageProviderState.setBrandImageProvider,
    setWeekStart,
    handleTimezoneChange: (value: string) => {
      setAutoDetect(false);
      setLocalTimezone(value);
    },
    handleAutoDetectToggle: (checked: boolean) => {
      setAutoDetect(checked);
      if (checked) {
        setLocalTimezone(detectedTimezone);
      }
    },
    handleSaveSettings: createHandleSaveSettings({
      setIsSaving,
      setTimezone,
      autoDetect,
      detectedTimezone,
      localTimezone,
    }),
    handleSaveBrandTimezone: createHandleSaveBrandTimezone({
      selectedBrandId: selectedBrand?.id,
      brandTimezone: brandTimezoneState.brandTimezone,
      setIsSaving,
    }),
    handleSaveBrandImageProvider: createHandleSaveBrandImageProvider({
      selectedBrandId: selectedBrand?.id,
      brandImageProvider: brandImageProviderState.brandImageProvider,
      setIsSaving,
    }),
    handleResetToDefault: () => {
      setAutoDetect(true);
      setLocalTimezone(detectedTimezone);
      brandTimezoneState.setBrandTimezone(null);
      brandImageProviderState.setBrandImageProvider(null);
    },
    handleSaveWeekStart: createHandleSaveWeekStart({
      setIsSaving,
      weekStart,
      user,
      setUser,
    }),
  };
}
