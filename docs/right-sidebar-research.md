# Right Sidebar (Universal Overlay) — Research & Plan

This document captures UI/UX research, technical options, and an implementation plan for a universal right sidebar that overlays the app, supports live resizing with per‑type persistence, and can host multiple “modes” such as notifications, post edit/create, and brand profile.

## Goals

- Overlay, fixed to the right, optionally over the top nav on desktop; sheet‑style on mobile.
- Sticky header matching top nav height (`h-14`), with title clickable for full page when appropriate.
- Live resize on desktop (drag handle). Persist width per user and per sidebar type.
- Sidebar types: notifications, post edit, post create, brand profile. Extensible registry.
- Routing: open/close via URL search params (`sidebar`, `sidebarId`) to persist across reloads.

## UI/UX References

- Notion: right properties/activity panels; resizable edge; sticky header.
- Linear: issue details in a right flyout with sticky header, live resizing, subtle edge affordance.
- GitHub Projects: right panel for metadata; title links to full page when needed.
- Slack: right details/threads with hover‑visible handle and 1px border (no heavy shadows).

Key takeaways:

- Keep the resize affordance subtle: a permanent 1px border + thin, hover‑reactive hotspot.
- Make headers sticky to maintain context while scrolling; match app nav height for rhythm.
- On mobile, use a sheet that’s slightly smaller than the viewport (hint underlying content).

## Library Options (D&D / Resize)

- dnd‑kit: modern, sensor‑driven; great DX and community adoption. We use it for edge‑drag resizing.
- react‑resizable‑panels: excellent panel layouts; heavier than needed for a single overlay edge.
- react‑beautiful‑dnd: deprecated; not recommended for new work.

Decision: dnd‑kit for resize. It gives us fine control over the edge hotspot and live width updates with minimal bundle impact. We keep the handle invisible until hover.

## Component Architecture

- `useRightSidebarRouter`: controls URL search params (`sidebar`, `sidebarId`), provides `openSidebar` and `close`.
- `SidebarRegistry`: maps type → component + defaults (`defaultWidthPx`). Extensible for future sidebars.
- `RightSidebarRoot`: host overlay. Desktop: fixed overlay, live resizable edge; Mobile: sheet with `100vw - 50px` width.
- Sidebar implementations:
  - NotificationsSidebar: title → full page `/notifications`.
  - PostSidebar: edit in sidebar by default; title → `/posts/:id?edit=1`.
  - CreatePostSidebar: title → `/posts/create`.
  - BrandProfileSidebar: migrated from drawer; appears in universal sidebar.

## Persistence

- Save width per user/type via `PATCH /api/users/ui/sidebar-width` (JSON `uiPreferences.rightSidebar[type] = width`).
- Load saved width on open; clamp to `[minWidth, maxWidth]`.

## Routing Integration

- Sidebar state is encoded in URL search params → persists on refresh and supports deep links.
- Content entry points (calendar/timeline/list/cards) call `openSidebar(type, { id })` instead of hard navigation.
- Titles in sidebars open full page routes for users who prefer dedicated views.

## Accessibility

- `role="complementary"`, `aria-labelledby="right-sidebar-title"` on the aside container.
- `role="separator"` on the resize handle; keyboard resizing can be added later if needed.

## Visual Design

- No drop shadows (clean, flat). Keep a 1px left border; show a subtle 2px hover hotspot.
- Sticky header `h-14` to align with nav; divider below header; content in a scroll area.
- Mobile: sheet width `100vw - 50px` to hint content behind.

## Plan of Record

1. Registry + router hook (complete)
2. RightSidebarRoot overlay + mobile sheet (complete)
3. Live resize via dnd‑kit, per‑type persistence (complete)
4. Sticky headers; title → full page links (complete)
5. Wire content openers (calendar, list, cards, timeline) to `openSidebar` (complete)
6. Migrate brand profile drawer to sidebar (complete)
7. QA hover hotspot (touch + trackpad); adjust width/offset if needed (pending)

## Open Questions / Next Steps

- Handle discoverability: add a tiny “grip” glyph that appears on hover for extra affordance?
- Keyboard resize support for accessibility (left/right arrows on focused separator).
- Analytics on sidebar usage per type (open rates, preferred widths) to refine defaults.
