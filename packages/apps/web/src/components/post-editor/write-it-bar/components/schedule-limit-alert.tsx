import { AlertTriangle, X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { WriteItBarProps } from '../types';

type CreateBarProps = Extract<WriteItBarProps, { mode: 'create' }>;

export function ScheduleLimitAlert({
  barProps,
  onDismiss,
}: {
  barProps: CreateBarProps;
  onDismiss: () => void;
}) {
  if (!barProps.atCapacity) {
    return null;
  }

  return (
    <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
      <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="font-medium">You&apos;ve reached your plan&apos;s scheduling limit.</p>
        <p className="text-muted-foreground">
          You can still save drafts and add posts to your queue, but new scheduled posts will fail
          until you free up slots or{' '}
          <Button
            type="button"
            onClick={() => (barProps.onUpgradePlan ? barProps.onUpgradePlan() : null)}
            variant="link"
            className="h-auto p-0 align-baseline font-medium underline underline-offset-2"
          >
            upgrade your plan
          </Button>
          .
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Dismiss scheduling limit alert"
        className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
