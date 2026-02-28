import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { TIMEOUTS } from '@/constants/timeouts';
import { Button } from '@/components/ui/button';
import { useGoogleLogin } from '@react-oauth/google';
import googleIconUrl from '@/assets/google.svg';

interface GoogleSignInIsolatedProps {
  mode: 'signin' | 'signup' | 'link';
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

function GoogleSetupWarning() {
  return (
    <div className="bg-muted/50 w-full rounded-md border p-3 text-center">
      <p className="text-muted-foreground text-sm">Google Sign-In not configured</p>
      <p className="text-muted-foreground mt-1 text-xs">
        See GOOGLE_OAUTH_SETUP.md for instructions
      </p>
    </div>
  );
}

function GoogleActionButton({
  isLoading,
  label,
  onClick,
}: {
  isLoading: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-center gap-2"
      onClick={onClick}
      disabled={isLoading}
    >
      <img src={googleIconUrl} alt="" className="h-4 w-4" loading="lazy" decoding="async" />
      {isLoading ? 'Connecting…' : label}
    </Button>
  );
}

export function GoogleSignInIsolated({ mode, onSuccess, onError }: GoogleSignInIsolatedProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { setUser } = useAuthStore();
  const navigate = useNavigate();

  // Check if Google OAuth is configured
  const isConfigured =
    import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== '';

  const exchangeCode = useCallback(
    async (code: string) => {
      setIsLoading(true);
      try {
        const endpoint = mode === 'link' ? '/api/auth/google/link-code' : '/api/auth/google/code';
        const apiResponse = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ code, mode }),
        });

        const data = await apiResponse.json();
        if (!apiResponse.ok) {
          throw new Error(data.error || 'Google authentication failed');
        }

        if (mode !== 'link') {
          setUser(data.user);
          const actionText = data.isNewUser ? 'Account created' : 'Signed in';
          toast.success(`${actionText} successfully!`, {
            description: 'Welcome to Postolio! Redirecting...',
            icon: <CheckCircle className="text-foreground" />,
            duration: TIMEOUTS.TOAST_DURATION,
          });
          setTimeout(() => navigate('/dashboard'), TIMEOUTS.SUCCESS_REDIRECT);
        } else {
          toast.success('Google account linked!', {
            description: 'You can now sign in with Google',
            icon: <CheckCircle className="text-foreground" />,
          });
        }

        onSuccess?.();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Google authentication failed';
        onError?.(errorMsg);
        toast.error('Authentication failed', {
          description: errorMsg,
          icon: <AlertCircle className="text-destructive" />,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [mode, navigate, onError, onSuccess, setUser]
  );

  const login = useGoogleLogin({
    flow: 'auth-code',
    ux_mode: 'popup',
    scope: 'openid email profile',
    onSuccess: async (tokenResponse) => {
      // tokenResponse contains a `code` in auth-code flow
      const code = (tokenResponse as unknown as { code?: string })?.code || '';
      if (!code) {
        toast.error('Google sign-in failed', {
          description: 'No authorization code received from Google',
          icon: <AlertCircle className="text-destructive" />,
        });
        return;
      }
      await exchangeCode(code);
    },
    onError: () => {
      toast.error('Google sign-in cancelled');
    },
  });

  if (!isConfigured) {
    return <GoogleSetupWarning />;
  }

  const buttonLabel = {
    signin: 'Sign in with Google',
    signup: 'Sign up with Google',
    link: 'Link Google Account',
  }[mode];

  return <GoogleActionButton isLoading={isLoading} label={buttonLabel} onClick={() => login()} />;
}
