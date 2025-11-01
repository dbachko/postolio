import React, { useMemo, useRef } from 'react';
import type { Localizer } from '../localizers';
import type { CalendarEventBase } from '../types';
import { useDrop, useDrag } from 'react-dnd';
import { CreateCta } from '../components/CreateCta';

const ITEM_TYPE = 'PC_CAL_EVENT';

type Props<E extends CalendarEventBase> = {
  date: Date;
  days: number; // 1, 3, 7
  events: E[];
  localizer: Localizer;
  weekStartsOn?: 0 | 1;
  eventComponent?: React.ComponentType<{ event: E }>;
  onEventDrop?: (args: { event: E; start: Date; end?: Date }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  dragAndDrop?: boolean;
};

export function TimeGridView<E extends CalendarEventBase>({
  date,
  days,
  events,
  localizer,
  weekStartsOn,
  eventComponent: EventComp,
  onEventDrop,
  onBackgroundClick,
  dragAndDrop = true,
}: Props<E>) {
  const startOfThisWeek = localizer.startOfWeek(date, weekStartsOn);
  const start = days === 7 ? startOfThisWeek : new Date(date);
  const dayDates = Array.from({ length: days }, (_, i) => localizer.addDays(start, i));

  function isSameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  return (
    <div className="pc-timegrid" style={{ ['--pc-days' as any]: String(days) }}>
      <div className="pc-timegrid-head">
        {dayDates.map((d, i) => (
          <div key={i} className="pc-col-head">
            <div className="pc-col-label">{localizer.format(d, 'LLL d')}</div>
          </div>
        ))}
      </div>
      <div className="pc-timegrid-body">
        {dayDates.map((d, i) => (
          <DayColumn<E>
            key={i}
            date={d}
            events={events.filter((e) => isSameDay(e.start, d))}
            localizer={localizer}
            EventComp={EventComp}
            onEventDrop={onEventDrop}
            onBackgroundClick={onBackgroundClick}
            dragAndDrop={dragAndDrop}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn<E extends CalendarEventBase>({
  date,
  events,
  localizer,
  EventComp,
  onEventDrop,
  onBackgroundClick,
  dragAndDrop,
}: {
  date: Date;
  events: E[];
  localizer: Localizer;
  EventComp?: React.ComponentType<{ event: E }>;
  onEventDrop?: (args: { event: E; start: Date; end?: Date }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  dragAndDrop: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const now = new Date();
  const dayOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isPastDay = dayOnly < todayOnly;
  function withinNext30Days(d: Date) {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 30);
    const dayOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return dayOnly >= start && dayOnly <= end;
  }

  const [{ isOver, canDrop }, drop] = useDrop(
    () => ({
      accept: ITEM_TYPE,
      canDrop: (item: any) => {
        const evt = item?.event;
        if (isPastDay) return false;
        if (!withinNext30Days(date)) return false;
        const status = evt?.resource?.status;
        const isPlaceholder = !!evt?.resource?.placeholder;
        if (status === 'published') return false;
        if (isPlaceholder) return false;
        return true;
      },
      drop(item: any) {
        if (!onEventDrop || !ref.current || isPastDay) return;
        const evt: E = item.event;
        // Preserve original time-of-day; only change the day
        const h = (evt.start || new Date()).getHours();
        const m = (evt.start || new Date()).getMinutes();
        const start = new Date(date);
        start.setHours(h, m, 0, 0);
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
    [onEventDrop, date]
  );
  if (dragAndDrop) drop(ref);

  const sorted = useMemo(() => events.slice().sort((a, b) => +a.start - +b.start), [events]);

  return (
    <div
      className={`pc-daycol ${isPastDay ? 'pc-daycol--past' : ''} ${isOver && canDrop ? 'pc-daycol--drop' : ''}`}
      ref={ref}
      onClick={() => onBackgroundClick?.(date)}
    >
      <div className="pc-daycol-inner">
        {sorted.map((e) => (
          <EventListItem<E> key={e.id} event={e} EventComp={EventComp} />
        ))}
      </div>
      {!isPastDay && <CreateCta date={date} onClick={onBackgroundClick} />}
    </div>
  );
}

function EventListItem<E extends CalendarEventBase>({
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
          <span className="pc-title">{event.title || 'Event'}</span>
        </div>
      )}
    </div>
  );
}
