import { Check, Plus } from 'lucide-react';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { getPlatformConfig } from '@/lib/platform-config';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { DestinationsRail, DestinationsRailItem } from '@/components/post-editor/destinations-rail';
import { PostEditorMainBody } from '@/components/post-editor/post-editor-main-body';

import type { PostEditorState } from '../hooks/use-post-editor';

export function PostEditorSingleSidebarLayout({
  state,
  previewPanel,
  inlinePreviewPanel,
  previewToggleButton,
}: {
  state: PostEditorState;
  previewPanel: React.ReactNode;
  inlinePreviewPanel: React.ReactNode;
  previewToggleButton: React.ReactNode;
}) {
  const multiDestinationEnabled = state.flags.multiDestinationEnabled;
  if (!multiDestinationEnabled) {
    return (
      <div className="flex min-h-0 flex-1">
        <div className={state.derived.bodyClass}>
          {state.preview.showPreviewAsBody ? (
            previewPanel
          ) : (
            <>
              {inlinePreviewPanel}
              {state.preview.showInlinePreviewToggle ? (
                <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
              ) : null}
              <PostEditorMainBody
                mode="edit"
                allowMixedMedia={state.derived.allowMixedMedia}
                disabled={state.derived.disabled}
                isLoading={state.data.isPostLoading}
                post={state.data.post}
                selectedBrand={state.selectedBrand}
                formData={state.form.formData}
                setFormData={(updater) => state.form.setFormData((prev) => updater(prev))}
                firstCommentOpen={state.form.firstCommentOpen}
                setFirstCommentOpen={state.form.setFirstCommentOpen}
                onOpenAssetPicker={() => {
                  state.ui.setAssetPickerTarget('destination');
                  state.ui.setShowAssetPicker(true);
                }}
                platformOptions={state.data.platformPickerOptions}
                selectedPlatformAccountIds={state.destinations.selectedPlatformAccountIds}
                onSelectedPlatformAccountIdsChange={state.destinations.handlePlatformAccountsChange}
              />
            </>
          )}
        </div>

        {state.preview.showPreviewInColumn ? previewPanel : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <DestinationsRail
        title="Destinations"
        required
        footer={
          <>
            {multiDestinationEnabled ? (
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
                          aria-invalid={state.destinations.showDestinationsRequiredError}
                          className={cn(
                            'text-muted-foreground shadow-none',
                            state.destinations.showDestinationsRequiredError &&
                              'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20 dark:border-destructive dark:bg-destructive/10 dark:hover:bg-destructive/20'
                          )}
                          disabled={
                            state.derived.disabled ||
                            state.mutations.isSaving ||
                            state.mutations.isAddingContentDestination
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-sm">
                      {state.derived.disabled
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
                          const isAlreadySelected =
                            opt.id === state.destinations.selectedTargetSocialAccountId;
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
                                if (isAlreadySelected) return;
                                state.destinations.setEditDestinationsPopoverOpen(false);
                                void state.destinationActions.handleAddDestinationToSingle(opt.id);
                              }}
                              disabled={
                                Boolean(opt.disabled) ||
                                state.derived.disabled ||
                                isAlreadySelected ||
                                state.mutations.isAddingContentDestination
                              }
                              className="py-2"
                            >
                              <SocialAccountAvatar
                                platform={opt.platform}
                                name={avatarName}
                                src={opt.avatarUrl}
                                size="sm"
                                selected={isAlreadySelected}
                                disabled={Boolean(opt.disabled) || state.derived.disabled}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium">{platformLabel}</div>
                                {shortLabel ? (
                                  <div className="text-muted-foreground truncate text-xs">
                                    {shortLabel}
                                  </div>
                                ) : null}
                              </div>
                              {isAlreadySelected ? <Check className="ml-auto h-4 w-4" /> : null}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : null}
          </>
        }
      >
        {(() => {
          if (!state.destinations.selectedTargetSocialAccountId) return null;
          const opt = state.data.platformPickerOptions.find(
            (entry) => entry.id === state.destinations.selectedTargetSocialAccountId
          );
          if (!opt) return null;
          const platformConfig = getPlatformConfig(opt.platform);
          const platformLabel = platformConfig.displayName;
          const shortLabel = opt.label?.trim() || '';
          const tooltipLabel = shortLabel ? `${platformLabel} · ${shortLabel}` : platformLabel;
          const avatarName = opt.avatarName?.trim() || shortLabel || platformLabel;
          return (
            <DestinationsRailItem tooltip={tooltipLabel} ariaLabel={tooltipLabel} selected>
              <SocialAccountAvatar
                platform={opt.platform}
                name={avatarName}
                src={opt.avatarUrl}
                size="sm"
                selected
              />
            </DestinationsRailItem>
          );
        })()}
      </DestinationsRail>

      <div className={state.derived.bodyClass}>
        {state.preview.showPreviewAsBody ? (
          previewPanel
        ) : (
          <>
            {inlinePreviewPanel}
            {state.preview.showInlinePreviewToggle ? (
              <div className="flex items-center justify-end pb-2">{previewToggleButton}</div>
            ) : null}
            <PostEditorMainBody
              mode="edit"
              allowMixedMedia={state.derived.allowMixedMedia}
              disabled={state.derived.disabled}
              isLoading={state.data.isPostLoading}
              post={state.data.post}
              selectedBrand={state.selectedBrand}
              formData={state.form.formData}
              setFormData={(updater) => state.form.setFormData((prev) => updater(prev))}
              firstCommentOpen={state.form.firstCommentOpen}
              setFirstCommentOpen={state.form.setFirstCommentOpen}
              onOpenAssetPicker={() => {
                state.ui.setAssetPickerTarget('destination');
                state.ui.setShowAssetPicker(true);
              }}
              platformOptions={state.data.platformPickerOptions}
              selectedPlatformAccountIds={state.destinations.selectedPlatformAccountIds}
              onSelectedPlatformAccountIdsChange={state.destinations.handlePlatformAccountsChange}
            />
          </>
        )}
      </div>

      {state.preview.showPreviewInColumn ? previewPanel : null}

      {multiDestinationEnabled ? (
        <Dialog
          open={state.destinations.editDestinationsHelpOpen}
          onOpenChange={state.destinations.setEditDestinationsHelpOpen}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Destinations</DialogTitle>
              <DialogDescription>
                Add more destinations to turn this post into a multi-destination group.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <div className="text-foreground font-medium">What happens when you add</div>
                <p className="text-muted-foreground">
                  We create a shared template from your current post and generate a destination post
                  for each social account you add.
                </p>
              </div>
              <div className="space-y-1">
                <div className="text-foreground font-medium">Editing</div>
                <p className="text-muted-foreground">
                  You can keep one template for the group and customize each destination
                  individually.
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
