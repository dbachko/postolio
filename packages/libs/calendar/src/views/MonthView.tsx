/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React, { useMemo, useState } from 'react';
import type { Localizer } from '../localizers';
import type { CalendarEventBase } from '../types';
import { useDrop } from 'react-dnd';
import { CreateCta } from '../components/CreateCta';

const ITEM_TYPE = 'PC_CAL_EVENT';

type Props<E extends CalendarEventBase> = {
  date: Date;
  events: E[];
  localizer: Localizer;
  weekStartsOn?: 0 | 1;
  eventComponent?: React.ComponentType<{ event: E }>;
  createCtaComponent?: React.ComponentType<{
    date: Date;
    onClick?: (d: Date) => void;
    disabled?: boolean;
  }>;
  onEventDrop?: (args: {
    event: E;
    start: Date;
    end?: Date;
    targetEvent?: E | null;
  }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  onMoreClick?: (date: Date) => void;
  dragAndDrop?: boolean;
};

function canDragCalendarEvent(event: any): boolean {
  const res = event?.resource ?? {};
  if (res?.placeholder) {
    return false;
  }
  if (res?.status === 'published') {
    return false;
  }
  if (
    typeof res?.item?.optimisticAction === 'string' &&
    res.item.optimisticAction.trim().length > 0
  ) {
    return false;
  }

  const campaignStatus =
    typeof res?.item?.campaignStatus === 'string'
      ? res.item.campaignStatus.trim()
      : typeof res?.campaignStatus === 'string'
        ? res.campaignStatus.trim()
        : '';
  if (campaignStatus === 'paused') {
    return false;
  }

  const publishingQueueItemId =
    typeof res?.item?.publishingQueueItemId === 'string'
      ? res.item.publishingQueueItemId.trim()
      : '';

  const scheduledAt =
    typeof res?.scheduledAt === 'string'
      ? res.scheduledAt.trim()
      : typeof res?.item?.scheduledAt === 'string'
        ? res.item.scheduledAt.trim()
        : '';

  // Allow dragging both queue-managed items (estimated schedules) and pinned schedules.
  return publishingQueueItemId.length > 0 || scheduledAt.length > 0;
}

function normalizeLaneKey(value: unknown): 'post' | 'reel' | 'story' | 'any' | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === 'post' || trimmed === 'reel' || trimmed === 'story' || trimmed === 'any') {
    return trimmed;
  }
  return null;
}

function getDraggedLaneKey(dragged: any): 'post' | 'reel' | 'story' {
  const ct =
    typeof dragged?.resource?.item?.contentType === 'string'
      ? dragged.resource.item.contentType
      : typeof dragged?.resource?.contentType === 'string'
        ? dragged.resource.contentType
        : null;
  const normalized = typeof ct === 'string' ? ct.trim() : '';
  if (normalized === 'reel') {
    return 'reel';
  }
  if (normalized === 'story') {
    return 'story';
  }
  return 'post';
}

function getDraggedPublishingQueueItemId(dragged: any): string {
  const res = dragged?.resource ?? {};
  const id =
    typeof res?.item?.publishingQueueItemId === 'string'
      ? res.item.publishingQueueItemId.trim()
      : '';
  return id;
}

function startOfWeek(date: Date, loc: Localizer, w: 0 | 1 | undefined) {
  return loc.startOfWeek(new Date(date), w);
}

function endOfWeek(date: Date, loc: Localizer, w: 0 | 1 | undefined) {
  return loc.endOfWeek(new Date(date), w);
}

export function MonthView<E extends CalendarEventBase>({
  date,
  events,
  localizer,
  weekStartsOn,
  eventComponent: EventComp,
  createCtaComponent,
  onEventDrop,
  onBackgroundClick,
  onMoreClick,
  dragAndDrop = true,
}: Props<E>) {
  const start = useMemo(
    () => startOfWeek(localizer.startOfMonth(date), localizer, weekStartsOn),
    [date, weekStartsOn]
  );
  const end = useMemo(
    () => endOfWeek(localizer.endOfMonth(date), localizer, weekStartsOn),
    [date, weekStartsOn]
  );
  const days: Date[] = [];
  for (let d = new Date(start); d <= end; d = localizer.addDays(d, 1)) {
    days.push(d);
  }

  function sameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="pc-month">
      <div className="pc-weekdays">
        {Array.from({ length: 7 }).map((_, i) => {
          const label = localizer.format(localizer.addDays(start, i), 'EEE');
          return (
            <div key={i} className="pc-weekday">
              {label}
            </div>
          );
        })}
      </div>
      <div className="pc-weeks">
        {weeks.map((week, wi) => (
          <div key={wi} className="pc-week-row">
            {week.map((day, di) => (
              <MonthCell<E>
                key={di}
                day={day}
                monthDate={date}
                events={events.filter((e) => sameDay(e.start, day))}
                localizer={localizer}
                EventComp={EventComp}
                CreateCtaComp={createCtaComponent}
                onEventDrop={onEventDrop}
                onBackgroundClick={onBackgroundClick}
                onMoreClick={onMoreClick}
                dragAndDrop={dragAndDrop}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthCell<E extends CalendarEventBase>({
  day,
  monthDate,
  events,
  localizer,
  EventComp,
  CreateCtaComp,
  onEventDrop,
  onBackgroundClick,
  onMoreClick,
  dragAndDrop,
}: {
  day: Date;
  monthDate: Date;
  events: E[];
  localizer: Localizer;
  EventComp?: React.ComponentType<{ event: E }>;
  CreateCtaComp?: React.ComponentType<{
    date: Date;
    onClick?: (d: Date) => void;
    disabled?: boolean;
  }>;
  onEventDrop?: (args: {
    event: E;
    start: Date;
    end?: Date;
    targetEvent?: E | null;
  }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  onMoreClick?: (date: Date) => void;
  dragAndDrop: boolean;
}) {
  // Compute day state before DnD so we can use it in canDrop
  const isOtherMonth = day.getMonth() !== monthDate.getMonth();
  const todayKey = localizer.format(new Date(), 'yyyy-LL-dd');
  const dayKey = localizer.format(day, 'yyyy-LL-dd');
  const isPastDay = dayKey < todayKey;
  const isToday = dayKey === todayKey;

  const label = localizer.format(day, 'd');
  const MAX_COLLAPSED = 3;
  const [showAll, setShowAll] = useState(false);
  const maxVisible = showAll ? events.length : MAX_COLLAPSED;
  const visible = events.slice(0, maxVisible);
  const overflow = Math.max(0, events.length - MAX_COLLAPSED);

  return (
    <div
      className={`pc-day ${isOtherMonth ? 'pc-day--muted' : ''} ${isPastDay ? 'pc-day--past' : isToday ? 'pc-day--today' : 'pc-day--future'}`}
      onClick={() => onBackgroundClick?.(day)}
    >
      <div className="pc-day-header">
        <span className="pc-day-label">{label}</span>
      </div>
      <div className="pc-day-events">
        {visible.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            localizer={localizer}
            dragAndDrop={dragAndDrop}
            onEventDrop={onEventDrop}
            EventComp={EventComp}
          />
        ))}
        {overflow > 0 && (
          <button
            type="button"
            className="pc-more"
            onClick={(e) => {
              e.stopPropagation();
              setShowAll((prev) => !prev);
              // onMoreClick is kept for backwards compatibility but no longer controls navigation;
              // consumers can still observe "show more" interactions if needed.
              if (!showAll) {
                onMoreClick?.(day);
              }
            }}
          >
            {showAll ? 'Show less' : `+${overflow} more`}
          </button>
        )}
      </div>
      {!isPastDay &&
        (CreateCtaComp ? (
          <CreateCtaComp date={day} onClick={onBackgroundClick} />
        ) : (
          <CreateCta date={day} onClick={onBackgroundClick} />
        ))}
    </div>
  );
}

import { useDrag } from 'react-dnd';
function EventRow<E extends CalendarEventBase>({
  event,
  localizer,
  dragAndDrop,
  onEventDrop,
  EventComp,
}: {
  event: E;
  localizer: Localizer;
  dragAndDrop: boolean;
  onEventDrop?: (args: {
    event: E;
    start: Date;
    end?: Date;
    targetEvent?: E | null;
  }) => void | Promise<void>;
  EventComp?: React.ComponentType<{ event: E }>;
}) {
  const res: any = (event as any)?.resource || {};
  const isPlaceholder = Boolean(res?.placeholder);
  const canDrag = canDragCalendarEvent(event);

  const [{ isOver, canDrop, isDragging }, drop] = useDrop(
    () => ({
      accept: ITEM_TYPE,
      canDrop: (item: any) => {
        if (!isPlaceholder) {
          return false;
        }
        if (!onEventDrop) {
          return false;
        }

        const isQueueSlot = (() => {
          const msg = event?.resource?.item?.message;
          if (typeof msg === 'string' && msg === 'Queue slot') {
            return true;
          }
          const id = event?.resource?.item?.id ?? event?.id;
          return typeof id === 'string' && id.startsWith('queue-slot:');
        })();
        if (!isQueueSlot) {
          return false;
        }

        // Capacity is only relevant for enqueueing actions; dropping onto a slot always schedules.

        const targetKey = localizer.format(event.start, 'yyyy-LL-dd');
        const todayKey = localizer.format(new Date(), 'yyyy-LL-dd');
        if (targetKey < todayKey) {
          return false;
        }

        const withinNext30Days = (() => {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const end = new Date(start);
          end.setDate(end.getDate() + 30);
          const startKey = localizer.format(start, 'yyyy-LL-dd');
          const endKey = localizer.format(end, 'yyyy-LL-dd');
          return targetKey >= startKey && targetKey <= endKey;
        })();
        if (!withinNext30Days) {
          return false;
        }

        const dragged = item?.event;
        if (!canDragCalendarEvent(dragged)) {
          return false;
        }

        const targetLane = normalizeLaneKey(
          event?.resource?.item?.laneKey ?? event?.resource?.laneKey
        );
        if (!targetLane) {
          return true;
        }
        if (targetLane === 'any') {
          return true;
        }
        return getDraggedLaneKey(dragged) === targetLane;
      },
      drop(item: any) {
        if (!isPlaceholder || !onEventDrop) {
          return;
        }
        const evt: E = item.event;
        const start = new Date(event.start);
        const end = evt.end
          ? new Date(start.getTime() + (evt.end.getTime() - evt.start.getTime()))
          : undefined;
        onEventDrop({ event: evt, start, end, targetEvent: event });
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
        isDragging: monitor.getItemType() === ITEM_TYPE,
      }),
    }),
    [event, isPlaceholder, localizer, onEventDrop]
  );

  const [, drag] = useDrag(
    () => ({ type: ITEM_TYPE, item: { event }, canDrag: () => canDrag }),
    [event, canDrag]
  );

  const refCb = (() => {
    if (!dragAndDrop) {
      return undefined;
    }
    if (isPlaceholder) {
      return drop;
    }
    if (canDrag) {
      return drag;
    }
    return undefined;
  })();

  return (
    <div
      ref={refCb as any}
      className={`pc-event-row ${isPlaceholder && canDrop ? 'pc-event-row--drop-available' : ''} ${isPlaceholder && isDragging && !canDrop ? 'pc-event-row--drop-unavailable' : ''} ${isPlaceholder && isOver && canDrop ? 'pc-event-row--drop' : ''} ${isPlaceholder && isOver && !canDrop ? 'pc-event-row--drop-disabled' : ''}`}
      aria-disabled={canDrag ? undefined : true}
    >
      {EventComp ? (
        <EventComp event={event} />
      ) : (
        <div className="pc-event-default">
          <span className="pc-dot" />
          <span className="pc-title">{event.title || 'Event'}</span>
        </div>
      )}
    </div>
  );
}
