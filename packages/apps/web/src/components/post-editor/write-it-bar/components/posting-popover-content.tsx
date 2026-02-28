import { useMemo } from 'react';
import { format } from 'date-fns';
import { ArrowLeft, Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';

import type { PostingAction, PostingPopoverView } from '../types';
import {
  formatTimezoneLocationLabel,
  getDefaultScheduledAtInput,
  normalizeScheduledAtInput,
} from '../utils';
import {
  DateTimeOption,
  NowOption,
  PickSlotOption,
  QueueOption,
} from './posting-popover-action-options';

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

function PostingDateTimeView({
  scheduledAt,
  brandTimezone,
  onBackToMenu,
  onDone,
  onScheduledAtChange,
}: Pick<
  PostingPopoverContentProps,
  'scheduledAt' | 'brandTimezone' | 'onBackToMenu' | 'onDone' | 'onScheduledAtChange'
>) {
  const timezoneLabel = useMemo(() => formatTimezoneLocationLabel(brandTimezone), [brandTimezone]);
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
          if (d) {
            onScheduledAtChange(`${format(d, 'yyyy-MM-dd')}T${parts.timePart}`);
          }
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

        <div className="bg-background border-border flex items-center gap-2 rounded-md border px-3 py-2">
          <Clock className="text-muted-foreground h-4 w-4" />
          <Input
            type="time"
            value={parts.timePart}
            onChange={(e) => {
              if (/^\d{2}:\d{2}$/.test(e.target.value)) {
                onScheduledAtChange(`${parts.datePart}T${e.target.value}`);
              }
            }}
            className="h-8 border-none bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
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

function PostingActionMenu({
  postingAction,
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
}: Pick<
  PostingPopoverContentProps,
  | 'postingAction'
  | 'onSelectQueue'
  | 'queueDisabled'
  | 'queueBlocker'
  | 'onSelectNow'
  | 'onSelectDateTime'
  | 'onPickSlot'
  | 'pickSlotDisabled'
  | 'pickSlotBlocker'
  | 'showPublishingScheduleCta'
  | 'onOpenPublishingSchedule'
>) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Posting</div>
        <div className="text-muted-foreground text-xs">
          Choose how this post should be published.
        </div>
      </div>

      <div className="space-y-1">
        <QueueOption
          postingAction={postingAction}
          onSelectQueue={onSelectQueue}
          queueDisabled={queueDisabled}
          queueBlocker={queueBlocker}
        />
        <NowOption postingAction={postingAction} onSelectNow={onSelectNow} />
        <DateTimeOption postingAction={postingAction} onSelectDateTime={onSelectDateTime} />
        <PickSlotOption
          onPickSlot={onPickSlot}
          pickSlotDisabled={pickSlotDisabled}
          pickSlotBlocker={pickSlotBlocker}
        />

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

export function PostingPopoverContent(props: PostingPopoverContentProps) {
  if (props.view === 'datetime') {
    return (
      <PostingDateTimeView
        scheduledAt={props.scheduledAt}
        brandTimezone={props.brandTimezone}
        onBackToMenu={props.onBackToMenu}
        onDone={props.onDone}
        onScheduledAtChange={props.onScheduledAtChange}
      />
    );
  }

  return (
    <PostingActionMenu
      postingAction={props.postingAction}
      onSelectQueue={props.onSelectQueue}
      queueDisabled={props.queueDisabled}
      queueBlocker={props.queueBlocker}
      onSelectNow={props.onSelectNow}
      onSelectDateTime={props.onSelectDateTime}
      onPickSlot={props.onPickSlot}
      pickSlotDisabled={props.pickSlotDisabled}
      pickSlotBlocker={props.pickSlotBlocker}
      showPublishingScheduleCta={props.showPublishingScheduleCta}
      onOpenPublishingSchedule={props.onOpenPublishingSchedule}
    />
  );
}
