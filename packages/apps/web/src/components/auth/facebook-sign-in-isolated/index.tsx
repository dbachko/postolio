import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TIMEOUTS } from '@/constants/timeouts';
import { useAuthStore, type AuthState } from '@/stores/authStore';
import type { FacebookAuthResponse, FacebookLoginResponse } from '@/types/oauth';

interface FacebookSignInIsolatedProps {
  mode: 'signin' | 'signup' | 'link';
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

function getButtonText(mode: FacebookSignInIsolatedProps['mode']) {
  return {
    signin: 'Sign in with Facebook',
    signup: 'Sign up with Facebook',
    link: 'Link Facebook Account',
  }[mode];
}

function getFacebookButtonContent({
  isLoading,
  isSDKLoaded,
  buttonText,
}: {
  isLoading: boolean;
  isSDKLoaded: boolean;
  buttonText: string;
}): ReactNode {
  if (isLoading) {
    return 'Connecting...';
  }
  if (!isSDKLoaded) {
    return 'Loading...';
  }
  return (
    <>
      <svg
        className="mr-2 h-4 w-4"
        aria-hidden="true"
        focusable="false"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
      >
        <path
          fill="#1877F2"
          d="M512 256C512 114.6 397.4 0 256 0S0 114.6 0 256C0 382.3 94.3 487.3 216 508.3V330h-65v-74h65v-56.4c0-64.2 38.2-99.6 96.7-99.6 28 0 57.3 5 57.3 5v63h-32.3c-31.8 0-41.7 19.8-41.7 40v48h71l-11.4 74H296v178.3C417.7 487.3 512 382.3 512 256z"
        />
      </svg>
      {buttonText}
    </>
  );
}

function useFacebookSdk({
  isConfigured,
  onError,
}: {
  isConfigured: boolean;
  onError?: (error: string) => void;
}) {
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const sdkLoadedRef = useRef(false);

  useEffect(() => {
    if (!isConfigured || sdkLoadedRef.current) {
      return;
    }
    if (window.FB) {
      setIsSDKLoaded(true);
      sdkLoadedRef.current = true;
      return;
    }

    const oldInit = window.fbAsyncInit;
    window.fbAsyncInit = function () {
      if (oldInit && typeof oldInit === 'function') {
        oldInit();
      }
      try {
        window.FB?.init({
          appId: import.meta.env.VITE_FACEBOOK_APP_ID,
          cookie: true,
          xfbml: false,
          version: 'v18.0',
          autoLogAppEvents: false,
        });
        setIsSDKLoaded(true);
        sdkLoadedRef.current = true;
      } catch (error) {
        console.error('Failed to initialize Facebook SDK:', error);
        onError?.('Failed to initialize Facebook Sign-In');
      }
    };

    const existingScript = document.querySelector('script[src*="facebook.net/en_US/sdk.js"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      script.async = true;
      script.defer = true;
      script.id = 'facebook-jssdk';
      document.body.appendChild(script);
    }

    return () => {
      window.fbAsyncInit = oldInit;
    };
  }, [isConfigured, onError]);

  return { isSDKLoaded };
}

function useFacebookResponseHandler({
  mode,
  onSuccess,
  onError,
  navigate,
  setUser,
}: {
  mode: FacebookSignInIsolatedProps['mode'];
  onSuccess?: () => void;
  onError?: (error: string) => void;
  navigate: ReturnType<typeof useNavigate>;
  setUser: AuthState['setUser'];
}) {
  const [isLoading, setIsLoading] = useState(false);
  const handleFacebookResponse = useCallback(
    async (authResponse: FacebookAuthResponse) => {
      if (!authResponse?.accessToken) {
        const errorMsg = 'No access token received from Facebook';
        onError?.(errorMsg);
        toast.error('Facebook sign-in failed', { description: errorMsg, icon: <AlertCircle /> });
        return;
      }

      setIsLoading(true);
      try {
        const endpoint = mode === 'link' ? '/api/auth/facebook/link' : '/api/auth/facebook/verify';
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            accessToken: authResponse.accessToken,
            userID: authResponse.userID,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Facebook authentication failed');
        }
        if (mode !== 'link') {
          setUser(data.user);
          toast.success(`${data.isNewUser ? 'Account created' : 'Signed in'} successfully!`, {
            description: 'Welcome to Postolio! Redirecting...',
            icon: <CheckCircle />,
            duration: TIMEOUTS.TOAST_DURATION,
          });
          setTimeout(() => navigate('/dashboard'), TIMEOUTS.SUCCESS_REDIRECT);
        } else {
          toast.success('Facebook account linked!', {
            description: 'You can now sign in with Facebook',
            icon: <CheckCircle />,
          });
        }
        onSuccess?.();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Facebook authentication failed';
        onError?.(errorMsg);
        toast.error('Authentication failed', { description: errorMsg, icon: <AlertCircle /> });
      } finally {
        setIsLoading(false);
      }
    },
    [mode, navigate, onError, onSuccess, setUser]
  );

  return { isLoading, setIsLoading, handleFacebookResponse };
}

function useFacebookLoginHandler({
  isSDKLoaded,
  setIsLoading,
  handleFacebookResponse,
}: {
  isSDKLoaded: boolean;
  setIsLoading: (loading: boolean) => void;
  handleFacebookResponse: (authResponse: FacebookAuthResponse) => Promise<void>;
}) {
  return useCallback(() => {
    if (!window.FB || !isSDKLoaded) {
      toast.error('Facebook SDK not loaded', {
        description: 'Please try again in a moment',
        icon: <AlertCircle />,
      });
      return;
    }
    setIsLoading(true);
    try {
      window.FB.login(
        (response: FacebookLoginResponse) => {
          if (response.authResponse) {
            void handleFacebookResponse(response.authResponse);
            return;
          }
          setIsLoading(false);
          if (response.status !== 'unknown') {
            toast.error('Facebook sign-in cancelled', { icon: <AlertCircle /> });
          }
        },
        { scope: 'public_profile,email' }
      );
    } catch (error) {
      setIsLoading(false);
      console.error('Facebook login error:', error);
      toast.error('Facebook sign-in failed', {
        description: 'An unexpected error occurred',
        icon: <AlertCircle />,
      });
    }
  }, [isSDKLoaded, setIsLoading, handleFacebookResponse]);
}

export function FacebookSignInIsolated({ mode, onSuccess, onError }: FacebookSignInIsolatedProps) {
  const { setUser } = useAuthStore();
  const navigate = useNavigate();
  const isConfigured = Boolean(import.meta.env.VITE_FACEBOOK_APP_ID);
  const { isSDKLoaded } = useFacebookSdk({ isConfigured, onError });
  const { isLoading, setIsLoading, handleFacebookResponse } = useFacebookResponseHandler({
    mode,
    onSuccess,
    onError,
    navigate,
    setUser,
  });
  const handleFacebookLogin = useFacebookLoginHandler({
    isSDKLoaded,
    setIsLoading,
    handleFacebookResponse,
  });

  if (!isConfigured) {
    return (
      <div className="bg-muted/50 w-full rounded-md border p-3 text-center">
        <p className="text-muted-foreground text-sm">Facebook Sign-In not configured</p>
        <p className="text-muted-foreground mt-1 text-xs">
          See FACEBOOK_OAUTH_SETUP.md for instructions
        </p>
      </div>
    );
  }

  const buttonContent = getFacebookButtonContent({
    isLoading,
    isSDKLoaded,
    buttonText: getButtonText(mode),
  });
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleFacebookLogin}
      disabled={isLoading || !isSDKLoaded}
    >
      {buttonContent}
    </Button>
  );
}
