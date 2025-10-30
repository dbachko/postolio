import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { GoogleSignInIsolated } from '@/components/auth/GoogleSignInIsolated';
import { FacebookSignInIsolated } from '@/components/auth/FacebookSignInIsolated';
import { MagicLinkForm } from '@/components/auth/MagicLinkForm';
import { SiteFooter } from '@/components/SiteFooter';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showMagicLink, setShowMagicLink] = useState(false);

  const { login } = useAuthStore();
  const navigate = useNavigate();

  // Feature flags via env (GitHub Actions / Vite env)
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

  // UI: hide register link when signups are restricted
  const signupsMode = (import.meta.env.VITE_SIGNUPS_MODE || 'open') as
    | 'open'
    | 'closed'
    | 'allowlist'
    | 'invite_only';
  const showRegisterLink = signupsMode === 'open';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      await login(email, password, rememberMe);
      navigate('/dashboard');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      // Only show invalid-credentials copy when backend actually says so; otherwise show server error
      setError(message || 'Internal server error. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="bg-background flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-2xl">Sign in to your account</CardTitle>
            {showRegisterLink && (
              <CardDescription className="text-center">
                Or{' '}
                <Link to="/register" className="text-primary font-medium hover:underline">
                  create a new account
                </Link>
              </CardDescription>
            )}
            {signupsMode !== 'open' && (
              <div className="text-muted-foreground text-center text-xs">
                Don’t have access?{' '}
                {(import.meta.env.VITE_WAITLIST_URL as string | undefined) ? (
                  <a
                    href={(import.meta.env.VITE_WAITLIST_URL as string) || '#'}
                    className="text-primary underline"
                  >
                    Request invite
                  </a>
                ) : (
                  'Contact us for access.'
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {/* OAuth Providers */}
            {showOAuthProviders && (
              <div className="mb-6 space-y-3">
                {showGoogle && <GoogleSignInIsolated mode="signin" />}
                {showFacebook && <FacebookSignInIsolated mode="signin" />}
              </div>
            )}

            {/* Divider (only when OAuth shown) */}
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
                <MagicLinkForm mode="signin" onSuccess={() => navigate('/dashboard')} />
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
              <form className="space-y-4" onSubmit={handleSubmit}>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link to="/password/reset" className="text-primary text-sm hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  />
                  <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
                    Remember me for 30 days
                  </Label>
                </div>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? 'Signing in...' : 'Sign in'}
                </Button>

                {/* Magic Link Alternative */}
                {magicLinkEnabled && (
                  <div className="mt-4 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMagicLink(true)}
                    >
                      Or sign in with magic link (no password)
                    </Button>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <SiteFooter />
    </div>
  );
}
