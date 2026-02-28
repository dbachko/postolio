import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { TIMEOUTS } from '@/constants/timeouts';
import { SiteFooter } from '@/components/site-footer';

type VerifyStatus = 'verifying' | 'success' | 'error';

type VerifyState = {
  status: VerifyStatus;
  errorMessage: string;
};

function useEmailVerification(token: string | null, onVerified: () => void): VerifyState {
  const [status, setStatus] = useState<VerifyStatus>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided');
      return;
    }

    async function verifyEmail() {
      try {
        const response = await fetch('/api/auth/email/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        onVerified();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to verify email';
        setStatus('error');
        setErrorMessage(message);
        toast.error('Verification failed', {
          description: message,
          icon: <XCircle />,
        });
      }
    }

    void verifyEmail();
  }, [onVerified, token]);

  return { status, errorMessage };
}

function EmailVerifyStatusContent({
  status,
  errorMessage,
  onGoToDashboard,
  onResendEmail,
}: {
  status: VerifyStatus;
  errorMessage: string;
  onGoToDashboard: () => void;
  onResendEmail: () => void;
}) {
  if (status === 'verifying') {
    return (
      <div className="flex flex-col items-center space-y-4">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="text-muted-foreground text-center text-sm">
          Please wait while we verify your email address...
        </p>
      </div>
    );
  }

  if (status === 'success') {
    return (
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
        <Button onClick={onGoToDashboard} className="w-full">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <>
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertDescription>{errorMessage}</AlertDescription>
      </Alert>
      <div className="space-y-3">
        <p className="text-muted-foreground text-center text-sm">
          The verification link may have expired or already been used. You can request a new
          verification email from your account settings.
        </p>
        <div className="space-y-2">
          <Button onClick={onResendEmail} className="w-full" variant="outline">
            <Mail className="mr-2 h-4 w-4" />
            Request New Verification Email
          </Button>
          <Button onClick={onGoToDashboard} className="w-full">
            Continue to Dashboard
          </Button>
        </div>
      </div>
    </>
  );
}

export function EmailVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const handleGoToDashboard = () => {
    navigate('/dashboard');
  };
  const handleResendEmail = () => {
    navigate('/settings');
  };

  const verification = useEmailVerification(token, () => {
    setTimeout(() => {
      navigate('/dashboard');
    }, TIMEOUTS.SUCCESS_REDIRECT);
  });

  return (
    <div className="bg-background flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl">
              {verification.status === 'verifying' && 'Verifying your email...'}
              {verification.status === 'success' && 'Email Verified!'}
              {verification.status === 'error' && 'Verification Failed'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <EmailVerifyStatusContent
              status={verification.status}
              errorMessage={verification.errorMessage}
              onGoToDashboard={handleGoToDashboard}
              onResendEmail={handleResendEmail}
            />
          </CardContent>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
