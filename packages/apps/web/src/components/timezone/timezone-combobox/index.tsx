import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { getTimezoneOffset } from 'date-fns-tz';
import { cn } from '@/lib/utils';
import {
  loadTimezoneOptions,
  type TimezoneOptions,
  type TimezoneRegion,
} from '@/lib/timezone-options';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TimezoneComboboxProps, ViewMode } from './types';
import { formatTimezoneLabel, formatTimezoneOffsetLabel, matchesQuery } from './utils';
import { TimezoneCommand } from './components/timezone-command';

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
    if (!options) {
      return new Map<string, TimezoneRegion>();
    }
    return new Map(options.regions.map((region) => [region.key, region]));
  }, [options]);

  const selectedRegionKey = useMemo(() => {
    if (!options || selectedValue == null) {
      return null;
    }
    return options.timezoneToRegionKey[selectedValue] || null;
  }, [options, selectedValue]);

  const activeRegion = useMemo(() => {
    if (!activeRegionKey) {
      return null;
    }
    return regionByKey.get(activeRegionKey) || null;
  }, [activeRegionKey, regionByKey]);

  const matchedRegions = useMemo(() => {
    if (!options || !query) {
      return [];
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      return [];
    }
    return options.regions.filter((region) => region.label.toLowerCase().includes(q));
  }, [options, query]);

  const matchedTimezones = useMemo(() => {
    if (!options || !query) {
      return [];
    }
    const q = query.trim();
    if (!q) {
      return [];
    }
    return options.allTimezones
      .filter((tz) => matchesQuery(tz, q))
      .sort((a, b) => formatTimezoneLabel(a).localeCompare(formatTimezoneLabel(b)));
  }, [options, query]);

  const timezoneOffsets = useMemo(() => {
    const labelByName = new Map<string, string>();
    const minutesByName = new Map<string, number>();
    if (!options) {
      return { labelByName, minutesByName };
    }
    const now = new Date();

    for (const timezoneName of options.allTimezones) {
      const label = formatTimezoneOffsetLabel(timezoneName, now);
      if (label) {
        labelByName.set(timezoneName, label);
      }
      try {
        minutesByName.set(timezoneName, getTimezoneOffset(timezoneName, now) / 60_000);
      } catch {
        // ignore invalid timezones
      }
    }

    return { labelByName, minutesByName };
  }, [options]);

  const activeRegionTimezones = useMemo(() => {
    if (!activeRegion) {
      return [];
    }
    return [...activeRegion.timezones].sort((a, b) => {
      const offsetA = timezoneOffsets.minutesByName.get(a) ?? 0;
      const offsetB = timezoneOffsets.minutesByName.get(b) ?? 0;
      if (offsetA !== offsetB) {
        return offsetA - offsetB;
      }
      return formatTimezoneLabel(a).localeCompare(formatTimezoneLabel(b));
    });
  }, [activeRegion, timezoneOffsets.minutesByName]);

  const ensureLoaded = useCallback(async () => {
    if (options || isLoading) {
      return;
    }
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
    if (!open || !options) {
      return;
    }
    if (didInitOpenRef.current) {
      return;
    }
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
    if (selectedValue == null) {
      return null;
    }
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
    if (!options) {
      return;
    }
    const region = regionByKey.get(regionKey);
    if (!region) {
      return;
    }

    if (region.timezones.length === 1) {
      props.onValueChange(region.timezones[0]);
      setOpen(false);
      return;
    }

    setActiveRegionKey(regionKey);
    setView('timezones');
    setQuery('');
  };

  const handleSelectTimezone = (timezone: string) => {
    props.onValueChange(timezone as any);
    setOpen(false);
  };

  const handleClear = () => {
    if (!allowClear) {
      return;
    }
    props.onValueChange(null);
    setOpen(false);
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
        <TimezoneCommand
          allowClear={allowClear}
          clearLabel={allowClear ? props.clearLabel : undefined}
          selectedValue={selectedValue}
          emptyMessage={emptyMessage}
          isLoading={isLoading}
          loadError={loadError}
          options={options}
          query={query}
          onQueryChange={setQuery}
          view={view}
          activeRegion={activeRegion}
          matchedRegions={matchedRegions}
          matchedTimezones={matchedTimezones}
          hasSearchResults={hasSearchResults}
          selectedRegionKey={selectedRegionKey}
          timezoneOffsetLabelByName={timezoneOffsets.labelByName}
          activeRegionTimezones={activeRegionTimezones}
          onSelectRegion={handleSelectRegion}
          onSelectTimezone={handleSelectTimezone}
          onBackToRegions={() => setView('regions')}
          onClear={handleClear}
        />
      </PopoverContent>
    </Popover>
  );
}
