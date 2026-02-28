import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { GoogleSignInIsolated } from '@/components/auth/google-sign-in-isolated';
import { FacebookSignInIsolated } from '@/components/auth/facebook-sign-in-isolated';
import { MagicLinkForm } from '@/components/auth/magic-link-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { LoginAuthFlags } from './login-auth-flags';

interface CredentialsFormProps {
  email: string;
  password: string;
  rememberMe: boolean;
  isLoading: boolean;
  error: string;
  magicLinkEnabled: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberMeChange: (checked: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onShowMagicLink: () => void;
}

function CredentialsForm(props: CredentialsFormProps) {
  return (
    <form className="space-y-4" onSubmit={props.onSubmit}>
      {props.error ? (
        <Alert variant="destructive">
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={props.email}
          onChange={(event) => props.onEmailChange(event.target.value)}
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
          value={props.password}
          onChange={(event) => props.onPasswordChange(event.target.value)}
          placeholder="Enter your password"
        />
      </div>

      <div className="flex items-center space-x-2">
        <Checkbox
          id="remember"
          checked={props.rememberMe}
          onCheckedChange={(checked) => props.onRememberMeChange(checked as boolean)}
        />
        <Label htmlFor="remember" className="cursor-pointer text-sm font-normal">
          Remember me for 30 days
        </Label>
      </div>

      <Button type="submit" disabled={props.isLoading} className="w-full">
        {props.isLoading ? 'Signing in...' : 'Sign in'}
      </Button>

      {props.magicLinkEnabled ? (
        <div className="mt-4 text-center">
          <Button type="button" variant="ghost" size="sm" onClick={props.onShowMagicLink}>
            Or sign in with magic link (no password)
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function SignupNotice(props: { flags: LoginAuthFlags }) {
  if (props.flags.signupsMode === 'open') {
    return null;
  }

  return (
    <div className="text-muted-foreground text-center text-xs">
      Don’t have access?{' '}
      {props.flags.waitlistUrl ? (
        <a href={props.flags.waitlistUrl} className="text-primary underline">
          Request invite
        </a>
      ) : (
        'Contact us for access.'
      )}
    </div>
  );
}

function OAuthSection(props: {
  showGoogle: boolean;
  showFacebook: boolean;
  showOAuthProviders: boolean;
}) {
  if (!props.showOAuthProviders) {
    return null;
  }

  return (
    <>
      <div className="mb-6 space-y-3">
        {props.showGoogle ? <GoogleSignInIsolated mode="signin" /> : null}
        {props.showFacebook ? <FacebookSignInIsolated mode="signin" /> : null}
      </div>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background text-muted-foreground px-2">Or continue with</span>
        </div>
      </div>
    </>
  );
}

function MagicLinkSection(props: { onBack: () => void; onSuccess: () => void }) {
  return (
    <>
      <MagicLinkForm mode="signin" onSuccess={props.onSuccess} />
      <div className="mt-4 text-center">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          Use email and password instead
        </Button>
      </div>
    </>
  );
}

interface LoginPageContentProps {
  email: string;
  password: string;
  rememberMe: boolean;
  isLoading: boolean;
  error: string;
  showMagicLink: boolean;
  flags: LoginAuthFlags;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onRememberMeChange: (checked: boolean) => void;
  onShowMagicLinkChange: (show: boolean) => void;
  onSubmit: (event: FormEvent) => void;
  onMagicLinkSuccess: () => void;
}

export function LoginPageContent(props: LoginPageContentProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-center text-2xl">Sign in to your account</CardTitle>
        {props.flags.showRegisterLink ? (
          <CardDescription className="text-center">
            Or{' '}
            <Link to="/register" className="text-primary font-medium hover:underline">
              create a new account
            </Link>
          </CardDescription>
        ) : null}
        <SignupNotice flags={props.flags} />
      </CardHeader>
      <CardContent>
        <OAuthSection
          showGoogle={props.flags.showGoogle}
          showFacebook={props.flags.showFacebook}
          showOAuthProviders={props.flags.showOAuthProviders}
        />

        {props.flags.magicLinkEnabled && props.showMagicLink ? (
          <MagicLinkSection
            onBack={() => props.onShowMagicLinkChange(false)}
            onSuccess={props.onMagicLinkSuccess}
          />
        ) : (
          <CredentialsForm
            email={props.email}
            password={props.password}
            rememberMe={props.rememberMe}
            isLoading={props.isLoading}
            error={props.error}
            magicLinkEnabled={props.flags.magicLinkEnabled}
            onEmailChange={props.onEmailChange}
            onPasswordChange={props.onPasswordChange}
            onRememberMeChange={props.onRememberMeChange}
            onSubmit={props.onSubmit}
            onShowMagicLink={() => props.onShowMagicLinkChange(true)}
          />
        )}
      </CardContent>
    </Card>
  );
}
