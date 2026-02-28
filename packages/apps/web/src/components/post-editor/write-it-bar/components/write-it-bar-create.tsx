import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PostEditorFooterRow } from '@/components/post-editor/post-editor-footer-row';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../types';
import { CreatePostingActions } from './create-posting-actions';
import { ScheduleLimitAlert } from './schedule-limit-alert';

type CreateBarProps = Extract<WriteItBarProps, { mode: 'create' }>;

type WriteItBarCreateProps = {
  barProps: CreateBarProps;
  scheduleLimitDismissed: boolean;
  onScheduleLimitDismiss: () => void;
  postingAction: PostingAction;
  scheduledAtLabel: string | null;
  postingPopoverOpen: boolean;
  postingPopoverView: PostingPopoverView;
  setPostingPopoverOpen: (open: boolean) => void;
  setPostingPopoverView: (view: PostingPopoverView) => void;
  setPostingActionManual: (next: PostingAction) => void;
};

export function WriteItBarCreate({
  barProps,
  scheduleLimitDismissed,
  onScheduleLimitDismiss,
  postingAction,
  scheduledAtLabel,
  postingPopoverOpen,
  postingPopoverView,
  setPostingPopoverOpen,
  setPostingPopoverView,
  setPostingActionManual,
}: WriteItBarCreateProps) {
  return (
    <div className="space-y-3">
      {barProps.atCapacity && !scheduleLimitDismissed ? (
        <ScheduleLimitAlert barProps={barProps} onDismiss={onScheduleLimitDismiss} />
      ) : null}

      <TooltipProvider>
        <PostEditorFooterRow
          leading={barProps.leadingActions}
          left={
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (barProps.saveDraftDisabled) {
                      return;
                    }
                    barProps.onSaveDraft();
                  }}
                  disabled={barProps.isCreatingPost}
                  aria-disabled={barProps.saveDraftDisabled}
                  className={cn(
                    barProps.saveDraftDisabled &&
                      !barProps.isCreatingPost &&
                      'hover:text-foreground cursor-not-allowed opacity-50 hover:bg-transparent'
                  )}
                >
                  Save draft
                </Button>
              </TooltipTrigger>
              {barProps.saveDraftBlocker ? (
                <TooltipContent>
                  <p className="text-sm">{barProps.saveDraftBlocker}</p>
                </TooltipContent>
              ) : null}
            </Tooltip>
          }
          right={
            <CreatePostingActions
              barProps={barProps}
              postingAction={postingAction}
              scheduledAtLabel={scheduledAtLabel}
              postingPopoverOpen={postingPopoverOpen}
              postingPopoverView={postingPopoverView}
              setPostingPopoverOpen={setPostingPopoverOpen}
              setPostingPopoverView={setPostingPopoverView}
              setPostingActionManual={setPostingActionManual}
            />
          }
        />
      </TooltipProvider>
    </div>
  );
}
