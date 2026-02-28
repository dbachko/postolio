import { CalendarClock, Check, ListPlus, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { BlockerTooltipMessage } from './blocker-tooltip-message';
import type { PostingAction } from '../types';

export type QueueOptionProps = {
  postingAction: PostingAction;
  onSelectQueue: () => void;
  queueDisabled?: boolean;
  queueBlocker?: string | null;
};

export type NowOptionProps = {
  postingAction: PostingAction;
  onSelectNow?: () => void;
};

export type DateTimeOptionProps = {
  postingAction: PostingAction;
  onSelectDateTime: () => void;
};

export type PickSlotOptionProps = {
  onPickSlot?: (() => void) | null;
  pickSlotDisabled?: boolean;
  pickSlotBlocker?: string | null;
};

export function QueueOption({
  postingAction,
  onSelectQueue,
  queueDisabled,
  queueBlocker,
}: QueueOptionProps) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span className="block w-full">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
              postingAction === 'queue' && 'bg-muted',
              queueDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
            )}
            disabled={Boolean(queueDisabled)}
            onClick={() => !queueDisabled && onSelectQueue()}
          >
            <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
              {postingAction === 'queue' ? (
                <Check className="h-4 w-4" />
              ) : (
                <ListPlus className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Next available</div>
              <div className="text-muted-foreground text-xs">
                Use the next available posting slot in your queue.
              </div>
            </div>
          </Button>
        </span>
      </TooltipTrigger>
      {queueDisabled ? (
        <TooltipContent>
          {queueBlocker ? (
            <BlockerTooltipMessage message={queueBlocker} />
          ) : (
            <p className="text-sm">This option is not available right now.</p>
          )}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

export function NowOption({ postingAction, onSelectNow }: NowOptionProps) {
  if (!onSelectNow) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
        postingAction === 'now' && 'bg-muted'
      )}
      onClick={onSelectNow}
    >
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
        {postingAction === 'now' ? <Check className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">Now</div>
        <div className="text-muted-foreground text-xs">Publish your post right away.</div>
      </div>
    </Button>
  );
}

export function DateTimeOption({ postingAction, onSelectDateTime }: DateTimeOptionProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
        postingAction === 'datetime' && 'bg-muted'
      )}
      onClick={onSelectDateTime}
    >
      <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
        {postingAction === 'datetime' ? (
          <Check className="h-4 w-4" />
        ) : (
          <CalendarClock className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">Set date and time</div>
        <div className="text-muted-foreground text-xs">Choose a specific time to post.</div>
      </div>
    </Button>
  );
}

export function PickSlotOption({
  onPickSlot,
  pickSlotDisabled,
  pickSlotBlocker,
}: PickSlotOptionProps) {
  if (!onPickSlot) {
    return null;
  }

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <span className="block w-full">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'h-auto w-full items-start justify-start gap-3 rounded-md p-2 text-left whitespace-normal',
              pickSlotDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
            )}
            disabled={Boolean(pickSlotDisabled)}
            onClick={() => !pickSlotDisabled && onPickSlot()}
          >
            <div className="mt-0.5 flex h-5 w-5 items-center justify-center">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Pick a slot</div>
              <div className="text-muted-foreground text-xs">
                Choose a recommended time from your publishing schedule.
              </div>
            </div>
          </Button>
        </span>
      </TooltipTrigger>
      {pickSlotDisabled ? (
        <TooltipContent>
          {pickSlotBlocker ? (
            <BlockerTooltipMessage message={pickSlotBlocker} />
          ) : (
            <p className="text-sm">This option is not available right now.</p>
          )}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
