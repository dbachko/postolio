import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Mail, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { TIMEOUTS } from '@/constants/timeouts';

interface MagicLinkFormProps {
  mode: 'signin' | 'signup';
  onSuccess?: () => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function isMagicLinkConfigured() {
  try {
    const response = await fetch('/api/auth/magic-link/status');
    const data = await response.json();
    return Boolean(data.configured);
  } catch {
    return false;
  }
}

async function sendMagicLinkRequest(email: string, mode: MagicLinkFormProps['mode']) {
  const response = await fetch('/api/auth/magic-link/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      isSignUp: mode === 'signup',
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to send magic link');
  }
}

function SentState({
  email,
  mode,
  onRetry,
}: {
  email: string;
  mode: MagicLinkFormProps['mode'];
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      <Alert>
        <Mail className="h-4 w-4" />
        <AlertDescription>
          <strong>Check your email!</strong>
          <br />
          We've sent a magic link to <strong>{email}</strong>
          <br />
          Click the link in the email to {mode === 'signup' ? 'complete registration' : 'sign in'}.
          <br />
          <span className="text-sm">The link expires in 15 minutes.</span>
        </AlertDescription>
      </Alert>

      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-sm">Didn't receive the email?</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again with a different email
        </Button>
      </div>
    </div>
  );
}

function SubmitButton({ isLoading }: { isLoading: boolean }) {
  return (
    <Button type="submit" disabled={isLoading} className="w-full">
      {isLoading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Sending magic link...
        </>
      ) : (
        <>
          <Mail className="mr-2 h-4 w-4" />
          Send magic link
        </>
      )}
    </Button>
  );
}

export function MagicLinkForm({ mode, onSuccess }: MagicLinkFormProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setError('Please enter your email address');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsLoading(true);
    setError('');

    const isConfigured = await isMagicLinkConfigured();
    if (!isConfigured) {
      setError('Magic link authentication is not configured. Please use another sign-in method.');
      setIsLoading(false);
      return;
    }

    try {
      await sendMagicLinkRequest(email, mode);

      setIsSent(true);
      toast.success('Magic link sent!', {
        description: 'Check your email to continue',
        icon: <CheckCircle />,
        duration: TIMEOUTS.TOAST_DURATION,
      });

      onSuccess?.();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to send magic link';
      setError(errorMsg);
      toast.error('Failed to send magic link', {
        description: errorMsg,
        icon: <AlertCircle />,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = () => {
    setIsSent(false);
    setEmail('');
  };

  if (isSent) {
    return <SentState email={email} mode={mode} onRetry={handleResend} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Input
          type="email"
          placeholder="Enter your email address"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          autoComplete="email"
          autoFocus
          className="w-full"
        />
      </div>

      <SubmitButton isLoading={isLoading} />

      <p className="text-muted-foreground text-center text-xs">
        We'll email you a secure link to {mode === 'signup' ? 'create your account' : 'sign in'}. No
        password needed!
      </p>
    </form>
  );
}
