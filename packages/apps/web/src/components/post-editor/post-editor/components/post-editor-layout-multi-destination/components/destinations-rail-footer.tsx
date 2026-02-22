import { Check, Eye, EyeOff, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getPlatformConfig } from '@/lib/platform-config';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';

import type { PostEditorState } from '../../../hooks/use-post-editor';

export function DestinationsRailFooter({ state }: { state: PostEditorState }) {
  return (
    <>
      <Popover
        open={state.destinations.editDestinationsPopoverOpen}
        onOpenChange={state.destinations.setEditDestinationsPopoverOpen}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-lg"
                  aria-label="Add destinations"
                  className="text-muted-foreground shadow-none"
                  disabled={
                    state.derived.disabled ||
                    state.data.groupHasPublishedDestinations ||
                    state.mutations.isSaving ||
                    state.mutations.isAddingDestination ||
                    state.mutations.isResettingDestination
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-sm">
              {state.data.groupHasPublishedDestinations
                ? 'Cannot add destinations after publishing.'
                : 'Add destinations'}
            </p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent side="right" align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search destinations…" />
            <CommandList>
              <CommandEmpty>No destinations found.</CommandEmpty>
              <CommandGroup>
                {state.data.platformPickerOptions.map((opt) => {
                  const isAlreadyInGroup = state.data.groupDestinationSocialAccountIds.has(opt.id);
                  const platformConfig = getPlatformConfig(opt.platform);
                  const platformLabel = platformConfig.displayName;
                  const shortLabel = opt.label?.trim() || '';
                  const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;
                  const searchValue = `${platformLabel} ${shortLabel} ${avatarName}`.trim();

                  return (
                    <CommandItem
                      key={opt.id}
                      value={searchValue}
                      onSelect={() => {
                        if (isAlreadyInGroup) {
                          return;
                        }
                        state.destinations.setEditDestinationsPopoverOpen(false);
                        void state.destinationActions.handleAddDestinationToGroup(opt.id);
                      }}
                      disabled={
                        Boolean(opt.disabled) ||
                        state.derived.disabled ||
                        isAlreadyInGroup ||
                        state.mutations.isAddingDestination
                      }
                      className="py-2"
                    >
                      <SocialAccountAvatar
                        platform={opt.platform}
                        name={avatarName}
                        src={opt.avatarUrl}
                        size="sm"
                        selected={isAlreadyInGroup}
                        disabled={Boolean(opt.disabled) || state.derived.disabled}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{platformLabel}</div>
                        {shortLabel ? (
                          <div className="text-muted-foreground truncate text-xs">{shortLabel}</div>
                        ) : null}
                      </div>
                      {isAlreadyInGroup ? <Check className="ml-auto h-4 w-4" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-lg"
            aria-label={state.ui.previewOpen ? 'Hide preview' : 'Open preview'}
            className="text-muted-foreground shadow-none"
            onClick={() => state.ui.setPreviewOpen((open) => !open)}
          >
            {state.ui.previewOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{state.ui.previewOpen ? 'Hide preview' : 'Open preview'}</p>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
