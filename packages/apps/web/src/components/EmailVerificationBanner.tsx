import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { TIMEOUTS } from '@/constants/timeouts';
import { httpGet, httpPost } from '@/lib/api';

interface VerificationStatus {
  verified: boolean;
  email?: string;
  canResend: boolean;
}

export function EmailVerificationBanner() {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    try {
      const data = await httpGet('/api/auth/email/verification-status');
      setStatus(data);
      setHasError(false);
    } catch (error) {
      console.error('Failed to check verification status:', error);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  };

  const sendVerificationEmail = async () => {
    setIsSending(true);
    try {
      const data = await httpPost('/api/auth/email/send-verification', {});
      if (data?.success) {
        toast.success('Verification email sent!', {
          description: 'Check your inbox for the verification link.',
          icon: <CheckCircle className="text-foreground" />,
          duration: TIMEOUTS.TOAST_DURATION,
        });

        // Update status to reflect that email was sent
        setStatus((prev) => (prev ? { ...prev, canResend: false } : null));
      } else {
        toast.error('Failed to send email', {
          description: data?.error || 'Please try again later',
        });
      }
    } catch (e: any) {
      toast.error('Network error', {
        description: e?.message || 'Failed to send verification email',
      });
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return null;
  }

  // Fallback banner when we can't determine verification status
  if (hasError) {
    return (
      <Alert className="bg-card/95 rounded-none border-0 border-b shadow-sm">
        <AlertDescription className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="text-foreground flex min-w-0 items-center gap-2">
            <AlertCircle className="text-foreground h-4 w-4 flex-shrink-0" />
            <div className="truncate text-sm">
              <span className="font-medium">We couldn&apos;t check your verification status.</span>
              <span className="text-muted-foreground ml-2">
                You can request a new verification email from your account settings.
              </span>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Don't show banner if verified or no status
  if (!status || status.verified) {
    return null;
  }

  return (
    <Alert className="bg-card/95 rounded-none border-0 border-b shadow-sm">
      <AlertDescription className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: message */}
        <div className="text-foreground flex min-w-0 items-center gap-2">
          <Mail className="text-foreground h-4 w-4 flex-shrink-0" />
          <div className="truncate text-sm">
            <span className="font-medium">Verify your email to unlock all features</span>
            <span className="text-muted-foreground ml-2">
              Check your inbox for {status.email} or request a new verification email.
            </span>
          </div>
        </div>

        {/* Right: action */}
        <div className="flex flex-shrink-0 items-center gap-2">
          {status.canResend && (
            <Button
              size="sm"
              variant="secondary"
              onClick={sendVerificationEmail}
              disabled={isSending}
              className="hover:bg-muted"
            >
              {isSending ? (
                <>
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-3 w-3" />
                  Resend Email
                </>
              )}
            </Button>
          )}
          {!status.canResend && !isSending && (
            <span className="text-muted-foreground text-sm">Email sent! Check your inbox</span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
