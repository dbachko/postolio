import { ArrowLeft, Check, Globe2 } from 'lucide-react';
import type { TimezoneOptions, TimezoneRegion } from '@/lib/timezone-options';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { ViewMode } from '../types';
import { RegionItems, TimezoneItems } from './timezone-command-items';

interface TimezoneCommandProps {
  allowClear: boolean;
  clearLabel?: string;
  selectedValue: string | null;
  emptyMessage: string;
  isLoading: boolean;
  loadError: string | null;
  options: TimezoneOptions | null;
  query: string;
  onQueryChange: (query: string) => void;
  view: ViewMode;
  activeRegion: TimezoneRegion | null;
  matchedRegions: TimezoneRegion[];
  matchedTimezones: string[];
  hasSearchResults: boolean;
  selectedRegionKey: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  activeRegionTimezones: string[];
  onSelectRegion: (regionKey: string) => void;
  onSelectTimezone: (timezone: string) => void;
  onBackToRegions: () => void;
  onClear: () => void;
}

function SearchResultsContent({
  matchedRegions,
  matchedTimezones,
  selectedRegionKey,
  selectedValue,
  timezoneOffsetLabelByName,
  onSelectRegion,
  onSelectTimezone,
}: {
  matchedRegions: TimezoneRegion[];
  matchedTimezones: string[];
  selectedRegionKey: string | null;
  selectedValue: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  onSelectRegion: (regionKey: string) => void;
  onSelectTimezone: (timezone: string) => void;
}) {
  return (
    <>
      {matchedRegions.length > 0 && (
        <CommandGroup heading="Regions">
          <RegionItems
            regions={matchedRegions}
            selectedRegionKey={selectedRegionKey}
            onSelectRegion={onSelectRegion}
          />
        </CommandGroup>
      )}

      {matchedRegions.length > 0 && matchedTimezones.length > 0 && <CommandSeparator />}

      {matchedTimezones.length > 0 && (
        <CommandGroup heading="Timezones">
          <TimezoneItems
            timezones={matchedTimezones}
            selectedValue={selectedValue}
            timezoneOffsetLabelByName={timezoneOffsetLabelByName}
            onSelectTimezone={onSelectTimezone}
          />
        </CommandGroup>
      )}
    </>
  );
}

function ActiveRegionTimezonesContent({
  activeRegion,
  activeRegionTimezones,
  selectedValue,
  timezoneOffsetLabelByName,
  onSelectTimezone,
  onBackToRegions,
}: {
  activeRegion: TimezoneRegion;
  activeRegionTimezones: string[];
  selectedValue: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  onSelectTimezone: (timezone: string) => void;
  onBackToRegions: () => void;
}) {
  return (
    <CommandGroup>
      <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
        <Globe2 className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate">{activeRegion.label}</span>
        <span>{activeRegion.timezones.length}</span>
      </div>
      <CommandItem value="back:regions" className="mb-1" onSelect={onBackToRegions}>
        <ArrowLeft className="h-4 w-4" />
        <span className="min-w-0 flex-1 truncate">Back to regions</span>
      </CommandItem>
      <CommandSeparator className="mb-1" />
      <TimezoneItems
        timezones={activeRegionTimezones}
        selectedValue={selectedValue}
        timezoneOffsetLabelByName={timezoneOffsetLabelByName}
        onSelectTimezone={onSelectTimezone}
      />
    </CommandGroup>
  );
}

function TimezoneCommandBody({
  emptyMessage,
  isLoading,
  loadError,
  options,
  query,
  view,
  activeRegion,
  matchedRegions,
  matchedTimezones,
  hasSearchResults,
  selectedRegionKey,
  selectedValue,
  timezoneOffsetLabelByName,
  activeRegionTimezones,
  onSelectRegion,
  onSelectTimezone,
  onBackToRegions,
}: Pick<
  TimezoneCommandProps,
  | 'emptyMessage'
  | 'isLoading'
  | 'loadError'
  | 'options'
  | 'query'
  | 'view'
  | 'activeRegion'
  | 'matchedRegions'
  | 'matchedTimezones'
  | 'hasSearchResults'
  | 'selectedRegionKey'
  | 'selectedValue'
  | 'timezoneOffsetLabelByName'
  | 'activeRegionTimezones'
  | 'onSelectRegion'
  | 'onSelectTimezone'
  | 'onBackToRegions'
>) {
  const hasQuery = query.trim().length > 0;

  if (loadError || isLoading || !options) {
    return <div className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</div>;
  }

  if (hasQuery) {
    if (!hasSearchResults) {
      return <div className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</div>;
    }

    return (
      <SearchResultsContent
        matchedRegions={matchedRegions}
        matchedTimezones={matchedTimezones}
        selectedRegionKey={selectedRegionKey}
        selectedValue={selectedValue}
        timezoneOffsetLabelByName={timezoneOffsetLabelByName}
        onSelectRegion={onSelectRegion}
        onSelectTimezone={onSelectTimezone}
      />
    );
  }

  if (view === 'timezones' && activeRegion) {
    return (
      <ActiveRegionTimezonesContent
        activeRegion={activeRegion}
        activeRegionTimezones={activeRegionTimezones}
        selectedValue={selectedValue}
        timezoneOffsetLabelByName={timezoneOffsetLabelByName}
        onSelectTimezone={onSelectTimezone}
        onBackToRegions={onBackToRegions}
      />
    );
  }

  return (
    <CommandGroup heading="Regions">
      <RegionItems
        regions={options.regions}
        selectedRegionKey={selectedRegionKey}
        onSelectRegion={onSelectRegion}
      />
    </CommandGroup>
  );
}

export function TimezoneCommand({
  allowClear,
  clearLabel,
  selectedValue,
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
  onSelectTimezone,
  onBackToRegions,
  onClear,
}: TimezoneCommandProps) {
  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search regions or timezones..."
        value={query}
        onValueChange={onQueryChange}
      />
      <CommandList className="max-h-[360px]">
        {allowClear && clearLabel && (
          <>
            <CommandItem
              value={clearLabel}
              onSelect={() => {
                onClear();
              }}
            >
              <Check
                className={cn('h-4 w-4', selectedValue == null ? 'opacity-100' : 'opacity-0')}
              />
              <span className="min-w-0 flex-1 truncate">{clearLabel}</span>
            </CommandItem>
            <CommandSeparator />
          </>
        )}

        <TimezoneCommandBody
          emptyMessage={emptyMessage}
          isLoading={isLoading}
          loadError={loadError}
          options={options}
          query={query}
          view={view}
          activeRegion={activeRegion}
          matchedRegions={matchedRegions}
          matchedTimezones={matchedTimezones}
          hasSearchResults={hasSearchResults}
          selectedRegionKey={selectedRegionKey}
          selectedValue={selectedValue}
          timezoneOffsetLabelByName={timezoneOffsetLabelByName}
          activeRegionTimezones={activeRegionTimezones}
          onSelectRegion={onSelectRegion}
          onSelectTimezone={onSelectTimezone}
          onBackToRegions={onBackToRegions}
        />
      </CommandList>
    </Command>
  );
}
