import { Suspense, lazy, useMemo, useState } from 'react';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { TimezoneComboboxProps } from '@/components/timezone/TimezoneCombobox';

const LazyTimezoneCombobox = lazy(async () => {
  const mod = await import('@/components/timezone/TimezoneCombobox');
  return { default: mod.TimezoneCombobox };
});

type Props = TimezoneComboboxProps;

function formatTimezoneLabel(timezone: string): string {
  if (timezone === 'UTC') return 'UTC';
  const parts = timezone.split('/');
  const lastPart = parts[parts.length - 1] || timezone;
  return lastPart.replace(/_/g, ' ');
}

function formatTimezoneOffsetLabel(timezone: string, now: Date): string | null {
  try {
    const formatted = formatInTimeZone(now, timezone, 'O');
    return formatted === 'GMT+0' ? 'GMT' : formatted;
  } catch {
    return null;
  }
}

function TriggerPlaceholder(props: Props & { onRequestLoad: () => void; showSpinner: boolean }) {
  const selectedValue = props.value;
  const allowClear = props.allowClear === true;
  const now = useMemo(() => new Date(), []);

  const triggerText =
    selectedValue == null
      ? allowClear
        ? props.clearLabel
        : props.placeholder || 'Select timezone'
      : formatTimezoneLabel(selectedValue);

  const offsetText = useMemo(() => {
    if (selectedValue == null) return null;
    return formatTimezoneOffsetLabel(selectedValue, now);
  }, [now, selectedValue]);

  return (
    <Button
      id={props.id}
      variant="outline"
      role="combobox"
      aria-expanded={false}
      disabled={props.disabled}
      className={cn('h-10 min-w-0 justify-between px-3', props.buttonClassName)}
      onClick={props.onRequestLoad}
    >
      <span className="flex min-w-0 items-center gap-2">
        {props.leadingIcon}
        <span className="min-w-0 truncate text-left">{triggerText}</span>
      </span>
      <span className="ml-2 flex shrink-0 items-center gap-2">
        {selectedValue != null && offsetText && (
          <span className="text-muted-foreground text-xs">{offsetText}</span>
        )}
        {props.showSpinner ? (
          <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" />
        )}
      </span>
    </Button>
  );
}

export function AsyncTimezoneCombobox(props: Props) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const [openOnMount, setOpenOnMount] = useState(false);

  const requestLoad = () => {
    setShouldLoad(true);
    setOpenOnMount(true);
  };

  const lazyProps = useMemo(() => ({ ...props, openOnMount }), [openOnMount, props]);

  if (!shouldLoad) {
    return <TriggerPlaceholder {...props} onRequestLoad={requestLoad} showSpinner={false} />;
  }

  return (
    <Suspense
      fallback={<TriggerPlaceholder {...props} onRequestLoad={() => {}} showSpinner={true} />}
    >
      <LazyTimezoneCombobox {...lazyProps} />
    </Suspense>
  );
}
