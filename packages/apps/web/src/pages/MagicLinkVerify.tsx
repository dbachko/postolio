import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { generateDeviceFingerprint, getDeviceName } from '@/lib/device-fingerprint';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TIMEOUTS } from '@/constants/timeouts';
import { SiteFooter } from '@/components/site-footer';

export function MagicLinkVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuthStore();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  const token = searchParams.get('token');

  // Verify on token change (ignore verifyMagicLink dependency to avoid re-creation churn)
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided');
      return;
    }

    verifyMagicLink(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const verifyMagicLink = async (token: string) => {
    try {
      // Generate device context for stable session/device tracking
      let deviceFingerprint: string | undefined;
      let deviceName: string | undefined;
      try {
        const fp = await generateDeviceFingerprint();
        deviceFingerprint = fp.visitorId;
        deviceName = getDeviceName();
      } catch {
        // Non-fatal: proceed without explicit fingerprint
      }

      const response = await fetch('/api/auth/magic-link/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ token, deviceFingerprint, deviceName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify magic link');
      }

      setUser(data.user);
      setStatus('success');

      toast.success('Successfully signed in!', {
        description: 'Welcome to Postolio! Redirecting to dashboard...',
        icon: <CheckCircle />,
        duration: TIMEOUTS.TOAST_DURATION,
      });

      setTimeout(() => {
        navigate('/dashboard');
      }, TIMEOUTS.SUCCESS_REDIRECT);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to verify magic link');

      toast.error('Verification failed', {
        description: errorMessage,
        icon: <XCircle />,
      });
    }
  };

  const handleRetry = () => {
    navigate('/login');
  };

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl">
              {status === 'verifying' && 'Verifying your magic link...'}
              {status === 'success' && 'Success!'}
              {status === 'error' && 'Verification failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === 'verifying' && (
              <div className="flex flex-col items-center space-y-4">
                <Loader2 className="text-primary h-8 w-8 animate-spin" />
                <p className="text-muted-foreground text-center text-sm">
                  Please wait while we verify your magic link...
                </p>
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center space-y-4">
                <CheckCircle className="h-12 w-12" />
                <p className="text-center">
                  You've been successfully signed in!
                  <br />
                  Redirecting to your dashboard...
                </p>
              </div>
            )}

            {status === 'error' && (
              <>
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>

                <div className="space-y-3">
                  <p className="text-muted-foreground text-center text-sm">
                    The magic link may have expired or already been used. Please request a new one.
                  </p>

                  <Button onClick={handleRetry} className="w-full">
                    Back to sign in
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <SiteFooter />
    </div>
  );
}
