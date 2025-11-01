import React, { useMemo } from 'react';
import type { Localizer } from '../localizers';
import type { CalendarEventBase } from '../types';
import { CreateCta } from '../components/CreateCta';

type Props<E extends CalendarEventBase> = {
  date: Date;
  events: E[];
  localizer: Localizer;
  eventComponent?: React.ComponentType<{ event: E }>;
};

export function AgendaView<E extends CalendarEventBase>({
  date,
  events,
  localizer,
  eventComponent: EventComp,
}: Props<E>) {
  const byDay = useMemo(() => {
    const startDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const endDay = new Date(startDay);
    endDay.setDate(endDay.getDate() + 29); // inclusive -> total 30 days

    // Build continuous day list first
    const days: Date[] = [];
    for (
      let d = new Date(startDay);
      d <= endDay;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      days.push(d);
    }

    // Pre-sorted events in range
    const filtered = events
      .filter((e) => e.start >= startDay && e.start <= endDay)
      .slice()
      .sort((a, b) => +a.start - +b.start);

    // Group by day, including empty days
    const result: { date: Date; items: E[] }[] = days.map((d) => ({
      date: new Date(d),
      items: [],
    }));
    const keyOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const indexByKey = new Map<string, number>();
    result.forEach((g, idx) => indexByKey.set(keyOf(g.date), idx));
    for (const e of filtered) {
      const d = new Date(e.start.getFullYear(), e.start.getMonth(), e.start.getDate());
      const k = keyOf(d);
      const idx = indexByKey.get(k);
      if (idx != null) result[idx].items.push(e);
    }
    // Skip days without items per requirements
    return result.filter((g) => g.items.length > 0);
  }, [events, date]);

  return (
    <div className="pc-agenda">
      {byDay.map((g) => (
        <div key={g.date.toISOString()} className="pc-agenda-group">
          <div className="pc-agenda-date">{localizer.format(g.date, 'LLL d, yyyy')}</div>
          <div className="pc-agenda-items">
            {g.items.map((e) => (
              <div key={e.id} className="pc-agenda-item">
                {EventComp ? (
                  <EventComp event={e} />
                ) : (
                  <span className="pc-title">{e.title || 'Event'}</span>
                )}
              </div>
            ))}
          </div>
          <CreateCta date={g.date} />
        </div>
      ))}
    </div>
  );
}
