import type { ReactNode } from 'react';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TimezoneComboboxProps } from '../types';

export function TimezoneTriggerButton({
  props,
  open,
  isLoading,
  triggerText,
  ensureLoaded,
}: {
  props: TimezoneComboboxProps;
  open: boolean;
  isLoading: boolean;
  triggerText: string | null | undefined;
  ensureLoaded: () => Promise<void>;
}) {
  return (
    <Button
      id={props.id}
      variant="outline"
      role="combobox"
      aria-expanded={open}
      disabled={props.disabled}
      className={cn('h-10 min-w-0 justify-between px-3', props.buttonClassName)}
      onFocus={() => {
        void ensureLoaded();
      }}
      onMouseEnter={() => {
        void ensureLoaded();
      }}
    >
      <span className="flex min-w-0 items-center gap-2">
        {props.leadingIcon}
        <span className="min-w-0 truncate text-left">{triggerText}</span>
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-2">
        {isLoading ? (
          <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
      </span>
    </Button>
  );
}

export function TimezonePopoverShell({
  open,
  setOpen,
  trigger,
  command,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: ReactNode;
  command: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(420px,calc(100vw-2rem))] min-w-[--radix-popover-trigger-width] p-0"
      >
        {command}
      </PopoverContent>
    </Popover>
  );
}
