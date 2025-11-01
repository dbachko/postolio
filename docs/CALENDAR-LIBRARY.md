Postolio Calendar Library

Overview

- New reusable calendar lib lives at `packages/libs/calendar` as `@postolio/calendar`.
- Wraps React Big Calendar with:
  - Views: month, week, day, three-day (mapped to day length=3), agenda
  - Pluggable localizer (default Luxon)
  - Drag-and-drop via react-dnd (internal DnD provider by default)
  - CSS-variable theme (no hard-coded palette), importable as `@postolio/calendar/styles.css`
  - Responsive by default: compact headers/gutters and smaller cards on screens < 640px

Usage

- Import styles in the app:
  - `import 'react-big-calendar/lib/css/react-big-calendar.css'`
  - `import '@postolio/calendar/styles.css'`
- Use the component:

```
import { Calendar, luxon } from '@postolio/calendar';
const localizer = luxon.create();

<Calendar
  date={new Date()}
  view="month"
  events={events}
  localizer={localizer}
  dragAndDrop
  onEventDrop={({ event, start }) => {/* ... */}}
  components={{ event: MyEventCard }}
/>;
```

Theming

- Styles use CSS vars: `--background`, `--foreground`, `--border`, `--card`, `--primary`, `--primary-foreground`, etc.
- Calendar height token: `--calendar-card-h` (default 112px).

Notes

- Three-day view is exposed via API view="three-day" and rendered as RBC day view with length=3.
- Toolbar is off; consumers control navigation/view via their own UI.

Mobile drag-and-drop

- For touch devices, use a touch backend with react-dnd and pass it via `dndBackend`:

```
import { TouchBackend } from 'react-dnd-touch-backend';

<Calendar
  date={new Date()}
  view="three-day"
  events={events}
  dragAndDrop
  dndBackend={TouchBackend}
  dndOptions={{ enableMouseEvents: true }}
/>;
```
