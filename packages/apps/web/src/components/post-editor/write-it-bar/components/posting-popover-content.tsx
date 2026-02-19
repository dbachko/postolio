import { useMemo } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ArrowLeft, CalendarClock, Check, Clock, ListPlus, Zap } from 'lucide-react';
import { BlockerTooltipMessage } from './blocker-tooltip-message';
import type { PostingAction, PostingPopoverView } from '../types';
import {
  formatTimezoneLocationLabel,
  getDefaultScheduledAtInput,
  normalizeScheduledAtInput,
} from '../utils';

type PostingPopoverContentProps = {
  view: PostingPopoverView;
  postingAction: PostingAction;
  scheduledAt: string;
  brandTimezone: string;
  onSelectQueue: () => void;
  queueDisabled?: boolean;
  queueBlocker?: string | null;
  onSelectNow?: () => void;
  onSelectDateTime: () => void;
  onPickSlot?: (() => void) | null;
  pickSlotDisabled?: boolean;
  pickSlotBlocker?: string | null;
  showPublishingScheduleCta?: boolean;
  onOpenPublishingSchedule?: (() => void) | null;
  onBackToMenu: () => void;
  onDone: () => void;
  onScheduledAtChange: (nextValue: string) => void;
};

export function PostingPopoverContent({
  view,
  postingAction,
  scheduledAt,
  brandTimezone,
  onSelectQueue,
  queueDisabled,
  queueBlocker,
  onSelectNow,
  onSelectDateTime,
  onPickSlot,
  pickSlotDisabled,
  pickSlotBlocker,
  showPublishingScheduleCta,
  onOpenPublishingSchedule,
  onBackToMenu,
  onDone,
  onScheduledAtChange,
}: PostingPopoverContentProps) {
  const timezoneLabel = useMemo(() => formatTimezoneLocationLabel(brandTimezone), [brandTimezone]);

  if (view === 'datetime') {
    const parts =
      scheduledAt && normalizeScheduledAtInput(scheduledAt)
        ? normalizeScheduledAtInput(scheduledAt)!
        : normalizeScheduledAtInput(getDefaultScheduledAtInput(brandTimezone))!;
    const selectedDate = new Date(`${parts.datePart}T12:00:00`);

    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">Set date and time</div>
        </div>

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(d) => {
            if (!d) return;
            const nextDate = format(d, 'yyyy-MM-dd');
            onScheduledAtChange(`${nextDate}T${parts.timePart}`);
          }}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Select time
            </div>
            {timezoneLabel ? (
              <div className="bg-muted border-border text-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
                {timezoneLabel}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-background border-border flex flex-1 items-center gap-2 rounded-md border px-3 py-2">
              <Clock className="text-muted-foreground h-4 w-4" />
              <Input
                type="time"
                value={parts.timePart}
                onChange={(e) => {
                  const nextTime = e.target.value;
                  if (!/^\d{2}:\d{2}$/.test(nextTime)) return;
                  onScheduledAtChange(`${parts.datePart}T${nextTime}`);
                }}
                className="h-8 border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onBackToMenu}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            More actions
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  const showNow = Boolean(onSelectNow);

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Posting</div>
        <div className="text-muted-foreground text-xs">
          Choose how this post should be published.
        </div>
      </div>

      <div className="space-y-1">
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
                onClick={() => {
                  if (queueDisabled) return;
                  onSelectQueue();
                }}
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

        {showNow ? (
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
              {postingAction === 'now' ? (
                <Check className="h-4 w-4" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">Now</div>
              <div className="text-muted-foreground text-xs">Publish your post right away.</div>
            </div>
          </Button>
        ) : null}

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

        {onPickSlot ? (
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
                  onClick={() => {
                    if (pickSlotDisabled) return;
                    onPickSlot();
                  }}
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
        ) : null}

        {showPublishingScheduleCta && onOpenPublishingSchedule ? (
          <div className="pt-1">
            <Button
              type="button"
              variant="link"
              className="h-auto px-0 text-xs"
              onClick={onOpenPublishingSchedule}
            >
              Set up Publishing Schedule
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
