import { Eye, EyeOff } from 'lucide-react';
import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { FacebookSignInIsolated } from '@/components/auth/facebook-sign-in-isolated';
import { GoogleSignInIsolated } from '@/components/auth/google-sign-in-isolated';
import { MagicLinkForm } from '@/components/auth/magic-link-form';
import { FormField } from '@/components/forms/form-field';
import { PasswordStrengthMeter } from '@/components/password-strength-meter';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

import type { RegisterFormData } from './use-register-submit';
import type { RegisterAuthFlags } from './register-auth-flags';

function AccessControlNotice(props: { flags: RegisterAuthFlags }) {
  if (props.flags.signupsMode === 'open') {
    return null;
  }

  const waitlistLink = props.flags.waitlistUrl ? (
    <a href={props.flags.waitlistUrl} className="text-primary underline">
      {props.flags.signupsMode === 'closed' ? 'Join the waitlist' : 'Request access'}
    </a>
  ) : null;

  return (
    <Alert className="mb-6">
      <AlertDescription>
        {props.flags.signupsMode === 'closed' ? (
          <>Signups are currently closed. {waitlistLink || 'Please contact us for access.'}</>
        ) : null}
        {props.flags.signupsMode === 'allowlist' ? (
          <>Invite-only access. Use an allowlisted email to sign up. {waitlistLink}.</>
        ) : null}
        {props.flags.signupsMode === 'invite_only' ? (
          <>Registration requires an invite. {waitlistLink}.</>
        ) : null}
      </AlertDescription>
    </Alert>
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
        {props.showGoogle ? <GoogleSignInIsolated mode="signup" /> : null}
        {props.showFacebook ? <FacebookSignInIsolated mode="signup" /> : null}
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

function RegisterPasswordField(props: {
  showPassword: boolean;
  password: string;
  register: UseFormRegister<RegisterFormData>;
  errors: FieldErrors<RegisterFormData>;
  onToggle: () => void;
  passwordRules: Parameters<UseFormRegister<RegisterFormData>>[1];
}) {
  return (
    <FormField label="Password" htmlFor="password" error={props.errors.password?.message} required>
      <div className="relative">
        <Input
          id="password"
          type={props.showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Enter password or passphrase"
          {...props.register('password', props.passwordRules)}
          aria-invalid={Boolean(props.errors.password)}
          className={props.errors.password ? 'border-destructive' : ''}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={props.onToggle}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 min-h-[44px] min-w-[44px] -translate-y-1/2 p-2"
          aria-label={props.showPassword ? 'Hide password' : 'Show password'}
        >
          {props.showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
        </Button>
      </div>
      <PasswordStrengthMeter password={props.password} />
    </FormField>
  );
}

interface RegisterFormProps {
  error: string;
  isLoading: boolean;
  showPassword: boolean;
  magicLinkEnabled: boolean;
  password: string;
  register: UseFormRegister<RegisterFormData>;
  errors: FieldErrors<RegisterFormData>;
  nameRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  emailRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  passwordRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  onTogglePassword: () => void;
  onSubmit: () => void;
  onShowMagicLink: () => void;
}

function RegisterForm(props: RegisterFormProps) {
  return (
    <>
      {props.error ? (
        <Alert variant="destructive">
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}

      <FormField
        label="Full Name"
        htmlFor="name"
        error={props.errors.name?.message}
        required={false}
      >
        <Input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="Enter your full name"
          {...props.register('name', props.nameRules)}
          aria-invalid={Boolean(props.errors.name)}
        />
      </FormField>

      <FormField label="Email address" htmlFor="email" error={props.errors.email?.message} required>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          spellCheck="false"
          autoCapitalize="off"
          placeholder="Enter your email"
          {...props.register('email', props.emailRules)}
          aria-invalid={Boolean(props.errors.email)}
          className={props.errors.email ? 'border-destructive' : ''}
        />
      </FormField>

      <RegisterPasswordField
        showPassword={props.showPassword}
        password={props.password}
        register={props.register}
        errors={props.errors}
        onToggle={props.onTogglePassword}
        passwordRules={props.passwordRules}
      />

      <Button type="submit" disabled={props.isLoading} className="w-full" onClick={props.onSubmit}>
        {props.isLoading ? 'Creating account...' : 'Create account'}
      </Button>

      {props.magicLinkEnabled ? (
        <div className="text-center">
          <Button type="button" variant="ghost" size="sm" onClick={props.onShowMagicLink}>
            Or sign up with magic link (no password)
          </Button>
        </div>
      ) : null}

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
    </>
  );
}

interface RegisterPageContentProps {
  flags: RegisterAuthFlags;
  error: string;
  isLoading: boolean;
  showPassword: boolean;
  showMagicLink: boolean;
  password: string;
  register: UseFormRegister<RegisterFormData>;
  errors: FieldErrors<RegisterFormData>;
  nameRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  emailRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  passwordRules: Parameters<UseFormRegister<RegisterFormData>>[1];
  onTogglePassword: () => void;
  onSubmit: () => void;
  onShowMagicLinkChange: (show: boolean) => void;
  onMagicLinkSuccess: () => void;
}

export function RegisterPageContent(props: RegisterPageContentProps) {
  return (
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
        <AccessControlNotice flags={props.flags} />
        <OAuthSection
          showGoogle={props.flags.showGoogle}
          showFacebook={props.flags.showFacebook}
          showOAuthProviders={props.flags.showOAuthProviders}
        />

        {props.flags.magicLinkEnabled && props.showMagicLink ? (
          <>
            <MagicLinkForm mode="signup" onSuccess={props.onMagicLinkSuccess} />
            <div className="mt-4 text-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => props.onShowMagicLinkChange(false)}
              >
                Use email and password instead
              </Button>
            </div>
          </>
        ) : (
          <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
            <RegisterForm
              error={props.error}
              isLoading={props.isLoading}
              showPassword={props.showPassword}
              magicLinkEnabled={props.flags.magicLinkEnabled}
              password={props.password}
              register={props.register}
              errors={props.errors}
              nameRules={props.nameRules}
              emailRules={props.emailRules}
              passwordRules={props.passwordRules}
              onTogglePassword={props.onTogglePassword}
              onSubmit={props.onSubmit}
              onShowMagicLink={() => props.onShowMagicLinkChange(true)}
            />
          </form>
        )}
      </CardContent>
    </Card>
  );
}
