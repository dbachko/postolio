import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

type RecoverFormProps = {
  email: string;
  password: string;
  error: string;
  isSubmitting: boolean;
  onSubmit: (event: FormEvent) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
};

function RecoverForm({
  email,
  password,
  error,
  isSubmitting,
  onSubmit,
  onEmailChange,
  onPasswordChange,
}: RecoverFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="Enter the email you used with Postolio"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Enter your account password"
          required
        />
      </div>

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? 'Recovering...' : 'Recover Account'}
      </Button>

      <div className="text-center">
        <Link to="/login" className="text-primary text-sm hover:underline">
          Back to Login
        </Link>
      </div>
    </form>
  );
}

function RecoverSuccess({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <Alert>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Link to="/login">
        <Button className="w-full">Go to Login</Button>
      </Link>
    </div>
  );
}

export function AccountRecover() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRecover = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/legal/account-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to recover account');
      }
      setSuccess(data.message || 'Account successfully recovered.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recover account');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Recover Your Account</CardTitle>
          <CardDescription>
            If your account was scheduled for deletion within the last 30 days, you can recover it
            by confirming your email and password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {success ? (
            <RecoverSuccess message={success} />
          ) : (
            <RecoverForm
              email={email}
              password={password}
              error={error}
              isSubmitting={isSubmitting}
              onSubmit={handleRecover}
              onEmailChange={setEmail}
              onPasswordChange={setPassword}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AccountRecover;
