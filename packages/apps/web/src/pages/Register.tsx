import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PasswordStrengthMeter } from '@/components/PasswordStrengthMeter';
import { FormField } from '@/components/forms/FormField';
import { GoogleSignInIsolated } from '@/components/auth/GoogleSignInIsolated';
import { FacebookSignInIsolated } from '@/components/auth/FacebookSignInIsolated';
import { MagicLinkForm } from '@/components/auth/MagicLinkForm';
import { validationRules } from '../utils/validation';
import { TIMEOUTS } from '../constants/timeouts';
import { getUserTimezone } from '../lib/timezone';
import { Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

interface RegisterFormData {
  email: string;
  password: string;
  name: string;
}

export function Register() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showMagicLink, setShowMagicLink] = useState(false);

  const { register: registerUser } = useAuthStore();
  const navigate = useNavigate();

  // Feature flags via env
  const googleEnabled = import.meta.env.VITE_AUTH_GOOGLE_ENABLED !== 'false';
  const facebookEnabled = import.meta.env.VITE_AUTH_FACEBOOK_ENABLED !== 'false';
  const magicLinkEnabled = import.meta.env.VITE_AUTH_MAGIC_LINK_ENABLED !== 'false';
  const googleConfigured = !!(
    import.meta.env.VITE_GOOGLE_CLIENT_ID && import.meta.env.VITE_GOOGLE_CLIENT_ID !== ''
  );
  const facebookConfigured = !!(
    import.meta.env.VITE_FACEBOOK_APP_ID && import.meta.env.VITE_FACEBOOK_APP_ID !== ''
  );
  const showGoogle = googleEnabled && googleConfigured;
  const showFacebook = facebookEnabled && facebookConfigured;
  const showOAuthProviders = showGoogle || showFacebook;

  // UI messaging for signup restrictions (server enforces)
  const signupsMode = (import.meta.env.VITE_SIGNUPS_MODE || 'open') as
    | 'open'
    | 'closed'
    | 'allowlist'
    | 'invite_only';
  const waitlistUrl = import.meta.env.VITE_WAITLIST_URL as string | undefined;

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<RegisterFormData>({
    mode: 'onChange', // Real-time validation
    reValidateMode: 'onChange',
  });

  const password = watch('password', '');

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    setError('');

    try {
      // Auto-detect user timezone
      const timezone = getUserTimezone();

      await registerUser(data.email, data.password, data.name, timezone);
      toast.success('Account created successfully!', {
        description: 'Welcome to Postolio! Redirecting to dashboard...',
        icon: <CheckCircle className="text-foreground" />,
        duration: TIMEOUTS.TOAST_DURATION,
      });
      setTimeout(() => navigate('/dashboard'), TIMEOUTS.SUCCESS_REDIRECT);
    } catch (error: unknown) {
      // Type-safe error handling
      const apiError = error as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      const message =
        apiError?.response?.data?.message ||
        apiError?.message ||
        'Registration failed. Please try again.';
      setError(message);
      toast.error('Registration failed', {
        description: message,
        icon: <AlertCircle className="text-destructive" />,
        duration: TIMEOUTS.TOAST_DURATION,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-background flex min-h-screen flex-col">
      {/* Main content */}
      <div className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl">Create your account</CardTitle>
            <CardDescription className="text-center">
              Or{' '}
              <Link to="/login" className="text-primary font-medium hover:underline">
                sign in to your existing account
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Access control notice */}
            {signupsMode !== 'open' && (
              <Alert className="mb-6">
                <AlertDescription>
                  {signupsMode === 'closed' && (
                    <>
                      Signups are currently closed.{' '}
                      {waitlistUrl ? (
                        <a href={waitlistUrl} className="text-primary underline">
                          Join the waitlist
                        </a>
                      ) : (
                        'Please contact us for access.'
                      )}
                    </>
                  )}
                  {signupsMode === 'allowlist' && (
                    <>
                      Invite-only access. Use an allowlisted email to sign up.{' '}
                      {waitlistUrl && (
                        <a href={waitlistUrl} className="text-primary underline">
                          Request an invite
                        </a>
                      )}
                      .
                    </>
                  )}
                  {signupsMode === 'invite_only' && (
                    <>
                      Registration requires an invite.{' '}
                      {waitlistUrl && (
                        <a href={waitlistUrl} className="text-primary underline">
                          Request access
                        </a>
                      )}
                      .
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {/* OAuth Providers */}
            {showOAuthProviders && (
              <div className="mb-6 space-y-3">
                {showGoogle && <GoogleSignInIsolated mode="signup" />}
                {showFacebook && <FacebookSignInIsolated mode="signup" />}
              </div>
            )}

            {/* Divider */}
            {showOAuthProviders && (
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background text-muted-foreground px-2">Or continue with</span>
                </div>
              </div>
            )}

            {/* Magic Link Option */}
            {magicLinkEnabled && showMagicLink ? (
              <>
                <MagicLinkForm mode="signup" onSuccess={() => navigate('/dashboard')} />
                <div className="mt-4 text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowMagicLink(false)}
                  >
                    Use email and password instead
                  </Button>
                </div>
              </>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Name Field - Optional, moved to progressive disclosure */}
                <FormField
                  label="Full Name"
                  htmlFor="name"
                  error={errors.name?.message}
                  required={false}
                >
                  <Input
                    id="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Enter your full name"
                    {...register('name', validationRules.name)}
                    aria-invalid={!!errors.name}
                  />
                </FormField>

                {/* Email Field with validation */}
                <FormField
                  label="Email address"
                  htmlFor="email"
                  error={errors.email?.message}
                  required={true}
                >
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    spellCheck="false"
                    autoCapitalize="off"
                    placeholder="Enter your email"
                    {...register('email', validationRules.email)}
                    aria-invalid={!!errors.email}
                    className={errors.email ? 'border-destructive' : ''}
                  />
                </FormField>

                {/* Password Field with strength meter */}
                <FormField
                  label="Password"
                  htmlFor="password"
                  error={errors.password?.message}
                  required={true}
                >
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Enter password or passphrase"
                      {...register('password', validationRules.password)}
                      aria-invalid={!!errors.password}
                      className={errors.password ? 'border-destructive' : ''}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 min-h-[44px] min-w-[44px] -translate-y-1/2 p-2"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </Button>
                  </div>
                  <PasswordStrengthMeter password={password} />
                </FormField>

                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? 'Creating account...' : 'Create account'}
                </Button>

                {/* Magic Link Alternative */}
                {magicLinkEnabled && (
                  <div className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMagicLink(true)}
                    >
                      Or sign up with magic link (no password)
                    </Button>
                  </div>
                )}

                {/* Privacy Policy Notice */}
                <div className="text-muted-foreground mt-4 text-center text-xs">
                  By creating an account, you agree to our{' '}
                  <Link to="/privacy-policy" className="text-primary hover:underline">
                    Privacy Policy
                  </Link>{' '}
                  and{' '}
                  <Link to="/terms-of-service" className="text-primary hover:underline">
                    Terms of Service
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <footer className="border-t px-4 py-6">
        <div className="text-muted-foreground flex items-center justify-center space-x-4 text-sm">
          <span>© {new Date().getFullYear()} Postolio</span>
          <span>•</span>
          <Link to="/privacy-policy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <span>•</span>
          <Link to="/terms-of-service" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <span>•</span>
          <a href="mailto:legal@postolio.example" className="hover:text-foreground transition-colors">
            Legal
          </a>
        </div>
      </footer>
    </div>
  );
}
