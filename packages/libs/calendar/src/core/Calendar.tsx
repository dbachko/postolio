import React, { useMemo } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { createLuxonLocalizer } from '../localizers';
import type { CalendarProps } from '../types';
import { MonthView } from '../views/MonthView';
import { TimeGridView } from '../views/TimeGridView';
import { AgendaView } from '../views/AgendaView';

export function Calendar<E extends { id: string | number; start: Date; end?: Date }>(
  props: CalendarProps<E>
) {
  const {
    date,
    view,
    events,
    localizer,
    components,
    weekStartsOn,
    dragAndDrop = true,
    useInternalDndProvider = true,
    dndBackend,
    dndOptions,
    onEventDrop,
    onBackgroundClick,
    onMoreClick,
    className,
    style,
  } = props;

  const loc = useMemo(
    () => localizer || createLuxonLocalizer({ weekStartsOn }),
    [localizer, weekStartsOn]
  );
  const content = (
    <div className={`pc-calendar ${className || ''}`} style={style}>
      {view === 'month' && (
        <MonthView<E>
          date={date}
          events={events}
          localizer={loc}
          weekStartsOn={weekStartsOn}
          eventComponent={components?.event}
          onEventDrop={onEventDrop}
          dragAndDrop={dragAndDrop}
          onBackgroundClick={onBackgroundClick}
          onMoreClick={onMoreClick}
        />
      )}
      {(view === 'week' || view === 'three-day') && (
        <TimeGridView<E>
          date={date}
          days={view === 'three-day' ? 3 : 7}
          events={events}
          localizer={loc}
          weekStartsOn={weekStartsOn}
          eventComponent={components?.event}
          onEventDrop={onEventDrop}
          dragAndDrop={dragAndDrop}
          onBackgroundClick={onBackgroundClick}
        />
      )}
      {view === 'agenda' && (
        <AgendaView<E>
          date={date}
          events={events}
          localizer={loc}
          eventComponent={components?.event}
        />
      )}
    </div>
  );

  if (dragAndDrop && useInternalDndProvider) {
    const Backend = (dndBackend as any) || HTML5Backend;
    return (
      <DndProvider backend={Backend} options={dndOptions}>
        {content}
      </DndProvider>
    );
  }
  return content;
}
