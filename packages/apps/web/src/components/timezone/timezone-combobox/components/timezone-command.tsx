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
import { formatTimezoneLabel } from '../utils';

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
                          onSelectRegion(region.key);
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
                          onSelectTimezone(timezone);
                        }}
                      >
                        <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                        <span className="min-w-0 flex-1 truncate">
                          {formatTimezoneLabel(timezone)}
                        </span>
                        <span className="text-muted-foreground ml-auto text-xs">
                          {timezoneOffsetLabelByName.get(timezone) || ''}
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
                onBackToRegions();
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
                    onSelectTimezone(timezone);
                  }}
                >
                  <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1 truncate">{formatTimezoneLabel(timezone)}</span>
                  <span className="text-muted-foreground ml-auto text-xs">
                    {timezoneOffsetLabelByName.get(timezone) || ''}
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
                    onSelectRegion(region.key);
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
  );
}
