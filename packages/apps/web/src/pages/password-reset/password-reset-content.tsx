import { Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import type { PasswordStrength } from './password-reset-types';

function PasswordRequirement(props: { met: boolean; label: string }) {
  return (
    <div
      className={`flex items-center text-sm ${props.met ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      {props.met ? <Check className="mr-2 h-4 w-4" /> : <X className="mr-2 h-4 w-4" />}
      {props.label}
    </div>
  );
}

function PasswordRequirements(props: { strength: PasswordStrength }) {
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground text-sm">Password requirements:</div>
      <div className="space-y-1">
        <PasswordRequirement met={props.strength.length} label="At least 15 characters" />
        <PasswordRequirement met={props.strength.uppercase} label="One uppercase letter" />
        <PasswordRequirement met={props.strength.lowercase} label="One lowercase letter" />
        <PasswordRequirement met={props.strength.number} label="One number" />
      </div>
    </div>
  );
}

export function PasswordResetInvalidTokenView() {
  return (
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
  );
}

interface PasswordResetTokenFormProps {
  tokenEmail: string;
  password: string;
  confirmPassword: string;
  isResetting: boolean;
  resetError: string;
  canSubmitReset: boolean;
  passwordStrength: PasswordStrength;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function PasswordResetTokenForm(props: PasswordResetTokenFormProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Reset Your Password</CardTitle>
        <CardDescription>
          {props.tokenEmail ? `Resetting password for ${props.tokenEmail}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={props.onSubmit} className="space-y-4">
          {props.resetError ? (
            <Alert variant="destructive">
              <AlertDescription>{props.resetError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="password">New Password</Label>
            <Input
              id="password"
              type="password"
              value={props.password}
              onChange={(event) => props.onPasswordChange(event.target.value)}
              placeholder="Enter new password"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={props.confirmPassword}
              onChange={(event) => props.onConfirmPasswordChange(event.target.value)}
              placeholder="Confirm new password"
              required
            />
          </div>

          <PasswordRequirements strength={props.passwordStrength} />

          <Button
            type="submit"
            disabled={props.isResetting || !props.canSubmitReset}
            className="w-full"
          >
            {props.isResetting ? 'Resetting...' : 'Reset Password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface PasswordResetRequestFormProps {
  requestSuccess: boolean;
  requestError: string;
  email: string;
  isRequesting: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function PasswordResetRequestForm(props: PasswordResetRequestFormProps) {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Forgot Your Password?</CardTitle>
        <CardDescription>
          Enter your email address and we'll send you a link to reset your password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.requestSuccess ? (
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
          <form onSubmit={props.onSubmit} className="space-y-4">
            {props.requestError ? (
              <Alert variant="destructive">
                <AlertDescription>{props.requestError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={props.email}
                onChange={(event) => props.onEmailChange(event.target.value)}
                placeholder="Enter your email"
                required
              />
            </div>
            <Button type="submit" disabled={props.isRequesting} className="w-full">
              {props.isRequesting ? 'Sending...' : 'Send Reset Link'}
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
  );
}
