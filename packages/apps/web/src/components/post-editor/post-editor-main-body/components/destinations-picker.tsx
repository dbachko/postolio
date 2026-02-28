import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Layers } from 'lucide-react';
import { SocialAccountsPicker } from '@/components/social/social-accounts-picker';
import type { SocialAccountsPickerOption } from '@/components/social/social-accounts-picker/types';

interface DestinationsPickerProps {
  disabled: boolean;
  destinationCount: number;
  isMultiDestinationSelection: boolean;
  platformOptions?: SocialAccountsPickerOption[];
  selectedPlatformAccountIds?: string[];
  onSelectedPlatformAccountIdsChange?: (value: string[]) => void;
  show: boolean;
}

export function DestinationsPicker({
  disabled,
  destinationCount,
  isMultiDestinationSelection,
  platformOptions,
  selectedPlatformAccountIds,
  onSelectedPlatformAccountIdsChange,
  show,
}: DestinationsPickerProps) {
  if (!show) {
    return null;
  }

  let destinationBadge: ReactNode = null;
  if (isMultiDestinationSelection) {
    destinationBadge = (
      <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
        <Layers className="h-3 w-3" />
        <span>{destinationCount} destinations</span>
      </Badge>
    );
  } else if (destinationCount === 1) {
    destinationBadge = (
      <Badge variant="outline" className="text-muted-foreground text-[11px] font-medium">
        Single destination
      </Badge>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2 text-sm">
        Destinations <span className="text-destructive">*</span>
        {destinationBadge}
      </Label>

      {platformOptions && selectedPlatformAccountIds && onSelectedPlatformAccountIdsChange ? (
        <SocialAccountsPicker
          options={platformOptions}
          value={selectedPlatformAccountIds}
          onChange={onSelectedPlatformAccountIdsChange}
          disabled={disabled}
          size="md"
          required
          selectedLayout="wrap"
          addTooltip="Add destination"
        />
      ) : (
        <Skeleton className="h-10 w-full" />
      )}

      {isMultiDestinationSelection ? (
        <p className="text-muted-foreground text-xs">
          This will create a grouped post. After saving, you can customize each destination in tabs.
        </p>
      ) : null}
    </div>
  );
}
