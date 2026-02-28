import { useEffect, useState } from 'react';

import { brand as brandApi } from '@/lib/api';

import type { BrandAnalysisProfile } from './types';

function useBrandProfileData(brandId: string | null) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<BrandAnalysisProfile | null>(null);

  useEffect(() => {
    if (!brandId) {
      return;
    }

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await brandApi.getBrandAnalysisProfile(brandId);
        if ('error' in response) {
          setError(response.error || 'No profile found');
          setProfile(null);
          return;
        }
        setProfile(response as BrandAnalysisProfile);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    })();
  }, [brandId]);

  return { loading, error, profile, setProfile };
}

function useFreezeCoreState(brandId: string | null) {
  const [freezeCore, setFreezeCore] = useState(false);
  const [freezeLoading, setFreezeLoading] = useState(false);

  useEffect(() => {
    if (!brandId) {
      return;
    }

    void (async () => {
      try {
        const response = await brandApi.getFreezeCore(brandId);
        setFreezeCore(Boolean(response?.freezeCore));
      } catch (error) {
        console.warn('Failed to load freezeCore', error instanceof Error ? error.message : error);
      }
    })();
  }, [brandId]);

  const toggleFreeze = async () => {
    if (!brandId) {
      return;
    }

    setFreezeLoading(true);
    try {
      const next = !freezeCore;
      await brandApi.setFreezeCore(brandId, next);
      setFreezeCore(next);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Failed to update freeze setting');
    } finally {
      setFreezeLoading(false);
    }
  };

  return { freezeCore, freezeLoading, toggleFreeze };
}

function useReRunAnalysis(brandId: string | null) {
  const [reRunLoading, setReRunLoading] = useState(false);
  const [reRunMessage, setReRunMessage] = useState<string | null>(null);

  const handleReRun = async () => {
    if (!brandId) {
      return;
    }

    setReRunLoading(true);
    setReRunMessage(null);
    try {
      const response = await brandApi.startBrandAnalysis(brandId, { force: true, maxPosts: 20 });
      if (response?.status === 'accepted') {
        setReRunMessage('Analysis requested. It will refresh shortly.');
      } else {
        setReRunMessage('Requested. Awaiting update...');
      }
    } catch (error) {
      setReRunMessage(error instanceof Error ? error.message : 'Failed to request analysis');
    } finally {
      setReRunLoading(false);
    }
  };

  return { reRunLoading, reRunMessage, handleReRun };
}

export function useBrandProfileSidebarState(brandId: string | null) {
  const profileData = useBrandProfileData(brandId);
  const freezeState = useFreezeCoreState(brandId);
  const rerunState = useReRunAnalysis(brandId);

  return {
    ...profileData,
    ...freezeState,
    ...rerunState,
  };
}
