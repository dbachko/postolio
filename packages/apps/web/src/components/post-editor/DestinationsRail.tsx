import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Layers } from 'lucide-react';

interface DestinationsRailProps {
  title: string;
  required?: boolean;
  children: ReactNode;
  footer: ReactNode;
}

export function DestinationsRail({
  title,
  required = false,
  children,
  footer,
}: DestinationsRailProps) {
  return (
    <div className="bg-muted/20 border-border flex w-14 shrink-0 flex-col border-r py-3">
      <TooltipProvider>
        <div className="flex items-center justify-center px-1 pb-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="text-muted-foreground relative cursor-default rounded-full"
                tabIndex={-1}
                aria-label={title}
              >
                {required ? (
                  <span
                    aria-hidden="true"
                    className="text-destructive pointer-events-none absolute top-0.5 -right-0.5 text-sm leading-none font-medium"
                  >
                    *
                  </span>
                ) : null}
                <Layers className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">{title}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          <div className="flex flex-col items-center gap-2">{children}</div>
        </div>

        <div className="mt-auto flex flex-col items-center gap-2 px-1 pt-3">{footer}</div>
      </TooltipProvider>
    </div>
  );
}

interface DestinationsRailItemProps {
  tooltip: string;
  ariaLabel: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function DestinationsRailItem({
  tooltip,
  ariaLabel,
  selected = false,
  disabled = false,
  onClick,
  children,
}: DestinationsRailItemProps) {
  const isStatic = !onClick;

  const button = (
    <Button
      type="button"
      variant="outline"
      size="icon-lg"
      aria-label={ariaLabel}
      disabled={disabled}
      aria-disabled={isStatic ? 'true' : undefined}
      tabIndex={isStatic ? -1 : undefined}
      onClick={onClick}
      className={cn(
        'border-input bg-background text-muted-foreground shadow-none',
        selected && 'border-primary bg-accent/50 text-foreground',
        isStatic && 'cursor-default'
      )}
    >
      {children}
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{button}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}
