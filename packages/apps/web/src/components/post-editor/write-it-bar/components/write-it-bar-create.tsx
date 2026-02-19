import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PostEditorFooterRow } from '@/components/post-editor/post-editor-footer-row';
import { AlertTriangle, CalendarClock, ChevronDown, ListPlus, X, Zap } from 'lucide-react';
import { BlockerTooltipMessage } from './blocker-tooltip-message';
import { PostingPopoverContent } from './posting-popover-content';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../types';
import { getDefaultScheduledAtInput, getPostingActionLabel } from '../utils';

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
      {barProps.atCapacity && !scheduleLimitDismissed && (
        <div className="bg-muted border-border text-foreground flex items-start gap-2 rounded-md border p-3 text-xs">
          <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 flex-shrink-0" />
          <div className="flex-1 space-y-1">
            <p className="font-medium">You&apos;ve reached your plan&apos;s scheduling limit.</p>
            <p className="text-muted-foreground">
              You can still save drafts and add posts to your queue, but new scheduled posts will
              fail until you free up slots or{' '}
              <Button
                type="button"
                onClick={() => (barProps.onUpgradePlan ? barProps.onUpgradePlan() : null)}
                variant="link"
                className="h-auto p-0 align-baseline font-medium underline underline-offset-2"
              >
                upgrade your plan
              </Button>
              .
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss scheduling limit alert"
            className="text-muted-foreground hover:text-foreground -mt-1 -mr-1 shrink-0"
            onClick={onScheduleLimitDismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

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
                    if (barProps.saveDraftDisabled) return;
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
                    disabled={barProps.isCreatingPost}
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

                {postingAction === 'queue' ? (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (barProps.isCreatingPost) return;
                          if (barProps.queueDisabled) return;
                          barProps.onAddToQueue();
                        }}
                        disabled={barProps.isCreatingPost}
                        aria-disabled={barProps.queueDisabled}
                        className={cn(
                          barProps.queueDisabled &&
                            !barProps.isCreatingPost &&
                            'hover:bg-primary cursor-not-allowed opacity-50'
                        )}
                      >
                        {barProps.isCreatingPost ? <>Creating...</> : <>Add to queue</>}
                      </Button>
                    </TooltipTrigger>
                    {barProps.queueBlocker ? (
                      <TooltipContent>
                        <BlockerTooltipMessage message={barProps.queueBlocker} />
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                ) : postingAction === 'now' ? (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (barProps.isCreatingPost) return;
                          if (barProps.publishNowDisabled) return;
                          barProps.onPublishNow();
                        }}
                        disabled={barProps.isCreatingPost}
                        aria-disabled={barProps.publishNowDisabled}
                        className={cn(
                          barProps.publishNowDisabled &&
                            !barProps.isCreatingPost &&
                            'hover:bg-primary cursor-not-allowed opacity-50'
                        )}
                      >
                        {barProps.isCreatingPost ? <>Creating...</> : <>Publish</>}
                      </Button>
                    </TooltipTrigger>
                    {barProps.publishNowBlocker ? (
                      <TooltipContent>
                        <BlockerTooltipMessage message={barProps.publishNowBlocker} />
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                ) : (
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          if (barProps.isCreatingPost) return;
                          if (barProps.createScheduleDisabled) return;
                          barProps.onSchedule();
                        }}
                        disabled={barProps.isCreatingPost}
                        aria-disabled={barProps.createScheduleDisabled}
                        className={cn(
                          barProps.createScheduleDisabled &&
                            !barProps.isCreatingPost &&
                            'hover:bg-primary cursor-not-allowed opacity-50'
                        )}
                      >
                        {barProps.isCreatingPost ? <>Creating...</> : <>Schedule</>}
                      </Button>
                    </TooltipTrigger>
                    {barProps.scheduleBlocker ? (
                      <TooltipContent>
                        <BlockerTooltipMessage message={barProps.scheduleBlocker} />
                      </TooltipContent>
                    ) : null}
                  </Tooltip>
                )}
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
                  queueDisabled={
                    barProps.isCreatingPost ||
                    Boolean(barProps.queueOptionDisabled ?? barProps.queueDisabled)
                  }
                  queueBlocker={barProps.queueOptionBlocker ?? barProps.queueBlocker}
                  onSelectQueue={() => {
                    setPostingActionManual('queue');
                    barProps.onScheduledAtChange('');
                    setPostingPopoverOpen(false);
                    setPostingPopoverView('menu');
                  }}
                  onSelectNow={() => {
                    setPostingActionManual('now');
                    barProps.onScheduledAtChange('');
                    setPostingPopoverOpen(false);
                    setPostingPopoverView('menu');
                  }}
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
                  pickSlotDisabled={barProps.isCreatingPost || barProps.pickSlotDisabled}
                  pickSlotBlocker={barProps.pickSlotBlocker}
                  showPublishingScheduleCta={
                    barProps.queueNeedsPublishingSchedule ||
                    barProps.pickSlotNeedsPublishingSchedule
                  }
                  onOpenPublishingSchedule={barProps.onOpenPublishingSchedule}
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
    </div>
  );
}
