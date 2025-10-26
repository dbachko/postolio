import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { TIMEOUTS } from '@/constants/timeouts';

export function EmailVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  const token = searchParams.get('token');

  // Verify on token change (ignore verifyEmail dependency to avoid re-creation churn)
  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided');
      return;
    }

    verifyEmail(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const verifyEmail = async (token: string) => {
    try {
      const response = await fetch('/api/auth/email/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify email');
      }

      setStatus('success');

      toast.success('Email verified!', {
        description: 'Your email has been successfully verified.',
        icon: <CheckCircle />,
        duration: TIMEOUTS.TOAST_DURATION,
      });

      // Redirect to dashboard after a delay
      setTimeout(() => {
        navigate('/dashboard');
      }, TIMEOUTS.SUCCESS_REDIRECT);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to verify email');

      toast.error('Verification failed', {
        description: errorMessage,
        icon: <XCircle />,
      });
    }
  };

  const handleGoToDashboard = () => {
    navigate('/dashboard');
  };

  const handleResendEmail = () => {
    navigate('/settings');
  };

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl">
              {status === 'verifying' && 'Verifying your email...'}
              {status === 'success' && 'Email Verified!'}
              {status === 'error' && 'Verification Failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === 'verifying' && (
              <div className="flex flex-col items-center space-y-4">
                <Loader2 className="text-primary h-8 w-8 animate-spin" />
                <p className="text-muted-foreground text-center text-sm">
                  Please wait while we verify your email address...
                </p>
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center space-y-4">
                <div className="bg-muted rounded-full p-3">
                  <CheckCircle className="h-8 w-8" />
                </div>
                <div className="space-y-2 text-center">
                  <p className="font-medium">Your email has been successfully verified!</p>
                  <p className="text-muted-foreground text-sm">
                    You now have access to all Postolio features.
                  </p>
                </div>

                <div className="w-full space-y-2">
                  <Button onClick={handleGoToDashboard} className="w-full">
                    Go to Dashboard
                  </Button>
                </div>
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
                    The verification link may have expired or already been used. You can request a
                    new verification email from your account settings.
                  </p>

                  <div className="space-y-2">
                    <Button onClick={handleResendEmail} className="w-full" variant="outline">
                      <Mail className="mr-2 h-4 w-4" />
                      Request New Verification Email
                    </Button>

                    <Button onClick={handleGoToDashboard} className="w-full">
                      Continue to Dashboard
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="border-t px-4 py-6">
        <div className="text-muted-foreground flex items-center justify-center space-x-4 text-sm">
          <span>© {new Date().getFullYear()} Postolio</span>
        </div>
      </footer>
    </div>
  );
}
