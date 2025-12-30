import * as React from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Sparkles } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Action = {
  label: string;
  to?: string;
  onClick?: () => void;
  variant?: React.ComponentProps<typeof Button>['variant'];
  icon?: LucideIcon;
  disabled?: boolean;
};

type AppEmptyStateVariant = 'default' | 'minimal';
type IconSize = 'sm' | 'md' | 'lg';

interface AppEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  icon?: LucideIcon | null;
  actions?: Action[];
  children?: React.ReactNode;
  variant?: AppEmptyStateVariant;
  iconSize?: IconSize;
  iconClassName?: string;
}

function renderActions(actions: Action[]) {
  if (actions.length === 0) {
    return null;
  }

  return (
    <EmptyContent className="mt-6 flex flex-wrap justify-center gap-3">
      {actions.map((action, index) => {
        const key = `${action.label}-${index}`;
        const ActionIcon = action.icon;
        const content = (
          <>
            {ActionIcon ? <ActionIcon className="h-4 w-4" /> : null}
            {action.label}
          </>
        );
        if (action.to) {
          return (
            <Button
              asChild
              key={key}
              variant={action.variant}
              disabled={action.disabled}
              className="gap-2"
            >
              <Link to={action.to} onClick={action.onClick}>
                {content}
              </Link>
            </Button>
          );
        }
        return (
          <Button
            key={key}
            onClick={action.onClick}
            variant={action.variant}
            disabled={action.disabled}
            className="gap-2"
          >
            {content}
          </Button>
        );
      })}
    </EmptyContent>
  );
}

const iconSizeMap: Record<IconSize, string> = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
  lg: 'h-8 w-8',
};

export function AppEmptyState({
  title,
  description,
  icon: Icon = Sparkles,
  actions = [],
  children,
  className,
  variant = 'default',
  iconSize = 'md',
  iconClassName,
  ...props
}: AppEmptyStateProps) {
  const iconClasses = cn('text-muted-foreground shrink-0', iconSizeMap[iconSize], iconClassName);
  const actionsMarkup = renderActions(actions);

  if (variant === 'minimal') {
    return (
      <div
        className={cn('text-center', 'space-y-4 rounded-none border-0 bg-transparent', className)}
        {...props}
      >
        {Icon ? (
          <div className="bg-muted text-muted-foreground mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Icon className={iconClasses} />
          </div>
        ) : null}
        <h3 className="text-foreground text-base font-semibold">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
        {children}
        {actionsMarkup}
      </div>
    );
  }

  return (
    <Empty className={cn('py-16 text-center', className)} {...props}>
      <EmptyHeader className="mx-auto max-w-lg space-y-4">
        {Icon ? (
          <EmptyMedia>
            <Icon className={iconClasses} />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
      {actionsMarkup}
    </Empty>
  );
}
