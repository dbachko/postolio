import { Check } from 'lucide-react';
import type { TimezoneRegion } from '@/lib/timezone-options';
import { cn } from '@/lib/utils';
import { CommandItem } from '@/components/ui/command';
import { formatTimezoneLabel } from '../utils';

function SelectionCheck({ selected }: { selected: boolean }) {
  return <Check className={cn('h-4 w-4', selected ? 'opacity-100' : 'opacity-0')} />;
}

export function RegionItems({
  regions,
  selectedRegionKey,
  onSelectRegion,
}: {
  regions: TimezoneRegion[];
  selectedRegionKey: string | null;
  onSelectRegion: (regionKey: string) => void;
}) {
  return (
    <>
      {regions.map((region) => {
        const selected = selectedRegionKey === region.key;

        return (
          <CommandItem
            key={region.key}
            value={`region:${region.key}`}
            onSelect={() => onSelectRegion(region.key)}
          >
            <SelectionCheck selected={selected} />
            <span className="min-w-0 flex-1 truncate">{region.label}</span>
            <span className="text-muted-foreground ml-auto text-xs">{region.timezones.length}</span>
          </CommandItem>
        );
      })}
    </>
  );
}

export function TimezoneItems({
  timezones,
  selectedValue,
  timezoneOffsetLabelByName,
  onSelectTimezone,
}: {
  timezones: string[];
  selectedValue: string | null;
  timezoneOffsetLabelByName: Map<string, string>;
  onSelectTimezone: (timezone: string) => void;
}) {
  return (
    <>
      {timezones.map((timezone) => {
        const selected = selectedValue === timezone;

        return (
          <CommandItem key={timezone} value={timezone} onSelect={() => onSelectTimezone(timezone)}>
            <SelectionCheck selected={selected} />
            <span className="min-w-0 flex-1 truncate">{formatTimezoneLabel(timezone)}</span>
            <span className="text-muted-foreground ml-auto text-xs">
              {timezoneOffsetLabelByName.get(timezone) || ''}
            </span>
          </CommandItem>
        );
      })}
    </>
  );
}
