import React, { useMemo, useState } from 'react';
import type { Localizer } from '../localizers';
import type { CalendarEventBase } from '../types';
import { useDrop, useDrag } from 'react-dnd';
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
  dragAndDrop?: boolean;
};

function canDragCalendarEvent(event: any): boolean {
  const res = event?.resource ?? {};
  if (res?.placeholder) return false;
  if (res?.status === 'published') return false;
  if (
    typeof res?.item?.optimisticAction === 'string' &&
    res.item.optimisticAction.trim().length > 0
  )
    return false;

  const campaignStatus =
    typeof res?.item?.campaignStatus === 'string'
      ? res.item.campaignStatus.trim()
      : typeof res?.campaignStatus === 'string'
        ? res.campaignStatus.trim()
        : '';
  if (campaignStatus === 'paused') return false;

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
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === 'post' || trimmed === 'reel' || trimmed === 'story' || trimmed === 'any')
    return trimmed;
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
  if (normalized === 'reel') return 'reel';
  if (normalized === 'story') return 'story';
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

export function TimeGridView<E extends CalendarEventBase>({
  date,
  events,
  localizer,
  weekStartsOn,
  eventComponent: EventComp,
  createCtaComponent,
  onEventDrop,
  onBackgroundClick,
  dragAndDrop = true,
}: Props<E>) {
  const start = localizer.startOfWeek(date, weekStartsOn);
  const dayDates = Array.from({ length: 7 }, (_, i) => localizer.addDays(start, i));
  const todayKey = localizer.format(new Date(), 'yyyy-LL-dd');
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);

  function isSameDay(a: Date, b: Date) {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  return (
    <div className="pc-timegrid" style={{ ['--pc-days' as any]: '7' }}>
      <div className="pc-timegrid-head">
        {dayDates.map((d, i) => {
          const dayKey = localizer.format(d, 'yyyy-LL-dd');
          const isPastDay = dayKey < todayKey;
          const isHovered = hoveredDayIdx === i;
          const CreateCtaComp = createCtaComponent;

          return (
            <div
              key={i}
              className={`pc-col-head ${dayKey === todayKey ? 'pc-col-head--today' : ''}`}
              onMouseEnter={() => setHoveredDayIdx(i)}
              onMouseLeave={() => setHoveredDayIdx((prev) => (prev === i ? null : prev))}
            >
              <div className="pc-col-label">
                <span className="pc-col-label-month">{localizer.format(d, 'LLL')}</span>{' '}
                <span
                  className={`pc-col-label-day ${dayKey === todayKey ? 'pc-col-label-day--today' : ''}`}
                >
                  {localizer.format(d, 'd')}
                </span>
              </div>
              {!isPastDay ? (
                <div
                  className={`pc-week-create-cta ${isHovered ? 'pc-week-create-cta--show' : ''}`}
                >
                  {CreateCtaComp ? (
                    <CreateCtaComp date={d} onClick={onBackgroundClick} disabled={false} />
                  ) : (
                    <CreateCta date={d} onClick={onBackgroundClick} />
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="pc-timegrid-body">
        {dayDates.map((d, i) => (
          <DayColumn<E>
            key={i}
            date={d}
            events={events.filter((e) => isSameDay(e.start, d))}
            localizer={localizer}
            todayKey={todayKey}
            EventComp={EventComp}
            onEventDrop={onEventDrop}
            onBackgroundClick={onBackgroundClick}
            dragAndDrop={dragAndDrop}
            onHoverChange={(hovered) => {
              if (hovered) {
                setHoveredDayIdx(i);
                return;
              }
              setHoveredDayIdx((prev) => (prev === i ? null : prev));
            }}
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
  todayKey,
  EventComp,
  onEventDrop,
  onBackgroundClick,
  dragAndDrop,
  onHoverChange,
}: {
  date: Date;
  events: E[];
  localizer: Localizer;
  todayKey: string;
  EventComp?: React.ComponentType<{ event: E }>;
  onEventDrop?: (args: {
    event: E;
    start: Date;
    end?: Date;
    targetEvent?: E | null;
  }) => void | Promise<void>;
  onBackgroundClick?: (date: Date) => void;
  dragAndDrop: boolean;
  onHoverChange?: (hovered: boolean) => void;
}) {
  const dayKey = localizer.format(date, 'yyyy-LL-dd');
  const isToday = dayKey === todayKey;
  const isPastDay = dayKey < todayKey;

  const sorted = useMemo(() => events.slice().sort((a, b) => +a.start - +b.start), [events]);

  return (
    <div
      className={`pc-daycol ${isPastDay ? 'pc-daycol--past' : ''} ${isToday ? 'pc-daycol--today' : ''}`}
      onClick={() => onBackgroundClick?.(date)}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      <div className="pc-daycol-inner">
        {sorted.map((e) => (
          <EventListItem<E>
            key={e.id}
            event={e}
            localizer={localizer}
            dragAndDrop={dragAndDrop}
            onEventDrop={onEventDrop}
            EventComp={EventComp}
          />
        ))}
      </div>
    </div>
  );
}

function EventListItem<E extends CalendarEventBase>({
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
        if (!isPlaceholder) return false;
        if (!onEventDrop) return false;

        const isQueueSlot = (() => {
          const msg = event?.resource?.item?.message;
          if (typeof msg === 'string' && msg === 'Queue slot') return true;
          const id = event?.resource?.item?.id ?? event?.id;
          return typeof id === 'string' && id.startsWith('queue-slot:');
        })();
        if (!isQueueSlot) return false;

        // Capacity is only relevant for enqueueing actions; dropping onto a slot always schedules.

        const targetKey = localizer.format(event.start, 'yyyy-LL-dd');
        const todayKey = localizer.format(new Date(), 'yyyy-LL-dd');
        if (targetKey < todayKey) return false;

        const withinNext30Days = (() => {
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const end = new Date(start);
          end.setDate(end.getDate() + 30);
          const startKey = localizer.format(start, 'yyyy-LL-dd');
          const endKey = localizer.format(end, 'yyyy-LL-dd');
          return targetKey >= startKey && targetKey <= endKey;
        })();
        if (!withinNext30Days) return false;

        const dragged = item?.event;
        if (!canDragCalendarEvent(dragged)) return false;

        const targetLane = normalizeLaneKey(
          event?.resource?.item?.laneKey ?? event?.resource?.laneKey
        );
        if (!targetLane) return true;
        if (targetLane === 'any') return true;
        return getDraggedLaneKey(dragged) === targetLane;
      },
      drop(item: any) {
        if (!isPlaceholder || !onEventDrop) return;
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
    if (!dragAndDrop) return undefined;
    if (isPlaceholder) return drop;
    if (canDrag) return drag;
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
          <span className="pc-title">{event.title || 'Event'}</span>
        </div>
      )}
    </div>
  );
}
