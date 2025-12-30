import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border-2 border-dashed py-12 text-center">
      <p className="text-muted-foreground">{title}</p>
      {description ? <p className="text-muted-foreground mt-2 text-sm">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </div>
  );
}
