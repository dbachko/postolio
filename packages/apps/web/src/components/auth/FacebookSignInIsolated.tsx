import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { TIMEOUTS } from '@/constants/timeouts';
import type { FacebookAuthResponse, FacebookLoginResponse } from '@/types/oauth';

interface FacebookSignInIsolatedProps {
  mode: 'signin' | 'signup' | 'link';
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export function FacebookSignInIsolated({ mode, onSuccess, onError }: FacebookSignInIsolatedProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const { setUser, setToken } = useAuthStore();
  const navigate = useNavigate();
  const sdkLoadedRef = useRef(false);

  // Check if Facebook OAuth is configured
  const isConfigured =
    import.meta.env.VITE_FACEBOOK_APP_ID && import.meta.env.VITE_FACEBOOK_APP_ID !== '';

  const handleFacebookResponse = useCallback(
    async (authResponse: FacebookAuthResponse) => {
      if (!authResponse || !authResponse.accessToken) {
        const errorMsg = 'No access token received from Facebook';
        onError?.(errorMsg);
        toast.error('Facebook sign-in failed', {
          description: errorMsg,
          icon: <AlertCircle className="text-red-500" />,
        });
        return;
      }

      setIsLoading(true);

      try {
        const endpoint = mode === 'link' ? '/api/auth/facebook/link' : '/api/auth/facebook/verify';

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(mode === 'link' && localStorage.getItem('token')
              ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
              : {}),
          },
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
          // Store auth data
          setToken(data.token);
          setUser(data.user);
          localStorage.setItem('token', data.token);

          const actionText = data.isNewUser ? 'Account created' : 'Signed in';
          toast.success(`${actionText} successfully!`, {
            description: 'Welcome to Postolio! Redirecting...',
            icon: <CheckCircle className="text-green-500" />,
            duration: TIMEOUTS.TOAST_DURATION,
          });

          setTimeout(() => {
            navigate('/dashboard');
          }, TIMEOUTS.SUCCESS_REDIRECT);
        } else {
          toast.success('Facebook account linked!', {
            description: 'You can now sign in with Facebook',
            icon: <CheckCircle className="text-green-500" />,
          });
        }

        onSuccess?.();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Facebook authentication failed';
        onError?.(errorMsg);
        toast.error('Authentication failed', {
          description: errorMsg,
          icon: <AlertCircle className="text-red-500" />,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mode, navigate, onError, onSuccess, setToken, setUser]
  );

  const handleFacebookLogin = useCallback(() => {
    if (!window.FB || !isSDKLoaded) {
      toast.error('Facebook SDK not loaded', {
        description: 'Please try again in a moment',
        icon: <AlertCircle className="text-red-500" />,
      });
      return;
    }

    setIsLoading(true);

    try {
      window.FB.login(
        (response: FacebookLoginResponse) => {
          if (response.authResponse) {
            handleFacebookResponse(response.authResponse);
          } else {
            setIsLoading(false);
            if (response.status !== 'unknown') {
              toast.error('Facebook sign-in cancelled', {
                icon: <AlertCircle className="text-red-500" />,
              });
            }
          }
        },
        { scope: 'public_profile,email' }
      );
    } catch (error) {
      setIsLoading(false);
      console.error('Facebook login error:', error);
      toast.error('Facebook sign-in failed', {
        description: 'An unexpected error occurred',
        icon: <AlertCircle className="text-red-500" />,
      });
    }
  }, [isSDKLoaded, handleFacebookResponse]);

  useEffect(() => {
    if (!isConfigured || sdkLoadedRef.current) return;

    // Check if SDK is already loaded
    if (window.FB) {
      setIsSDKLoaded(true);
      sdkLoadedRef.current = true;
      return;
    }

    // Create a unique callback for this instance
    const callbackName = `fbAsyncInit_${Date.now()}`;

    // Store the old fbAsyncInit if it exists
    const oldInit = window.fbAsyncInit;

    window.fbAsyncInit = function () {
      // Call the old init if it existed
      if (oldInit && typeof oldInit === 'function') {
        oldInit();
      }

      try {
        window.FB?.init({
          appId: import.meta.env.VITE_FACEBOOK_APP_ID,
          cookie: true,
          xfbml: false, // Don't parse XFBML to avoid DOM manipulation
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

    // Check if script already exists
    const existingScript = document.querySelector('script[src*="facebook.net/en_US/sdk.js"]');
    if (existingScript) {
      // SDK script exists but hasn't loaded yet
      return;
    }

    // Load the SDK asynchronously
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.id = 'facebook-jssdk';

    document.body.appendChild(script);

    return () => {
      // Cleanup is minimal to avoid conflicts
      if (window.fbAsyncInit === window[callbackName as keyof Window]) {
        window.fbAsyncInit = oldInit;
      }
    };
  }, [isConfigured, onError]);

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

  const buttonText = {
    signin: 'Sign in with Facebook',
    signup: 'Sign up with Facebook',
    link: 'Link Facebook Account',
  }[mode];

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={handleFacebookLogin}
      disabled={isLoading || !isSDKLoaded}
    >
      {isLoading ? (
        'Connecting...'
      ) : !isSDKLoaded ? (
        'Loading...'
      ) : (
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
      )}
    </Button>
  );
}
