import { useEffect, useState, useCallback } from "react";

interface SDKLoadState {
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
}

export function useGoogleSDK(clientId: string | undefined) {
  const [state, setState] = useState<SDKLoadState>({
    isLoading: false,
    isLoaded: false,
    error: null,
  });

  const loadSDK = useCallback(() => {
    if (!clientId || state.isLoaded || state.isLoading) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Check if already loaded
    if (window.google?.accounts?.id) {
      setState({ isLoading: false, isLoaded: true, error: null });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;

    script.onload = () => {
      setState({ isLoading: false, isLoaded: true, error: null });
    };

    script.onerror = () => {
      setState({
        isLoading: false,
        isLoaded: false,
        error: "Failed to load Google Sign-In SDK",
      });
    };

    document.head.appendChild(script);
  }, [clientId, state.isLoaded, state.isLoading]);

  useEffect(() => {
    loadSDK();
  }, [loadSDK]);

  return { ...state, retry: loadSDK };
}

export function useFacebookSDK(appId: string | undefined) {
  const [state, setState] = useState<SDKLoadState>({
    isLoading: false,
    isLoaded: false,
    error: null,
  });

  const loadSDK = useCallback(() => {
    if (!appId || state.isLoaded || state.isLoading) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    // Check if already loaded
    if (window.FB) {
      setState({ isLoading: false, isLoaded: true, error: null });
      return;
    }

    // Setup Facebook async init
    window.fbAsyncInit = function () {
      try {
        window.FB?.init({
          appId,
          cookie: true,
          xfbml: false,
          version: "v18.0",
          autoLogAppEvents: false,
        });
        setState({ isLoading: false, isLoaded: true, error: null });
      } catch {
        setState({
          isLoading: false,
          isLoaded: false,
          error: "Failed to initialize Facebook SDK",
        });
      }
    };

    // Check if script already exists
    const existingScript = document.querySelector(
      'script[src*="facebook.net/en_US/sdk.js"]',
    );
    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.id = "facebook-jssdk";

    script.onerror = () => {
      setState({
        isLoading: false,
        isLoaded: false,
        error: "Failed to load Facebook SDK",
      });
    };

    document.body.appendChild(script);
  }, [appId, state.isLoaded, state.isLoading]);

  useEffect(() => {
    loadSDK();
  }, [loadSDK]);

  return { ...state, retry: loadSDK };
}
