import { Button } from '@/components/ui/button';

type AppErrorFallbackProps = {
  title: string;
  description: string;
};

export function AppErrorFallback({ title, description }: AppErrorFallbackProps) {
  return (
    <div className="border-border bg-card flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-lg border p-8 text-center">
      <div className="text-destructive">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Button type="button" onClick={() => window.location.reload()}>
        Refresh Page
      </Button>
    </div>
  );
}
