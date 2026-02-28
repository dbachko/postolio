import { useMemo, useState } from 'react';
import type { TimezoneOptions, TimezoneRegion } from '@/lib/timezone-options';
import type { TimezoneComboboxProps } from './types';
import { formatTimezoneLabel } from './utils';
import { TimezoneCommand } from './components/timezone-command';
import { TimezonePopoverShell, TimezoneTriggerButton } from './components/timezone-combobox-shell';
import {
  getTimezoneComboboxEmptyMessage,
  getTimezoneComboboxTriggerText,
  useTimezoneNavigationState,
  useTimezoneOptionsLoader,
  useTimezoneRegionLookup,
  useTimezoneSearchData,
} from './hooks/use-timezone-combobox';

type TimezoneComboboxContentProps = {
  props: TimezoneComboboxProps;
  open: boolean;
  setOpen: (open: boolean) => void;
  allowClear: boolean;
  isLoading: boolean;
  loadError: string | null;
  options: TimezoneOptions | null;
  query: string;
  setQuery: (query: string) => void;
  view: 'regions' | 'timezones';
  setView: (view: 'regions' | 'timezones') => void;
  activeRegion: TimezoneRegion | null;
  matchedRegions: TimezoneRegion[];
  matchedTimezones: string[];
  hasSearchResults: boolean;
  selectedRegionKey: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  activeRegionTimezones: string[];
  triggerText: string | null | undefined;
  emptyMessage: string;
  ensureLoaded: () => Promise<void>;
  onSelectRegion: (regionKey: string) => void;
};

type TimezoneCommandContentProps = {
  allowClear: boolean;
  clearLabel: string | undefined;
  value: string | null;
  onValueChange: (value: string | null) => void;
  setOpen: (open: boolean) => void;
  emptyMessage: string;
  isLoading: boolean;
  loadError: string | null;
  options: TimezoneOptions | null;
  query: string;
  onQueryChange: (query: string) => void;
  view: 'regions' | 'timezones';
  activeRegion: TimezoneRegion | null;
  matchedRegions: TimezoneRegion[];
  matchedTimezones: string[];
  hasSearchResults: boolean;
  selectedRegionKey: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  activeRegionTimezones: string[];
  onSelectRegion: (regionKey: string) => void;
  onSetView: (view: 'regions' | 'timezones') => void;
};

function TimezoneComboboxContent({
  props,
  open,
  setOpen,
  allowClear,
  isLoading,
  loadError,
  options,
  query,
  setQuery,
  view,
  setView,
  activeRegion,
  matchedRegions,
  matchedTimezones,
  hasSearchResults,
  selectedRegionKey,
  timezoneOffsetLabelByName,
  activeRegionTimezones,
  triggerText,
  emptyMessage,
  ensureLoaded,
  onSelectRegion,
}: TimezoneComboboxContentProps) {
  return (
    <TimezonePopoverShell
      open={open}
      setOpen={setOpen}
      trigger={
        <TimezoneTriggerButton
          props={props}
          open={open}
          isLoading={isLoading}
          triggerText={triggerText}
          ensureLoaded={ensureLoaded}
        />
      }
      command={
        <TimezoneCommandContent
          allowClear={allowClear}
          clearLabel={props.allowClear ? props.clearLabel : undefined}
          value={props.value}
          onValueChange={(value) => {
            if (value == null) {
              if (props.allowClear) {
                props.onValueChange(null);
              }
              return;
            }
            props.onValueChange(value);
          }}
          setOpen={setOpen}
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
          timezoneOffsetLabelByName={timezoneOffsetLabelByName}
          activeRegionTimezones={activeRegionTimezones}
          onSelectRegion={onSelectRegion}
          onSetView={setView}
        />
      }
    />
  );
}

function TimezoneCommandContent({
  allowClear,
  clearLabel,
  value,
  onValueChange,
  setOpen,
  emptyMessage,
  isLoading,
  loadError,
  options,
  query,
  onQueryChange,
  view,
  activeRegion,
  matchedRegions,
  matchedTimezones,
  hasSearchResults,
  selectedRegionKey,
  timezoneOffsetLabelByName,
  activeRegionTimezones,
  onSelectRegion,
  onSetView,
}: TimezoneCommandContentProps) {
  return (
    <TimezoneCommand
      allowClear={allowClear}
      clearLabel={clearLabel}
      selectedValue={value}
      emptyMessage={emptyMessage}
      isLoading={isLoading}
      loadError={loadError}
      options={options}
      query={query}
      onQueryChange={onQueryChange}
      view={view}
      activeRegion={activeRegion}
      matchedRegions={matchedRegions}
      matchedTimezones={matchedTimezones}
      hasSearchResults={hasSearchResults}
      selectedRegionKey={selectedRegionKey}
      timezoneOffsetLabelByName={timezoneOffsetLabelByName}
      activeRegionTimezones={activeRegionTimezones}
      onSelectRegion={onSelectRegion}
      onSelectTimezone={(timezone) => {
        onValueChange(timezone);
        setOpen(false);
      }}
      onBackToRegions={() => onSetView('regions')}
      onClear={() => {
        if (!allowClear) {
          return;
        }
        onValueChange(null);
        setOpen(false);
      }}
    />
  );
}

export function TimezoneCombobox(props: TimezoneComboboxProps) {
  const [open, setOpen] = useState(props.openOnMount === true);
  const selectedValue = props.value;
  const allowClear = props.allowClear === true;

  const { options, isLoading, loadError, ensureLoaded } = useTimezoneOptionsLoader(open);
  const { regionByKey, selectedRegionKey } = useTimezoneRegionLookup(options, selectedValue);
  const { query, setQuery, view, setView, activeRegion, setActiveRegionKey } =
    useTimezoneNavigationState({
      open,
      options,
      regionByKey,
      selectedRegionKey,
    });
  const { matchedRegions, matchedTimezones, timezoneOffsets, activeRegionTimezones } =
    useTimezoneSearchData({
      options,
      query,
      activeRegion,
    });

  const selectedLabel = useMemo(
    () => (selectedValue == null ? null : formatTimezoneLabel(selectedValue)),
    [selectedValue]
  );
  const triggerText = getTimezoneComboboxTriggerText({
    selectedValue,
    selectedLabel,
    allowClear,
    clearLabel: props.allowClear ? props.clearLabel : undefined,
    placeholder: props.placeholder,
  });
  const emptyMessage = getTimezoneComboboxEmptyMessage({ loadError, isLoading, options });
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

  return (
    <TimezoneComboboxContent
      props={props}
      open={open}
      setOpen={setOpen}
      allowClear={allowClear}
      isLoading={isLoading}
      loadError={loadError}
      options={options}
      query={query}
      setQuery={setQuery}
      view={view}
      setView={setView}
      activeRegion={activeRegion}
      matchedRegions={matchedRegions}
      matchedTimezones={matchedTimezones}
      hasSearchResults={hasSearchResults}
      selectedRegionKey={selectedRegionKey}
      timezoneOffsetLabelByName={timezoneOffsets.labelByName}
      activeRegionTimezones={activeRegionTimezones}
      triggerText={triggerText}
      emptyMessage={emptyMessage}
      ensureLoaded={ensureLoaded}
      onSelectRegion={handleSelectRegion}
    />
  );
}
