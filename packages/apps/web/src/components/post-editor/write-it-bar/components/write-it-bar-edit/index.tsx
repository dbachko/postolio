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
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PostEditorFooterRow } from '@/components/post-editor/post-editor-footer-row';
import { cn } from '@/lib/utils';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../../types';
import { PostingActionSelector } from './components/posting-action-selector';

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

function MoveToDraftAction({ barProps }: { barProps: EditBarProps }) {
  return (
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
            We&apos;ll cancel the scheduled publish time and move this post back to Drafts. It will
            no longer publish automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={barProps.isUnscheduling}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={barProps.onUnschedule} disabled={barProps.isUnscheduling}>
            Unschedule and move to Drafts
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SaveDraftAction({ barProps }: { barProps: EditBarProps }) {
  return (
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
            if (barProps.isSaving || barProps.isUnscheduling || !barProps.hasChanges) {
              return;
            }
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
  );
}

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
  const leftAction = barProps.isScheduled ? (
    <MoveToDraftAction barProps={barProps} />
  ) : (
    <SaveDraftAction barProps={barProps} />
  );

  return (
    <TooltipProvider>
      <PostEditorFooterRow
        leading={barProps.leadingActions}
        left={leftAction}
        right={
          <PostingActionSelector
            barProps={barProps}
            postingAction={postingAction}
            scheduledAtLabel={scheduledAtLabel}
            postingPopoverOpen={postingPopoverOpen}
            postingPopoverView={postingPopoverView}
            setPostingPopoverOpen={setPostingPopoverOpen}
            setPostingPopoverView={setPostingPopoverView}
            setPostingActionManual={setPostingActionManual}
            onEditPrimaryAction={onEditPrimaryAction}
          />
        }
      />
    </TooltipProvider>
  );
}
