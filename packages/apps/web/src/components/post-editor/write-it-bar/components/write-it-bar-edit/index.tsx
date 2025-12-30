import { CalendarClock, ChevronDown, ListPlus, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { PostEditorFooterRow } from '@/components/post-editor/post-editor-footer-row';

import { PostingPopoverContent } from '../posting-popover-content';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../../types';
import { getDefaultScheduledAtInput, getPostingActionLabel } from '../../utils';
import { PrimaryActionButton } from './components/primary-action-button';

type EditBarProps = Extract<WriteItBarProps, { mode: 'edit' }>;

type WriteItBarEditProps = {
  barProps: EditBarProps;
  postingAction: PostingAction;
  scheduledAtLabel: string | null;
  postingPopoverOpen: boolean;
  postingPopoverView: PostingPopoverView;
  setPostingPopoverOpen: (open: boolean) => void;
  setPostingPopoverView: (view: PostingPopoverView) => void;
  setPostingActionManual: (next: PostingAction) => void;
  onEditPrimaryAction: () => void | Promise<void>;
};

export function WriteItBarEdit({
  barProps,
  postingAction,
  scheduledAtLabel,
  postingPopoverOpen,
  postingPopoverView,
  setPostingPopoverOpen,
  setPostingPopoverView,
  setPostingActionManual,
  onEditPrimaryAction,
}: WriteItBarEditProps) {
  return (
    <TooltipProvider>
      <PostEditorFooterRow
        leading={barProps.leadingActions}
        left={
          barProps.isScheduled ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={barProps.isUnscheduling}>
                  Move to Draft
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unschedule this post?</AlertDialogTitle>
                  <AlertDialogDescription>
                    We’ll cancel the scheduled publish time and move this post back to Drafts. It
                    will no longer publish automatically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={barProps.isUnscheduling}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={barProps.onUnschedule}
                    disabled={barProps.isUnscheduling}
                  >
                    Unschedule and move to Drafts
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={barProps.isSaving || barProps.isUnscheduling}
                  aria-disabled={!barProps.hasChanges}
                  className={cn(
                    !barProps.hasChanges &&
                      !barProps.isSaving &&
                      !barProps.isUnscheduling &&
                      'hover:text-foreground cursor-not-allowed opacity-50 hover:bg-transparent'
                  )}
                  onClick={() => {
                    if (barProps.isSaving || barProps.isUnscheduling) return;
                    if (!barProps.hasChanges) return;
                    barProps.onSave();
                  }}
                >
                  Save draft
                </Button>
              </TooltipTrigger>
              {!barProps.hasChanges ? (
                <TooltipContent>
                  <p className="text-sm">No changes to save.</p>
                </TooltipContent>
              ) : null}
            </Tooltip>
          )
        }
        right={
          <Popover
            open={postingPopoverOpen}
            onOpenChange={(open) => {
              setPostingPopoverOpen(open);
              if (!open) setPostingPopoverView('menu');
            }}
          >
            <ButtonGroup className="w-full sm:w-auto">
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-w-0 flex-1 justify-between sm:flex-none"
                  disabled={barProps.isSaving || barProps.isUnscheduling}
                >
                  <span className="flex items-center gap-2">
                    {postingAction === 'queue' ? (
                      <ListPlus className="h-4 w-4" />
                    ) : postingAction === 'now' ? (
                      <Zap className="h-4 w-4" />
                    ) : (
                      <CalendarClock className="h-4 w-4" />
                    )}
                    <span className="truncate">
                      {postingAction === 'datetime' && scheduledAtLabel
                        ? scheduledAtLabel
                        : getPostingActionLabel(postingAction)}
                    </span>
                  </span>
                  <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>

              <PrimaryActionButton
                barProps={barProps}
                postingAction={postingAction}
                onEditPrimaryAction={onEditPrimaryAction}
              />
            </ButtonGroup>

            <PopoverContent
              align="end"
              className={cn(
                postingPopoverView === 'datetime' ? 'w-fit' : 'w-[340px]',
                'max-w-[calc(100vw-2rem)] p-3'
              )}
            >
              <PostingPopoverContent
                view={postingPopoverView}
                postingAction={postingAction}
                scheduledAt={barProps.scheduledAt}
                brandTimezone={barProps.brandTimezone}
                onSelectQueue={() => {
                  setPostingActionManual('queue');
                  setPostingPopoverOpen(false);
                  setPostingPopoverView('menu');
                }}
                onSelectNow={
                  barProps.onPublishNow
                    ? () => {
                        setPostingActionManual('now');
                        setPostingPopoverOpen(false);
                        setPostingPopoverView('menu');
                      }
                    : undefined
                }
                onSelectDateTime={() => {
                  setPostingActionManual('datetime');
                  if (!barProps.scheduledAt) {
                    barProps.onScheduledAtChange(
                      getDefaultScheduledAtInput(barProps.brandTimezone)
                    );
                  }
                  setPostingPopoverView('datetime');
                }}
                onPickSlot={
                  barProps.onPickSlot
                    ? () => {
                        setPostingActionManual('datetime');
                        setPostingPopoverOpen(false);
                        setPostingPopoverView('menu');
                        barProps.onPickSlot?.();
                      }
                    : null
                }
                pickSlotDisabled={
                  barProps.isSaving || barProps.isUnscheduling || Boolean(barProps.pickSlotDisabled)
                }
                pickSlotBlocker={barProps.pickSlotBlocker}
                onBackToMenu={() => setPostingPopoverView('menu')}
                onDone={() => {
                  setPostingPopoverOpen(false);
                  setPostingPopoverView('menu');
                }}
                onScheduledAtChange={barProps.onScheduledAtChange}
              />
            </PopoverContent>
          </Popover>
        }
      />
    </TooltipProvider>
  );
}
