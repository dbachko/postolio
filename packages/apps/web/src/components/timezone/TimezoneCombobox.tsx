import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronsUpDown, Globe2, Loader2 } from 'lucide-react';
import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';

import { cn } from '@/lib/utils';
import {
  loadTimezoneOptions,
  type TimezoneOptions,
  type TimezoneRegion,
} from '@/lib/timezone-options';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type BaseProps = {
  buttonClassName?: string;
  disabled?: boolean;
  id?: string;
  leadingIcon?: React.ReactNode;
  openOnMount?: boolean;
  placeholder?: string;
};

type RequiredProps = BaseProps & {
  value: string;
  onValueChange: (value: string) => void;
  allowClear?: false;
};

type OptionalProps = BaseProps & {
  value: string | null;
  onValueChange: (value: string | null) => void;
  allowClear: true;
  clearLabel: string;
};

export type TimezoneComboboxProps = RequiredProps | OptionalProps;

type ViewMode = 'regions' | 'timezones';

function matchesQuery(timezone: string, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const raw = timezone.toLowerCase();
  const spaced = timezone.replace(/_/g, ' ').toLowerCase();
  return raw.includes(q) || spaced.includes(q);
}

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

export function TimezoneCombobox(props: TimezoneComboboxProps) {
  const [open, setOpen] = useState(props.openOnMount === true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('regions');
  const [activeRegionKey, setActiveRegionKey] = useState<string | null>(null);
  const [options, setOptions] = useState<TimezoneOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const didInitOpenRef = useRef(false);

  const selectedValue = props.value;
  const allowClear = props.allowClear === true;

  const regionByKey = useMemo(() => {
    if (!options) return new Map<string, TimezoneRegion>();
    return new Map(options.regions.map((region) => [region.key, region]));
  }, [options]);

  const selectedRegionKey = useMemo(() => {
    if (!options || selectedValue == null) return null;
    return options.timezoneToRegionKey[selectedValue] || null;
  }, [options, selectedValue]);

  const activeRegion = useMemo(() => {
    if (!activeRegionKey) return null;
    return regionByKey.get(activeRegionKey) || null;
  }, [activeRegionKey, regionByKey]);

  const matchedRegions = useMemo(() => {
    if (!options || !query) return [];
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return options.regions.filter((region) => region.label.toLowerCase().includes(q));
  }, [options, query]);

  const matchedTimezones = useMemo(() => {
    if (!options || !query) return [];
    const q = query.trim();
    if (!q) return [];
    return options.allTimezones
      .filter((tz) => matchesQuery(tz, q))
      .sort((a, b) => formatTimezoneLabel(a).localeCompare(formatTimezoneLabel(b)));
  }, [options, query]);

  const timezoneOffsets = useMemo(() => {
    const labelByName = new Map<string, string>();
    const minutesByName = new Map<string, number>();
    if (!options) return { labelByName, minutesByName };
    const now = new Date();
    for (const timezoneName of options.allTimezones) {
      const label = formatTimezoneOffsetLabel(timezoneName, now);
      if (label) labelByName.set(timezoneName, label);
      try {
        minutesByName.set(timezoneName, getTimezoneOffset(timezoneName, now) / 60_000);
      } catch {
        // ignore invalid timezones
      }
    }

    return { labelByName, minutesByName };
  }, [options]);

  const activeRegionTimezones = useMemo(() => {
    if (!activeRegion) return [];
    return [...activeRegion.timezones].sort((a, b) => {
      const offsetA = timezoneOffsets.minutesByName.get(a) ?? 0;
      const offsetB = timezoneOffsets.minutesByName.get(b) ?? 0;
      if (offsetA !== offsetB) return offsetA - offsetB;
      return formatTimezoneLabel(a).localeCompare(formatTimezoneLabel(b));
    });
  }, [activeRegion, timezoneOffsets.minutesByName]);

  const ensureLoaded = useCallback(async () => {
    if (options || isLoading) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadTimezoneOptions();
      setOptions(loaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load timezones';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, options]);

  useEffect(() => {
    if (!open) {
      didInitOpenRef.current = false;
      setQuery('');
      setView('regions');
      setActiveRegionKey(null);
      return;
    }

    void ensureLoaded();
  }, [ensureLoaded, open]);

  useEffect(() => {
    if (!open || !options) return;
    if (didInitOpenRef.current) return;
    didInitOpenRef.current = true;

    if (selectedRegionKey) {
      setActiveRegionKey(selectedRegionKey);
      const region = regionByKey.get(selectedRegionKey);
      if (region && region.timezones.length > 1) {
        setView('timezones');
        return;
      }
    }

    setView('regions');
  }, [open, options, regionByKey, selectedRegionKey]);

  const selectedLabel = useMemo(() => {
    if (selectedValue == null) return null;
    return formatTimezoneLabel(selectedValue);
  }, [selectedValue]);

  const triggerText =
    selectedValue == null
      ? allowClear
        ? props.clearLabel
        : props.placeholder || 'Select timezone'
      : selectedLabel || selectedValue;

  const emptyMessage = loadError
    ? 'Failed to load timezones.'
    : isLoading || !options
      ? 'Loading timezones...'
      : 'No results found.';

  const hasSearchResults = matchedRegions.length > 0 || matchedTimezones.length > 0;

  const handleSelectRegion = (regionKey: string) => {
    if (!options) return;
    const region = regionByKey.get(regionKey);
    if (!region) return;

    if (region.timezones.length === 1) {
      props.onValueChange(region.timezones[0]);
      setOpen(false);
      return;
    }

    setActiveRegionKey(regionKey);
    setView('timezones');
    setQuery('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
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
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(420px,calc(100vw-2rem))] min-w-[--radix-popover-trigger-width] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search regions or timezones..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[360px]">
            {allowClear && (
              <>
                <CommandItem
                  value={props.clearLabel}
                  onSelect={() => {
                    props.onValueChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('h-4 w-4', selectedValue == null ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="min-w-0 flex-1 truncate">{props.clearLabel}</span>
                </CommandItem>
                <CommandSeparator />
              </>
            )}

            {loadError || isLoading || !options ? (
              <div className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</div>
            ) : query.trim() ? (
              !hasSearchResults ? (
                <div className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</div>
              ) : (
                <>
                  {matchedRegions.length > 0 && (
                    <CommandGroup heading="Regions">
                      {matchedRegions.map((region) => {
                        const selected = selectedRegionKey === region.key;

                        return (
                          <CommandItem
                            key={region.key}
                            value={`region:${region.key}`}
                            onSelect={() => {
                              handleSelectRegion(region.key);
                            }}
                          >
                            <Check
                              className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')}
                            />
                            <span className="min-w-0 flex-1 truncate">{region.label}</span>
                            <span className="text-muted-foreground ml-auto text-xs">
                              {region.timezones.length}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}

                  {matchedRegions.length > 0 && matchedTimezones.length > 0 && <CommandSeparator />}

                  {matchedTimezones.length > 0 && (
                    <CommandGroup heading="Timezones">
                      {matchedTimezones.map((timezone) => {
                        const selected = selectedValue === timezone;

                        return (
                          <CommandItem
                            key={timezone}
                            value={timezone}
                            onSelect={() => {
                              props.onValueChange(timezone);
                              setOpen(false);
                            }}
                          >
                            <Check
                              className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {formatTimezoneLabel(timezone)}
                            </span>
                            <span className="text-muted-foreground ml-auto text-xs">
                              {timezoneOffsets.labelByName.get(timezone) || ''}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  )}
                </>
              )
            ) : view === 'timezones' && activeRegion ? (
              <CommandGroup>
                <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
                  <Globe2 className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">{activeRegion.label}</span>
                  <span>{activeRegion.timezones.length}</span>
                </div>
                <CommandItem
                  value="back:regions"
                  className="mb-1"
                  onSelect={() => {
                    setView('regions');
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="min-w-0 flex-1 truncate">Back to regions</span>
                </CommandItem>
                <CommandSeparator className="mb-1" />
                {activeRegionTimezones.map((timezone) => {
                  const selected = selectedValue === timezone;

                  return (
                    <CommandItem
                      key={timezone}
                      value={timezone}
                      onSelect={() => {
                        props.onValueChange(timezone);
                        setOpen(false);
                      }}
                    >
                      <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate">
                        {formatTimezoneLabel(timezone)}
                      </span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {timezoneOffsets.labelByName.get(timezone) || ''}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : (
              <CommandGroup heading="Regions">
                {options.regions.map((region) => {
                  const selected = selectedRegionKey === region.key;

                  return (
                    <CommandItem
                      key={region.key}
                      value={`region:${region.key}`}
                      onSelect={() => {
                        handleSelectRegion(region.key);
                      }}
                    >
                      <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                      <span className="min-w-0 flex-1 truncate">{region.label}</span>
                      <span className="text-muted-foreground ml-auto text-xs">
                        {region.timezones.length}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
