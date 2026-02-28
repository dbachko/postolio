import { Check, ChevronsUpDown, Layers, Loader2 } from 'lucide-react';
import type { Platform } from '@/lib/platform-config';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';

export type SocialAccountOption = {
  id: string;
  platform: Platform;
  label: string;
  avatarName: string;
  avatarUrl: string | null;
  disconnected: boolean;
  sortOrder: number;
};

function TriggerAvatar({
  isLoading,
  selectedOption,
}: {
  isLoading: boolean;
  selectedOption: SocialAccountOption | null;
}) {
  if (isLoading) {
    return <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden="true" />;
  }

  if (selectedOption) {
    return (
      <SocialAccountAvatar
        platform={selectedOption.platform}
        name={selectedOption.avatarName}
        src={selectedOption.avatarUrl}
        size="sm"
        selected
        muted={false}
        disabled={selectedOption.disconnected}
      />
    );
  }

  return (
    <span className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full">
      <Layers className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function AllDestinationsCommandItem({
  isAllSelected,
  onSelectAll,
}: {
  isAllSelected: boolean;
  onSelectAll: () => void;
}) {
  return (
    <CommandItem
      value="__all__"
      onSelect={onSelectAll}
      className="flex items-center justify-between gap-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="bg-muted text-muted-foreground flex h-8 w-8 items-center justify-center rounded-full">
          <Layers className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 truncate">All destinations</span>
      </div>
      <span className={cn('text-muted-foreground', isAllSelected && 'opacity-100')}>
        {isAllSelected ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
      </span>
    </CommandItem>
  );
}

function AccountCommandItem({
  account,
  isPrimary,
  isActive,
  onToggle,
}: {
  account: SocialAccountOption;
  isPrimary: boolean;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <CommandItem
      value={`${account.label} ${account.platform}`}
      onSelect={onToggle}
      className="flex items-center justify-between gap-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SocialAccountAvatar
          platform={account.platform}
          name={account.avatarName}
          src={account.avatarUrl}
          size="sm"
          selected={isActive}
          muted={!isActive}
          disabled={account.disconnected}
        />
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{account.label}</span>
          {isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
        </div>
      </div>
      {isActive ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
    </CommandItem>
  );
}

export function ContentViewSelectorPopover({
  open,
  onOpenChange,
  isLoading,
  triggerLabel,
  selectedOption,
  selectedSocialAccountIds,
  options,
  primarySocialAccountId,
  onSelectAll,
  onToggleAccount,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  isLoading: boolean;
  triggerLabel: string;
  selectedOption: SocialAccountOption | null;
  selectedSocialAccountIds: string[] | null;
  options: SocialAccountOption[];
  primarySocialAccountId: string | null;
  onSelectAll: () => void;
  onToggleAccount: (accountId: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 min-w-0 justify-between gap-2 px-3"
          disabled={isLoading}
        >
          <span className="flex min-w-0 items-center gap-2">
            <TriggerAvatar isLoading={isLoading} selectedOption={selectedOption} />
            <span className="min-w-0 truncate text-left text-sm">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[320px] p-0">
        <Command>
          <CommandInput placeholder="Search destinations..." />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Loading destinations...' : 'No destinations found.'}
            </CommandEmpty>
            <CommandGroup heading="Destinations">
              <AllDestinationsCommandItem
                isAllSelected={selectedSocialAccountIds == null}
                onSelectAll={onSelectAll}
              />
              {options.length > 0 ? <CommandSeparator /> : null}
              {options.map((account) => (
                <AccountCommandItem
                  key={account.id}
                  account={account}
                  isPrimary={Boolean(
                    primarySocialAccountId && account.id === primarySocialAccountId
                  )}
                  isActive={selectedSocialAccountIds?.includes(account.id) ?? false}
                  onToggle={() => onToggleAccount(account.id)}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
