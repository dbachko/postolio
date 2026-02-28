import { CalendarClock, ChevronDown, ListPlus, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getDefaultScheduledAtInput, getPostingActionLabel } from '../../../utils';
import { PostingPopoverContent } from '../../posting-popover-content';
import type { PostingAction, PostingPopoverView, WriteItBarProps } from '../../../types';
import { PrimaryActionButton } from './primary-action-button';

type EditBarProps = Extract<WriteItBarProps, { mode: 'edit' }>;

export type PostingActionSelectorProps = {
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

type PostingActionButtonGroupProps = Pick<
  PostingActionSelectorProps,
  'barProps' | 'postingAction' | 'onEditPrimaryAction'
> & {
  postingActionLabel: string;
};

type PostingActionPopoverPanelProps = Pick<
  PostingActionSelectorProps,
  | 'barProps'
  | 'postingAction'
  | 'postingPopoverView'
  | 'setPostingActionManual'
  | 'setPostingPopoverOpen'
  | 'setPostingPopoverView'
>;

function getPostingActionIcon(postingAction: PostingAction) {
  if (postingAction === 'queue') {
    return <ListPlus className="h-4 w-4" />;
  }
  if (postingAction === 'now') {
    return <Zap className="h-4 w-4" />;
  }
  return <CalendarClock className="h-4 w-4" />;
}

function PostingActionButtonGroup({
  barProps,
  postingAction,
  postingActionLabel,
  onEditPrimaryAction,
}: PostingActionButtonGroupProps) {
  return (
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
            {getPostingActionIcon(postingAction)}
            <span className="truncate">{postingActionLabel}</span>
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
  );
}

function PostingActionPopoverPanel({
  barProps,
  postingAction,
  postingPopoverView,
  setPostingActionManual,
  setPostingPopoverOpen,
  setPostingPopoverView,
}: PostingActionPopoverPanelProps) {
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
          barProps.isSaving ||
          barProps.isUnscheduling ||
          Boolean(barProps.queueOptionDisabled ?? barProps.queueDisabled)
        }
        queueBlocker={barProps.queueOptionBlocker ?? barProps.queueBlocker}
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
        pickSlotDisabled={
          barProps.isSaving || barProps.isUnscheduling || Boolean(barProps.pickSlotDisabled)
        }
        pickSlotBlocker={barProps.pickSlotBlocker}
        showPublishingScheduleCta={
          Boolean(barProps.queueNeedsPublishingSchedule) ||
          Boolean(barProps.pickSlotNeedsPublishingSchedule)
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

export function PostingActionSelector({
  barProps,
  postingAction,
  scheduledAtLabel,
  postingPopoverOpen,
  postingPopoverView,
  setPostingPopoverOpen,
  setPostingPopoverView,
  setPostingActionManual,
  onEditPrimaryAction,
}: PostingActionSelectorProps) {
  const postingActionLabel =
    postingAction === 'datetime' && scheduledAtLabel
      ? scheduledAtLabel
      : getPostingActionLabel(postingAction);

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
      <PostingActionButtonGroup
        barProps={barProps}
        postingAction={postingAction}
        postingActionLabel={postingActionLabel}
        onEditPrimaryAction={onEditPrimaryAction}
      />
      <PostingActionPopoverPanel
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
