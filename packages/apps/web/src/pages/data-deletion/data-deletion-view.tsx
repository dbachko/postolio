import { ArrowLeft, AlertTriangle, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { formatDataDeletionMarkdown } from './data-deletion-markdown';

export function DataDeletionLoadingView() {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="animate-pulse">
        <div className="bg-muted mb-4 h-8 rounded" />
        <div className="space-y-3">
          <div className="bg-muted h-4 w-3/4 rounded" />
          <div className="bg-muted h-4 w-1/2 rounded" />
          <div className="bg-muted h-4 w-5/6 rounded" />
        </div>
      </div>
    </div>
  );
}

export function DataDeletionInitialErrorView(props: { error: string }) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="text-destructive mb-2">Error Loading Data Deletion Instructions</div>
            <p className="text-muted-foreground">{props.error}</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Please contact us at{' '}
              <a href="mailto:privacy@postolio.example" className="text-primary hover:underline">
                privacy@postolio.example
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InstructionsFallback() {
  return (
    <div>
      <h1 className="border-border text-foreground mb-4 border-b-2 pb-2 text-3xl font-bold">
        Data Deletion Instructions
      </h1>
      <p className="text-muted-foreground mb-3">
        We respect your right to privacy and provide multiple ways to delete your personal data and
        account.
      </p>
      <p className="text-muted-foreground mb-3">
        You can submit a deletion request using the form below, or contact us directly at{' '}
        <a href="mailto:privacy@postolio.example" className="text-primary hover:underline">
          privacy@postolio.example
        </a>
      </p>
    </div>
  );
}

function DeletionRequestPanel(props: {
  email: string;
  requestSent: boolean;
  submitting: boolean;
  error: string;
  isSignedIn: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <div className="bg-muted mt-8 rounded-lg border p-6" style={{ minHeight: '200px' }}>
      <h3 className="text-foreground mb-3 text-lg font-semibold">Request Data Deletion</h3>
      {props.requestSent ? (
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>
            Your deletion request has been submitted. Please check your email for verification
            instructions.
          </AlertDescription>
        </Alert>
      ) : (
        <form onSubmit={props.onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={props.email}
              onChange={(event) => props.onEmailChange(event.target.value)}
              placeholder="Enter your email address"
              required
              disabled={props.submitting}
            />
          </div>

          {props.error ? (
            <Alert variant="destructive">
              <AlertDescription>{props.error}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={props.submitting || !props.email} className="w-full">
            {props.submitting ? 'Submitting...' : 'Submit Deletion Request'}
          </Button>

          <p className="text-muted-foreground text-center text-xs">
            {props.isSignedIn ? (
              <>
                You&apos;re currently signed in; you can also delete your account directly from{' '}
                <Link
                  to="/settings/account#delete-account"
                  className="text-primary hover:underline"
                >
                  Settings
                </Link>
                .
              </>
            ) : (
              <>
                If you have an account, please{' '}
                <Link to="/login" className="text-primary hover:underline">
                  log in
                </Link>{' '}
                to delete your data from Settings.
              </>
            )}
          </p>
        </form>
      )}
    </div>
  );
}

function ContactPanel() {
  return (
    <div className="bg-muted mt-8 rounded-lg border p-6">
      <h3 className="text-foreground mb-3 text-lg font-semibold">Need Assistance?</h3>
      <div className="text-muted-foreground space-y-2 text-sm">
        <p>
          <strong>Privacy Inquiries:</strong>{' '}
          <a href="mailto:privacy@postolio.example" className="hover:underline">
            privacy@postolio.example
          </a>
        </p>
        <p>
          <strong>Support:</strong>{' '}
          <a href="mailto:support@postolio.example" className="hover:underline">
            support@postolio.example
          </a>
        </p>
        <p>
          <strong>Data Protection Officer (EU):</strong>{' '}
          <a href="mailto:dpo@postolio.example" className="hover:underline">
            dpo@postolio.example
          </a>
        </p>
      </div>
    </div>
  );
}

interface DataDeletionMainViewProps {
  content: string;
  error: string;
  email: string;
  requestSent: boolean;
  submitting: boolean;
  isSignedIn: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

export function DataDeletionMainView(props: DataDeletionMainViewProps) {
  return (
    <div className="mx-auto max-w-4xl p-6">
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
          {props.error ? (
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {props.error}. You can still submit a deletion request below.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="prose prose-lg max-w-none">
            {props.content ? formatDataDeletionMarkdown(props.content) : <InstructionsFallback />}
          </div>

          <DeletionRequestPanel
            email={props.email}
            requestSent={props.requestSent}
            submitting={props.submitting}
            error={props.error}
            isSignedIn={props.isSignedIn}
            onEmailChange={props.onEmailChange}
            onSubmit={props.onSubmit}
          />

          <ContactPanel />
        </CardContent>
      </Card>
    </div>
  );
}
