import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTimezoneOffset } from 'date-fns-tz';
import {
  loadTimezoneOptions,
  type TimezoneOptions,
  type TimezoneRegion,
} from '@/lib/timezone-options';
import type { ViewMode } from '../types';
import { formatTimezoneLabel, formatTimezoneOffsetLabel, matchesQuery } from '../utils';

export function useTimezoneOptionsLoader(open: boolean) {
  const [options, setOptions] = useState<TimezoneOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
      return;
    }

    void ensureLoaded();
  }, [ensureLoaded, open]);

  return { options, isLoading, loadError, ensureLoaded };
}

export function useTimezoneRegionLookup(
  options: TimezoneOptions | null,
  selectedValue: string | null
) {
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

  return { regionByKey, selectedRegionKey };
}

export function useTimezoneNavigationState({
  open,
  options,
  regionByKey,
  selectedRegionKey,
}: {
  open: boolean;
  options: TimezoneOptions | null;
  regionByKey: Map<string, TimezoneRegion>;
  selectedRegionKey: string | null;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('regions');
  const [activeRegionKey, setActiveRegionKey] = useState<string | null>(null);
  const didInitOpenRef = useRef(false);

  const activeRegion = useMemo(() => {
    if (!activeRegionKey) {
      return null;
    }

    return regionByKey.get(activeRegionKey) || null;
  }, [activeRegionKey, regionByKey]);

  useEffect(() => {
    if (open) {
      return;
    }

    didInitOpenRef.current = false;
    setQuery('');
    setView('regions');
    setActiveRegionKey(null);
  }, [open]);

  useEffect(() => {
    if (!open || !options || didInitOpenRef.current) {
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

  return { query, setQuery, view, setView, activeRegion, setActiveRegionKey };
}

export function useTimezoneSearchData({
  options,
  query,
  activeRegion,
}: {
  options: TimezoneOptions | null;
  query: string;
  activeRegion: TimezoneRegion | null;
}) {
  const matchedRegions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!options || !normalized) {
      return [];
    }

    return options.regions.filter((region) => region.label.toLowerCase().includes(normalized));
  }, [options, query]);

  const matchedTimezones = useMemo(() => {
    const normalized = query.trim();
    if (!options || !normalized) {
      return [];
    }

    return options.allTimezones
      .filter((timezone) => matchesQuery(timezone, normalized))
      .sort((left, right) => formatTimezoneLabel(left).localeCompare(formatTimezoneLabel(right)));
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
        // ignore invalid timezone name
      }
    }

    return { labelByName, minutesByName };
  }, [options]);

  const activeRegionTimezones = useMemo(() => {
    if (!activeRegion) {
      return [];
    }

    return [...activeRegion.timezones].sort((left, right) => {
      const offsetLeft = timezoneOffsets.minutesByName.get(left) ?? 0;
      const offsetRight = timezoneOffsets.minutesByName.get(right) ?? 0;
      if (offsetLeft !== offsetRight) {
        return offsetLeft - offsetRight;
      }
      return formatTimezoneLabel(left).localeCompare(formatTimezoneLabel(right));
    });
  }, [activeRegion, timezoneOffsets.minutesByName]);

  return { matchedRegions, matchedTimezones, timezoneOffsets, activeRegionTimezones };
}

export function getTimezoneComboboxTriggerText({
  selectedValue,
  selectedLabel,
  allowClear,
  clearLabel,
  placeholder,
}: {
  selectedValue: string | null;
  selectedLabel: string | null;
  allowClear: boolean;
  clearLabel: string | undefined;
  placeholder: string | undefined;
}) {
  if (selectedValue != null) {
    return selectedLabel || selectedValue;
  }

  if (allowClear) {
    return clearLabel;
  }

  return placeholder || 'Select timezone';
}

export function getTimezoneComboboxEmptyMessage({
  loadError,
  isLoading,
  options,
}: {
  loadError: string | null;
  isLoading: boolean;
  options: TimezoneOptions | null;
}) {
  if (loadError) {
    return 'Failed to load timezones.';
  }

  if (isLoading || !options) {
    return 'Loading timezones...';
  }

  return 'No results found.';
}
