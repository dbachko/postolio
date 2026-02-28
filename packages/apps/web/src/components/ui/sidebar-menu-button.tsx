import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>span:last-child]:transition-opacity [&>span:last-child]:duration-200 group-data-[state=collapsed]:[&>span:last-child]:opacity-0 group-data-[state=expanded]:[&>span:last-child]:opacity-100 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:!p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type SidebarMenuButtonBaseProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipContent>;
  isMobile: boolean;
  sidebarState: 'expanded' | 'collapsed';
} & VariantProps<typeof sidebarMenuButtonVariants>;

export const SidebarMenuButtonBase = React.forwardRef<
  HTMLButtonElement,
  SidebarMenuButtonBaseProps
>(
  (
    {
      asChild = false,
      isActive = false,
      variant = 'default',
      size = 'default',
      tooltip,
      className,
      isMobile,
      sidebarState,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : 'button';
    const button = (
      <Comp
        ref={ref}
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    );

    if (!tooltip) {
      return button;
    }
    const tooltipProps: React.ComponentProps<typeof TooltipContent> =
      typeof tooltip === 'string' ? { children: tooltip } : tooltip;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent
          side="right"
          align="center"
          hidden={sidebarState !== 'collapsed' || isMobile}
          {...tooltipProps}
        />
      </Tooltip>
    );
  }
);
SidebarMenuButtonBase.displayName = 'SidebarMenuButtonBase';
