import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Mail, X, CheckCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { TIMEOUTS } from '@/constants/timeouts';

interface VerificationStatus {
  verified: boolean;
  email?: string;
  canResend: boolean;
}

export function EmailVerificationBanner() {
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkVerificationStatus();
  }, []);

  const checkVerificationStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const response = await fetch('/api/auth/email/verification-status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);

        // Check if user has previously dismissed the banner
        const dismissedKey = `email-verification-dismissed-${data.email}`;
        const wasDismissed = localStorage.getItem(dismissedKey);
        if (wasDismissed) {
          setDismissed(true);
        }
      }
    } catch (error) {
      console.error('Failed to check verification status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const sendVerificationEmail = async () => {
    setIsSending(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/auth/email/send-verification', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        toast.success('Verification email sent!', {
          description: 'Check your inbox for the verification link.',
          icon: <CheckCircle className="text-foreground" />,
          duration: TIMEOUTS.TOAST_DURATION,
        });

        // Update status to reflect that email was sent
        setStatus((prev) => (prev ? { ...prev, canResend: false } : null));
      } else {
        toast.error('Failed to send email', {
          description: data.error || 'Please try again later',
        });
      }
    } catch {
      toast.error('Network error', {
        description: 'Failed to send verification email',
      });
    } finally {
      setIsSending(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    // Remember dismissal in localStorage
    if (status?.email) {
      const dismissedKey = `email-verification-dismissed-${status.email}`;
      localStorage.setItem(dismissedKey, 'true');
    }
  };

  // Don't show banner if loading, verified, or dismissed
  if (isLoading || !status || status.verified || dismissed) {
    return null;
  }

  return (
    <div className="border-b p-4">
      <Alert className="mx-auto max-w-7xl bg-transparent">
        <Mail className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <div className="flex-1">
            <span className="font-medium">Verify your email to unlock all features</span>
            <span className="text-muted-foreground ml-2">
              Check your inbox for {status.email} or request a new verification email.
            </span>
          </div>
          <div className="ml-4 flex items-center gap-2">
            {status.canResend && (
              <Button
                size="sm"
                variant="outline"
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
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="hover:bg-muted p-1"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    </div>
  );
}
