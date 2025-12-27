import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '@/lib/utils';

type ItemVariant = 'default' | 'outline' | 'muted';
type ItemSize = 'default' | 'sm';

function itemVariantClasses(variant: ItemVariant): string {
  if (variant === 'outline') return 'border-border';
  if (variant === 'muted') return 'border-transparent bg-muted/50';
  return 'border-transparent bg-transparent';
}

function itemSizeClasses(size: ItemSize): string {
  if (size === 'sm') return 'py-3 px-4 gap-2.5';
  return 'p-4 gap-4';
}

type ItemProps = React.ComponentPropsWithoutRef<'div'> & {
  variant?: ItemVariant;
  size?: ItemSize;
  asChild?: boolean;
};

const Item = React.forwardRef<HTMLDivElement, ItemProps>(
  ({ className, variant = 'default', size = 'default', asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        data-slot="item"
        data-variant={variant}
        data-size={size}
        className={cn(
          'group/item [a]:hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-ring/50 flex flex-wrap items-center rounded-md border text-sm transition-colors duration-100 outline-none focus-visible:ring-[3px] [a]:transition-colors',
          itemVariantClasses(variant),
          itemSizeClasses(size),
          className
        )}
        {...props}
      />
    );
  }
);
Item.displayName = 'Item';

const ItemGroup = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-group"
      className={cn('group/item-group flex flex-col gap-4', className)}
      {...props}
    />
  )
);
ItemGroup.displayName = 'ItemGroup';

const ItemSeparator = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-separator"
      className={cn(
        'bg-border my-0 shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      {...props}
    />
  )
);
ItemSeparator.displayName = 'ItemSeparator';

const ItemHeader = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-header"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  )
);
ItemHeader.displayName = 'ItemHeader';

type ItemMediaVariant = 'default' | 'icon' | 'image';

type ItemMediaProps = React.ComponentPropsWithoutRef<'div'> & {
  variant?: ItemMediaVariant;
};

function itemMediaVariantClasses(variant: ItemMediaVariant): string {
  if (variant === 'icon')
    return "size-8 border rounded-sm bg-muted [&_svg:not([class*='size-'])]:size-4";
  if (variant === 'image')
    return 'size-10 rounded-sm overflow-hidden [&_img]:size-full [&_img]:object-cover';
  return 'bg-transparent';
}

const ItemMedia = React.forwardRef<HTMLDivElement, ItemMediaProps>(
  ({ className, variant = 'default', ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-media"
      data-variant={variant}
      className={cn(
        'flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:translate-y-0.5 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none',
        itemMediaVariantClasses(variant),
        className
      )}
      {...props}
    />
  )
);
ItemMedia.displayName = 'ItemMedia';

const ItemContent = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-content"
      className={cn('flex flex-1 flex-col gap-1 [&+[data-slot=item-content]]:flex-none', className)}
      {...props}
    />
  )
);
ItemContent.displayName = 'ItemContent';

const ItemTitle = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-title"
      className={cn('flex w-fit items-center gap-2 text-sm leading-snug font-medium', className)}
      {...props}
    />
  )
);
ItemTitle.displayName = 'ItemTitle';

const ItemDescription = React.forwardRef<HTMLParagraphElement, React.ComponentPropsWithoutRef<'p'>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      data-slot="item-description"
      className={cn(
        'text-muted-foreground [&>a:hover]:text-primary line-clamp-2 text-sm leading-normal font-normal text-balance [&>a]:underline [&>a]:underline-offset-4',
        className
      )}
      {...props}
    />
  )
);
ItemDescription.displayName = 'ItemDescription';

const ItemActions = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-actions"
      className={cn('flex items-center gap-2', className)}
      {...props}
    />
  )
);
ItemActions.displayName = 'ItemActions';

const ItemFooter = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="item-footer"
      className={cn('flex basis-full items-center justify-between gap-2', className)}
      {...props}
    />
  )
);
ItemFooter.displayName = 'ItemFooter';

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
};
