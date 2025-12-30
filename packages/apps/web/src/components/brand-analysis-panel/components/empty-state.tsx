import { Button } from '@/components/ui/button';

type EmptyStateProps = {
  isRunning: boolean;
  runError: string | null;
  onRunAnalysis: () => void;
};

export function EmptyState({ isRunning, runError, onRunAnalysis }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
      <p className="text-muted-foreground mb-3 text-sm">
        No analysis yet. Run an analysis to extract tone, topics, and visual style from your recent
        Instagram posts.
      </p>
      <Button onClick={onRunAnalysis} disabled={isRunning} size="sm" variant="purple">
        {isRunning ? 'Starting…' : 'Run Analysis'}
      </Button>
      {runError ? <p className="text-destructive mt-2 text-xs">{runError}</p> : null}
    </div>
  );
}
