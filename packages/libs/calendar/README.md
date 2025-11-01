# @postolio/calendar

Reusable calendar wrapper for React that powers the Postolio scheduling views.

Features:

- Views: month, week, three-day, agenda
- Pluggable localizer (default: Luxon)
- Drag-and-drop (react-dnd) with optional internal provider
- CSS-variable theme (no hard-coded colors)
- Mobile-friendly: responsive CSS and optional touch DnD backend

Quick start:

```tsx
import '@postolio/calendar/styles.css';
import { Calendar, luxon } from '@postolio/calendar';

const localizer = luxon.create();

<Calendar
  date={new Date()}
  view="month"
  events={[{ id: 1, title: 'Post', start: new Date(), end: new Date() }]}
  localizer={localizer}
  dragAndDrop
  onEventDrop={({ event, start }) => {
    /* handle */
  }}
/>;
```

Mobile drag-and-drop (optional)

- Install a touch backend (e.g., `react-dnd-touch-backend` or `dnd-multi-backend`).
- Pass the backend to the Calendar:

```tsx
import { TouchBackend } from 'react-dnd-touch-backend';

<Calendar
  date={new Date()}
  view="week"
  events={events}
  dndBackend={TouchBackend}
  dndOptions={{ enableMouseEvents: true }}
  dragAndDrop
/>;
```
