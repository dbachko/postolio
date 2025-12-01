import * as React from 'react';

import { cn } from '@/lib/utils';

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ButtonGroup({ className, ...props }: ButtonGroupProps) {
  return (
    <div
      data-slot="button-group"
      className={cn(
        'inline-flex items-stretch [&>[data-slot=button]]:rounded-none [&>[data-slot=button]:first-child]:rounded-l-md [&>[data-slot=button]:last-child]:rounded-r-md [&>[data-slot=button]:not(:first-child)]:-ml-px',
        className
      )}
      {...props}
    />
  );
}

interface ButtonGroupSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ButtonGroupSeparator({ className, ...props }: ButtonGroupSeparatorProps) {
  return <div data-button-separator className={cn('bg-border h-9 w-px', className)} {...props} />;
}
