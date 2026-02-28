import { CalendarClock, ChevronDown, ListPlus, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../types';
import { getDefaultScheduledAtInput, getPostingActionLabel } from '../utils';
import { BlockerTooltipMessage } from './blocker-tooltip-message';
import { PostingPopoverContent } from './posting-popover-content';

type CreateBarProps = Extract<WriteItBarProps, { mode: 'create' }>;

type CreatePostingActionsProps = {
  barProps: CreateBarProps;
  postingAction: PostingAction;
  scheduledAtLabel: string | null;
  postingPopoverOpen: boolean;
  postingPopoverView: PostingPopoverView;
  setPostingPopoverOpen: (open: boolean) => void;
  setPostingPopoverView: (view: PostingPopoverView) => void;
  setPostingActionManual: (next: PostingAction) => void;
};

function PostingActionIcon({ postingAction }: { postingAction: PostingAction }) {
  if (postingAction === 'queue') {
    return <ListPlus className="h-4 w-4" />;
  }
  if (postingAction === 'now') {
    return <Zap className="h-4 w-4" />;
  }
  return <CalendarClock className="h-4 w-4" />;
}

function PostingActionTrigger({
  postingAction,
  scheduledAtLabel,
  isCreatingPost,
}: {
  postingAction: PostingAction;
  scheduledAtLabel: string | null;
  isCreatingPost: boolean;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-w-0 flex-1 justify-between sm:flex-none"
        disabled={isCreatingPost}
      >
        <span className="flex items-center gap-2">
          <PostingActionIcon postingAction={postingAction} />
          <span className="truncate">
            {postingAction === 'datetime' && scheduledAtLabel
              ? scheduledAtLabel
              : getPostingActionLabel(postingAction)}
          </span>
        </span>
        <ChevronDown className="text-muted-foreground size-4" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
  );
}

function QueueSubmitButton({ barProps }: { barProps: CreateBarProps }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (!barProps.isCreatingPost && !barProps.queueDisabled) {
              barProps.onAddToQueue();
            }
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
  );
}

function PublishNowSubmitButton({ barProps }: { barProps: CreateBarProps }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (!barProps.isCreatingPost && !barProps.publishNowDisabled) {
              barProps.onPublishNow();
            }
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
  );
}

function ScheduleSubmitButton({ barProps }: { barProps: CreateBarProps }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (!barProps.isCreatingPost && !barProps.createScheduleDisabled) {
              barProps.onSchedule();
            }
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
  );
}

function PostingSubmitButton({
  postingAction,
  barProps,
}: {
  postingAction: PostingAction;
  barProps: CreateBarProps;
}) {
  if (postingAction === 'queue') {
    return <QueueSubmitButton barProps={barProps} />;
  }
  if (postingAction === 'now') {
    return <PublishNowSubmitButton barProps={barProps} />;
  }
  return <ScheduleSubmitButton barProps={barProps} />;
}

function PostingActionsPopoverContent({
  barProps,
  postingAction,
  postingPopoverView,
  setPostingActionManual,
  setPostingPopoverOpen,
  setPostingPopoverView,
}: {
  barProps: CreateBarProps;
  postingAction: PostingAction;
  postingPopoverView: PostingPopoverView;
  setPostingActionManual: (next: PostingAction) => void;
  setPostingPopoverOpen: (open: boolean) => void;
  setPostingPopoverView: (view: PostingPopoverView) => void;
}) {
  return (
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
          barProps.isCreatingPost || Boolean(barProps.queueOptionDisabled ?? barProps.queueDisabled)
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
            barProps.onScheduledAtChange(getDefaultScheduledAtInput(barProps.brandTimezone));
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
          barProps.queueNeedsPublishingSchedule || barProps.pickSlotNeedsPublishingSchedule
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
  );
}

export function CreatePostingActions({
  barProps,
  postingAction,
  scheduledAtLabel,
  postingPopoverOpen,
  postingPopoverView,
  setPostingPopoverOpen,
  setPostingPopoverView,
  setPostingActionManual,
}: CreatePostingActionsProps) {
  return (
    <Popover
      open={postingPopoverOpen}
      onOpenChange={(open) => {
        setPostingPopoverOpen(open);
        if (!open) {
          setPostingPopoverView('menu');
        }
      }}
    >
      <ButtonGroup className="w-full sm:w-auto">
        <PostingActionTrigger
          postingAction={postingAction}
          scheduledAtLabel={scheduledAtLabel}
          isCreatingPost={barProps.isCreatingPost}
        />
        <PostingSubmitButton postingAction={postingAction} barProps={barProps} />
      </ButtonGroup>

      <PostingActionsPopoverContent
        barProps={barProps}
        postingAction={postingAction}
        postingPopoverView={postingPopoverView}
        setPostingActionManual={setPostingActionManual}
        setPostingPopoverOpen={setPostingPopoverOpen}
        setPostingPopoverView={setPostingPopoverView}
      />
    </Popover>
  );
}
