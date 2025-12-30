import { useId } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Building2, Plus, Settings, Sparkles } from 'lucide-react';

import type { NavigationItem } from '@/components/app-shell/nav-config';

type AppHeaderSearchDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  filteredItems: NavigationItem[];
  onSelectPath: (path: string) => void;
};

export function AppHeaderSearchDialog({
  open,
  onOpenChange,
  searchQuery,
  onSearchQueryChange,
  filteredItems,
  onSelectPath,
}: AppHeaderSearchDialogProps) {
  const inputId = useId();

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        id={inputId}
        placeholder="Search features, campaigns, analytics..."
        value={searchQuery}
        onValueChange={onSearchQueryChange}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {filteredItems.map((item) => (
            <CommandItem
              key={item.path}
              onSelect={() => onSelectPath(item.path)}
              className="flex items-center space-x-3 px-2 py-2"
            >
              <item.icon className="h-4 w-4" aria-hidden="true" />
              <div className="flex flex-col">
                <span>{item.label}</span>
                {item.description && (
                  <span className="text-muted-foreground text-xs">{item.description}</span>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Quick Actions">
          <CommandItem onSelect={() => onSelectPath('/posts/create')}>
            <Plus className="mr-3 h-4 w-4" aria-hidden="true" />
            Create New Post
          </CommandItem>
          <CommandItem onSelect={() => onSelectPath('/campaigns/create')}>
            <Sparkles className="mr-3 h-4 w-4" aria-hidden="true" />
            Create New Campaign
          </CommandItem>
          <CommandItem onSelect={() => onSelectPath('/brands')}>
            <Building2 className="mr-3 h-4 w-4" aria-hidden="true" />
            Add New Brand
          </CommandItem>
          <CommandItem onSelect={() => onSelectPath('/settings')}>
            <Settings className="mr-3 h-4 w-4" aria-hidden="true" />
            Account Settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
