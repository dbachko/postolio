/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React, { useMemo, useRef, useState } from 'react';
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
  onEventDrop?: (args: { event: E; start: Date; end?: Date }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  onMoreClick?: (date: Date) => void;
  dragAndDrop?: boolean;
};

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
  for (let d = new Date(start); d <= end; d = localizer.addDays(d, 1)) days.push(d);

  function sameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

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
  onEventDrop?: (args: { event: E; start: Date; end?: Date }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  onMoreClick?: (date: Date) => void;
  dragAndDrop: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Compute day state before DnD so we can use it in canDrop
  const isOtherMonth = day.getMonth() !== monthDate.getMonth();
  const todayKey = localizer.format(new Date(), 'yyyy-LL-dd');
  const dayKey = localizer.format(day, 'yyyy-LL-dd');
  const isPastDay = dayKey < todayKey;
  const isToday = dayKey === todayKey;
  function withinNext30Days(d: Date) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    const startKey = localizer.format(start, 'yyyy-LL-dd');
    const endKey = localizer.format(end, 'yyyy-LL-dd');
    const dKey = localizer.format(d, 'yyyy-LL-dd');
    return dKey >= startKey && dKey <= endKey;
  }

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ITEM_TYPE,
      canDrop: (item: any) => {
        const evt = item?.event;
        if (isPastDay) return false;
        if (!withinNext30Days(day)) return false;
        const status = evt?.resource?.status;
        const isPlaceholder = !!evt?.resource?.placeholder;
        if (status === 'published') return false;
        if (isPlaceholder) return false;
        return true;
      },
      drop(item: any) {
        if (!onEventDrop || isPastDay) return;
        const evt: E = item.event;
        const start = new Date(day);
        start.setHours(
          (evt.start || new Date()).getHours(),
          (evt.start || new Date()).getMinutes(),
          0,
          0
        );
        const end = evt.end
          ? new Date(start.getTime() + (evt.end.getTime() - evt.start.getTime()))
          : undefined;
        onEventDrop({ event: evt, start, end });
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [day, onEventDrop]
  );
  if (dragAndDrop) drop(ref);

  const label = localizer.format(day, 'd');
  const MAX_COLLAPSED = 3;
  const [showAll, setShowAll] = useState(false);
  const maxVisible = showAll ? events.length : MAX_COLLAPSED;
  const visible = events.slice(0, maxVisible);
  const overflow = Math.max(0, events.length - MAX_COLLAPSED);

  return (
    <div
      ref={ref}
      className={`pc-day ${isOtherMonth ? 'pc-day--muted' : ''} ${isPastDay ? 'pc-day--past' : isToday ? 'pc-day--today' : 'pc-day--future'} ${isOver && canDrop ? 'pc-day--drop' : ''}`}
      onClick={() => onBackgroundClick?.(day)}
    >
      <div className="pc-day-header">
        <span className="pc-day-label">{label}</span>
      </div>
      <div className="pc-day-events">
        {visible.map((e) => (
          <EventRow key={e.id} event={e} EventComp={EventComp} />
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
  EventComp,
}: {
  event: E;
  EventComp?: React.ComponentType<{ event: E }>;
}) {
  const res: any = (event as any)?.resource || {};
  const canDrag = !(res?.status === 'published' || !!res?.placeholder);
  const [, drag] = useDrag(
    () => ({ type: ITEM_TYPE, item: { event }, canDrag: () => canDrag }),
    [event, canDrag]
  );
  const refCb = canDrag ? drag : undefined;
  return (
    <div
      ref={refCb as any}
      className="pc-event-row"
      aria-disabled={canDrag ? undefined : true}
      title={canDrag ? undefined : 'Cannot reschedule published or AI placeholder posts'}
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
