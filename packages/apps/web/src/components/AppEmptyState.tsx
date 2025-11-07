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

interface AppEmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  icon?: LucideIcon | null;
  actions?: Action[];
  children?: React.ReactNode;
}

export function AppEmptyState({
  title,
  description,
  icon: Icon = Sparkles,
  actions = [],
  children,
  className,
  ...props
}: AppEmptyStateProps) {
  return (
    <Empty className={cn('py-16 text-center', className)} {...props}>
      <EmptyHeader className="mx-auto max-w-lg space-y-4">
        {Icon ? (
          <EmptyMedia>
            <Icon className="h-6 w-6" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
      {actions.length > 0 ? (
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
      ) : null}
    </Empty>
  );
}
