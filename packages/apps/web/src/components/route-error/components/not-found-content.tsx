import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function NotFoundContent() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md p-6">
        <div className="space-y-4 text-center">
          <div className="text-3xl font-semibold">404</div>
          <div className="space-y-1">
            <h1 className="text-foreground text-xl font-semibold">Page not found</h1>
            <p className="text-muted-foreground text-sm">
              The page you’re looking for doesn’t exist or has moved.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button asChild>
              <Link to="/">Go to Dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/login">Login</Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
