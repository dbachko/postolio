import {
  isRouteErrorResponse,
  useLocation,
  useNavigate,
  useRouteError,
  Link,
} from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import NotFound from '@/pages/NotFound';
import { AlertCircle, ShieldAlert } from 'lucide-react';

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const location = useLocation();

  const handleGoBack = () => {
    const historyIdx =
      typeof (window.history.state as { idx?: unknown } | null)?.idx === 'number'
        ? Number((window.history.state as { idx: number }).idx)
        : 0;

    if (historyIdx > 0) {
      navigate(-1);
      return;
    }

    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true });
  };

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return <NotFound />;
    }

    if (error.status === 401) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <Card className="w-full max-w-md p-6 text-center">
            <div className="bg-muted mx-auto mb-3 rounded-full p-3">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h1 className="mb-1 text-lg font-semibold">Authentication required</h1>
            <p className="text-muted-foreground mb-4 text-sm">Please login to continue.</p>
            <Button asChild>
              <Link to="/login">Go to Login</Link>
            </Button>
          </Card>
        </div>
      );
    }

    if (error.status === 403) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <Card className="w-full max-w-md p-6 text-center">
            <div className="bg-muted mx-auto mb-3 rounded-full p-3">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h1 className="mb-1 text-lg font-semibold">Access denied</h1>
            <p className="text-muted-foreground mb-4 text-sm">
              You don’t have permission to view this.
            </p>
            <Button asChild>
              <Link to="/">Go to Dashboard</Link>
            </Button>
          </Card>
        </div>
      );
    }

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="w-full max-w-md p-6 text-center">
          <div className="bg-muted mx-auto mb-3 rounded-full p-3">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h1 className="mb-1 text-lg font-semibold">
            {error.status} {error.statusText}
          </h1>
          <p className="text-muted-foreground mb-4 text-sm">
            {typeof error.data === 'string' ? error.data : 'An unexpected error occurred.'}
          </p>
          <div className="flex justify-center gap-2">
            <Button asChild>
              <Link to="/">Go Home</Link>
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Non-response errors
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="bg-muted mx-auto mb-3 rounded-full p-3">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h1 className="mb-1 text-lg font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground mb-4 text-sm">{message}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={handleGoBack}>
            Go Back
          </Button>
          <Button asChild>
            <Link to="/">Go Home</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
