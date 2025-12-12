import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string | ReactNode;
  description?: string | ReactNode;
  actions?: ReactNode;
  showTitle?: boolean;
}

export function PageHeader({ title, description, actions, showTitle = false }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      {showTitle && (
        <div className="space-y-1">
          {typeof title === 'string' ? (
            <h1 className="text-foreground text-2xl font-bold">{title}</h1>
          ) : (
            title
          )}
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
