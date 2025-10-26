import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Check, X } from 'lucide-react';

export function PasswordReset() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  // Request reset state
  const [email, setEmail] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [requestSuccess, setRequestSuccess] = useState(false);

  // Reset password state
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenEmail, setTokenEmail] = useState<string>('');

  // Password strength indicators
  const [passwordStrength, setPasswordStrength] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
  });

  // Validate token on mount if present
  // Validate token on change (ignore validateToken dependency intentionally)
  useEffect(() => {
    if (token) {
      validateToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Update password strength as user types
  useEffect(() => {
    setPasswordStrength({
      length: password.length >= 15,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
    });
  }, [password]);

  const validateToken = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/auth/password/reset-validate/${token}`
      );
      const data = await response.json();
      setTokenValid(data.valid);
      if (data.email) {
        setTokenEmail(data.email);
      }
    } catch {
      setTokenValid(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRequesting(true);
    setRequestError('');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/auth/password/reset-request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send reset email');
      }

      setRequestSuccess(true);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      setResetError("Passwords don't match");
      return;
    }

    if (!Object.values(passwordStrength).every(Boolean)) {
      setResetError('Password does not meet all requirements');
      return;
    }

    setIsResetting(true);
    setResetError('');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/auth/password/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password, confirmPassword }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      // Success! Redirect to login
      navigate('/login', {
        state: {
          message: 'Password reset successfully! Please log in with your new password.',
        },
      });
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setIsResetting(false);
    }
  };

  // If we have a token, show the reset form
  if (token) {
    if (tokenValid === false) {
      return (
        <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Invalid or Expired Link</CardTitle>
              <CardDescription>This password reset link is invalid or has expired.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertDescription>
                  Password reset links expire after 1 hour for security reasons.
                </AlertDescription>
              </Alert>
              <Link to="/password/reset">
                <Button className="w-full">Request New Reset Link</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Reset Your Password</CardTitle>
            <CardDescription>
              {tokenEmail && `Resetting password for ${tokenEmail}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetPassword} className="space-y-4">
              {resetError && (
                <Alert variant="destructive">
                  <AlertDescription>{resetError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter new password"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                />
              </div>

              {/* Password strength indicators */}
              <div className="space-y-2">
                <div className="text-muted-foreground text-sm">Password requirements:</div>
                <div className="space-y-1">
                  <div
                    className={`flex items-center text-sm ${passwordStrength.length ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {passwordStrength.length ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <X className="mr-2 h-4 w-4" />
                    )}
                    At least 15 characters
                  </div>
                  <div
                    className={`flex items-center text-sm ${passwordStrength.uppercase ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {passwordStrength.uppercase ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <X className="mr-2 h-4 w-4" />
                    )}
                    One uppercase letter
                  </div>
                  <div
                    className={`flex items-center text-sm ${passwordStrength.lowercase ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {passwordStrength.lowercase ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <X className="mr-2 h-4 w-4" />
                    )}
                    One lowercase letter
                  </div>
                  <div
                    className={`flex items-center text-sm ${passwordStrength.number ? 'text-foreground' : 'text-muted-foreground'}`}
                  >
                    {passwordStrength.number ? (
                      <Check className="mr-2 h-4 w-4" />
                    ) : (
                      <X className="mr-2 h-4 w-4" />
                    )}
                    One number
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isResetting || !Object.values(passwordStrength).every(Boolean)}
                className="w-full"
              >
                {isResetting ? 'Resetting...' : 'Reset Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Otherwise show the request form
  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Forgot Your Password?</CardTitle>
          <CardDescription>
            Enter your email address and we'll send you a link to reset your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requestSuccess ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Password reset link sent! Check your email to continue.
                </AlertDescription>
              </Alert>
              <div className="text-muted-foreground text-sm">
                Didn't receive the email? Check your spam folder or try again.
              </div>
              <Link to="/login">
                <Button variant="outline" className="w-full">
                  Back to Login
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleRequestReset} className="space-y-4">
              {requestError && (
                <Alert variant="destructive">
                  <AlertDescription>{requestError}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>

              <Button type="submit" disabled={isRequesting} className="w-full">
                {isRequesting ? 'Sending...' : 'Send Reset Link'}
              </Button>

              <div className="text-center">
                <Link to="/login" className="text-primary text-sm hover:underline">
                  Back to Login
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
