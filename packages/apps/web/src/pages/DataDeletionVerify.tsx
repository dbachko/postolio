import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type VerificationStatus = 'idle' | 'verifying' | 'success' | 'error';

type VerificationState = {
  status: VerificationStatus;
  message: string;
  error: string;
  recoveryDeadline: string | null;
};

function useDataDeletionVerification(token: string | null): VerificationState {
  const [status, setStatus] = useState<VerificationStatus>('idle');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [recoveryDeadline, setRecoveryDeadline] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('Missing or invalid verification token.');
      return;
    }

    async function verifyRequest() {
      setStatus('verifying');
      setError('');

      try {
        const response = await fetch(`${API_BASE_URL}/api/legal/data-deletion-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || 'Failed to verify deletion request.');
        }
        setMessage(data.message || 'Your data deletion request has been confirmed successfully.');
        setRecoveryDeadline(data.recoveryDeadline || null);
        setStatus('success');
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to verify deletion request. Please try again.'
        );
        setStatus('error');
      }
    }

    void verifyRequest();
  }, [token]);

  return { status, message, error, recoveryDeadline };
}

function VerificationContent({ status, message, error, recoveryDeadline }: VerificationState) {
  const isVerifying = status === 'verifying' || status === 'idle';

  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 py-8">
        <div className="border-border h-10 w-10 animate-spin rounded-full border-b-2" />
        <p className="text-muted-foreground text-sm">Verifying your data deletion request...</p>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="space-y-4">
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        {recoveryDeadline ? (
          <p className="text-muted-foreground text-sm">
            If you change your mind, you may be able to recover your account until{' '}
            <span className="text-foreground font-medium">{recoveryDeadline}</span>.
          </p>
        ) : null}
        <p className="text-muted-foreground text-sm">
          We will now process your deletion request in accordance with our privacy policy.
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/login">Go to Login</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/privacy-policy">View Privacy Policy</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
      <p className="text-muted-foreground text-sm">
        If this link has expired or you continue to see this message, please submit a new request
        from our data deletion page or contact us at{' '}
        <a href="mailto:privacy@postolio.example" className="text-primary hover:underline">
          privacy@postolio.example
        </a>
        .
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link to="/legal/data-deletion">Open Data Deletion Page</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/privacy-policy">View Privacy Policy</Link>
        </Button>
      </div>
    </div>
  );
}

export function DataDeletionVerify() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const verification = useDataDeletionVerification(token);

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col p-6">
      <div className="mb-6">
        <Link
          to="/"
          className="text-primary inline-flex items-center transition-colors hover:underline"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Postolio
        </Link>
      </div>
      <Card>
        <CardContent className="pt-6">
          <VerificationContent {...verification} />
        </CardContent>
      </Card>
    </div>
  );
}
