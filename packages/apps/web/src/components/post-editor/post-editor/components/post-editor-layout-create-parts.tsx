import { Check, Eye, EyeOff, Plus } from 'lucide-react';

import { DestinationsRail, DestinationsRailItem } from '@/components/post-editor/destinations-rail';
import { PostEditorMainBody } from '@/components/post-editor/post-editor-main-body';
import { SocialAccountAvatar } from '@/components/social/social-account-avatar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getPlatformConfig } from '@/lib/platform-config';
import { cn } from '@/lib/utils';

import type { PostEditorState } from '../hooks/use-post-editor';

function CreateMainBody({
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
  return (
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
            mode="create"
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
            showDestinationsPicker={false}
          />
        </>
      )}
    </div>
  );
}

function CreateDestinationPicker({ state }: { state: PostEditorState }) {
  return (
    <Popover
      open={state.destinations.createDestinationsPopoverOpen}
      onOpenChange={state.destinations.setCreateDestinationsPopoverOpen}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-lg"
                aria-label={
                  state.flags.multiDestinationEnabled ? 'Add destinations' : 'Choose destination'
                }
                aria-invalid={state.destinations.showDestinationsRequiredError}
                className={cn(
                  'text-muted-foreground shadow-none',
                  state.destinations.showDestinationsRequiredError &&
                    'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20 dark:border-destructive dark:bg-destructive/10 dark:hover:bg-destructive/20'
                )}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            {state.flags.multiDestinationEnabled ? 'Add destinations' : 'Choose destination'}
          </p>
        </TooltipContent>
      </Tooltip>

      <PopoverContent side="right" align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search destinations…" />
          <CommandList>
            <CommandEmpty>No destinations found.</CommandEmpty>
            <CommandGroup>
              {state.data.platformPickerOptions.map((option) => (
                <CreateDestinationPickerItem key={option.id} state={state} option={option} />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CreateDestinationPickerItem({
  state,
  option,
}: {
  state: PostEditorState;
  option: PostEditorState['data']['platformPickerOptions'][number];
}) {
  const isSelected = state.destinations.selectedPlatformAccountIds.includes(option.id);
  const platformLabel = getPlatformConfig(option.platform).displayName;
  const shortLabel = option.label?.trim() || '';
  const avatarName = option.avatarName?.trim() || shortLabel || platformLabel;

  return (
    <CommandItem
      value={`${platformLabel} ${shortLabel} ${avatarName}`.trim()}
      onSelect={() => state.destinations.toggleCreateDestination(option.id)}
      className="py-2"
    >
      <SocialAccountAvatar
        platform={option.platform}
        name={avatarName}
        src={option.avatarUrl}
        size="sm"
        selected={isSelected}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{platformLabel}</div>
        {shortLabel ? (
          <div className="text-muted-foreground truncate text-xs">{shortLabel}</div>
        ) : null}
      </div>
      {isSelected ? <Check className="ml-auto h-4 w-4" /> : null}
    </CommandItem>
  );
}

function CreateRailFooter({ state }: { state: PostEditorState }) {
  return (
    <>
      <CreateDestinationPicker state={state} />
      {state.layout !== 'sidebar' ? (
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
      ) : null}
    </>
  );
}

function CreateRailItems({ state }: { state: PostEditorState }) {
  return (
    <>
      {state.destinations.createSelectedDestinations.map((option) => {
        const platformLabel = getPlatformConfig(option.platform).displayName;
        const shortLabel = option.label?.trim() || '';
        const tooltipLabel = shortLabel ? `${platformLabel} · ${shortLabel}` : platformLabel;
        const avatarName = option.avatarName?.trim() || shortLabel || platformLabel;

        return (
          <DestinationsRailItem
            key={option.id}
            tooltip={tooltipLabel}
            ariaLabel={`Remove ${tooltipLabel}`}
            selected
            showDeleteOnHover
            onClick={() => state.destinations.toggleCreateDestination(option.id)}
          >
            <SocialAccountAvatar
              platform={option.platform}
              name={avatarName}
              src={option.avatarUrl}
              size="sm"
              selected
            />
          </DestinationsRailItem>
        );
      })}
    </>
  );
}

function CreateDestinationsHelpDialog({ state }: { state: PostEditorState }) {
  const multiDestinationEnabled = state.flags.multiDestinationEnabled;
  return (
    <Dialog
      open={state.destinations.createDestinationsHelpOpen}
      onOpenChange={state.destinations.setCreateDestinationsHelpOpen}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Destinations</DialogTitle>
          <DialogDescription>
            {multiDestinationEnabled
              ? 'Choose which social accounts this post should publish to.'
              : 'Choose the Instagram destination for this post.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <div className="text-foreground font-medium">Single destination</div>
            <p className="text-muted-foreground">Creates one post for one social account.</p>
          </div>
          {multiDestinationEnabled ? (
            <div className="space-y-1">
              <div className="text-foreground font-medium">Multiple destinations</div>
              <p className="text-muted-foreground">
                Creates a grouped post. After saving, you can customize each destination in tabs
                while keeping a shared template.
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <div className="text-foreground font-medium">How to select</div>
            <p className="text-muted-foreground">
              Use the <span className="text-foreground font-medium">+</span> button to add or
              {multiDestinationEnabled ? ' remove destinations.' : ' change the destination.'}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PostEditorCreateLayoutSingleDestination(props: {
  state: PostEditorState;
  previewPanel: React.ReactNode;
  inlinePreviewPanel: React.ReactNode;
  previewToggleButton: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <CreateMainBody {...props} />
      {props.state.preview.showPreviewInColumn ? props.previewPanel : null}
    </div>
  );
}

export function PostEditorCreateLayoutMultiDestination(props: {
  state: PostEditorState;
  previewPanel: React.ReactNode;
  inlinePreviewPanel: React.ReactNode;
  previewToggleButton: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <DestinationsRail
        title="Destinations"
        required
        footer={<CreateRailFooter state={props.state} />}
      >
        <CreateRailItems state={props.state} />
      </DestinationsRail>

      <CreateMainBody {...props} />
      {props.state.preview.showPreviewInColumn ? props.previewPanel : null}
      <CreateDestinationsHelpDialog state={props.state} />
    </div>
  );
}
