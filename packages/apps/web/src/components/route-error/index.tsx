import {
  isRouteErrorResponse,
  useLocation,
  useNavigate,
  useRouteError,
  Link,
} from 'react-router-dom';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NotFoundContent } from './components/not-found-content';
import { AlertCircle, ShieldAlert } from 'lucide-react';

function getHistoryIndex(): number {
  return typeof (window.history.state as { idx?: unknown } | null)?.idx === 'number'
    ? Number((window.history.state as { idx: number }).idx)
    : 0;
}

function CenteredErrorCard({
  icon,
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="bg-muted mx-auto mb-3 rounded-full p-3">{icon}</div>
        <h1 className="mb-1 text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground mb-4 text-sm">{description}</p>
        <div className="flex justify-center gap-2">{actions}</div>
      </Card>
    </div>
  );
}

function RouteResponseError({
  error,
}: {
  error: { status: number; statusText: string; data: unknown };
}) {
  if (error.status === 404) {
    return <NotFoundContent />;
  }
  if (error.status === 401) {
    return (
      <CenteredErrorCard
        icon={<ShieldAlert className="h-6 w-6" />}
        title="Authentication required"
        description="Please login to continue."
        actions={
          <Button asChild>
            <Link to="/login">Go to Login</Link>
          </Button>
        }
      />
    );
  }
  if (error.status === 403) {
    return (
      <CenteredErrorCard
        icon={<ShieldAlert className="h-6 w-6" />}
        title="Access denied"
        description="You don’t have permission to view this."
        actions={
          <Button asChild>
            <Link to="/">Go to Dashboard</Link>
          </Button>
        }
      />
    );
  }
  return (
    <CenteredErrorCard
      icon={<AlertCircle className="h-6 w-6" />}
      title={`${error.status} ${error.statusText}`}
      description={typeof error.data === 'string' ? error.data : 'An unexpected error occurred.'}
      actions={
        <>
          <Button asChild>
            <Link to="/">Go Home</Link>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </>
      }
    />
  );
}

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  const handleGoBack = () => {
    if (getHistoryIndex() > 0) {
      navigate(-1);
      return;
    }

    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true });
  };

  if (isRouteErrorResponse(error)) {
    return <RouteResponseError error={error} />;
  }

  // Non-response errors
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return (
    <CenteredErrorCard
      icon={<AlertCircle className="h-6 w-6" />}
      title="Something went wrong"
      description={message}
      actions={
        <>
          <Button variant="outline" onClick={handleGoBack}>
            Go Back
          </Button>
          <Button asChild>
            <Link to="/">Go Home</Link>
          </Button>
        </>
      }
    />
  );
}
