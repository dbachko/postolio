# Research: Universal Right Sidebar (Resizable, Router‑Driven)

**Status**: Research Complete
**Created**: 2025-10-28
**Owner**: Web Platform & UX

---

## Executive Summary

Introduce a universal, resizable right sidebar that opens from the right, can render different content types (e.g., notifications, posts), and persists its state and size across reloads per sidebar type. On desktop, it lives as part of the page layout and does not cover main content; on mobile, it behaves like an overlaying sheet/drawer. Routing controls which sidebar is open so state survives refreshes and deep links.

Key decisions:

- Desktop: non-modal resizable panel using `react-resizable-panels` (via our shadcn/ui wrapper `@/components/ui/resizable`).
- Mobile: `Sheet` from shadcn/ui (`@/components/ui/sheet`) sliding from the right.
- Router as source of truth for open/closed and which type is displayed (e.g., `?sidebar=notifications` or `?sidebar=post&postId=…`).
- Persist sizes per sidebar type via `PanelGroup` `autoSaveId` + localStorage.
- Generic top-level component (`RightSidebarRoot`) renders any registered sidebar content.

Expected impact:

- Maintains user context (e.g., calendar view) while viewing notifications or post details.
- Faster task switching; fewer full-page navigations.
- Consistent UX across features with minimal new primitives.

---

## Requirements Recap

- Right-aligned panel; opens from right.
- Resizable with a visible handle; remember width per sidebar type (notifications vs posts).
- Close button, ESC to close, programmatic close.
- Generic shell; render different content modules (notifications, posts, later: help, AI, etc.).
- Router-driven: open state and target content survive page reloads and support deep-linking.
- Mobile fallback: overlaying sheet/drawer with consistent content.
- A11Y: clear focus handling, roles, labels, and keyboard navigation.

---

## Industry Patterns & References

- Linear: Peek and detailed side panels for issues; resizable; preserves main list context; keyboard shortcuts to open/close. Excellent for triage and quick actions.
- Notion: Side preview and properties panel that don’t obscure content; resizable; consistent close affordances.
- Gmail/Outlook: Right-side reading pane/task/calendar; persistent across contexts; default widths ~400–600px.
- GitHub: PR “Files changed” right tool panel (filters), avoids content loss.

Best practices distilled:

- Default width 420–520px; min 320px; max 720px on desktop.
- Obvious grab handle with ≥12px target size; cursor changes; keyboard-accessible focus target.
- Non-modal on desktop (do not trap focus) so users can interact with main content while sidebar is open.
- Overlay modal on mobile; trap focus only there.
- Preserve per-feature widths; avoid a single global width for all sidebars.
- Fast open/close animation (150–250ms) to avoid sluggish feel.
- Close affordances: ESC, top-right close button, click target on handle area not closing unexpectedly.

---

## Can We Use Our UI Library?

Yes.

- Resizable: We already ship shadcn’s `Resizable` wrapper at `@/components/ui/resizable` (backed by `react-resizable-panels@3.x`). It supports horizontal layouts, a resize handle, and built-in persistence via `autoSaveId` (localStorage).
- Overlay sheet: We have `@/components/ui/sheet` (Radix Dialog-based) and `@/components/ui/drawer` (Vaul). For a right slide-over, `Sheet` with `side="right"` is ideal on mobile.
- Primitives used inside: `ScrollArea`, `Separator`, `Tabs`, `Button`, `Tooltip`, etc. All standardized in our shadcn setup.

Conclusion: No new third-party libs required beyond what we have.

---

## Architecture Overview

Concepts:

- “Sidebar Type” identifies what to render (`notifications`, `post`, etc.).
- Router encodes open state and parameters via querystring: `?sidebar=<type>&sidebarId=<id>` (e.g., `?sidebar=notifications` or `?sidebar=post&sidebarId=123`).
- `RightSidebarRoot` reads router state and renders the appropriate registered component.
- Desktop layout uses a `ResizablePanelGroup` with the main content and a right `ResizablePanel` that toggles between collapsed and open. Width persistence keyed by `sidebar:<type>`.
- Mobile renders the same content inside a `Sheet`.

---

## Routing Strategy

Two viable patterns considered:

1. Query params (recommended)

- Example: `/calendar?sidebar=notifications` or `/content?sidebar=post&sidebarId=abc`.
- Pros: Simple to adopt everywhere; doesn’t change route hierarchy; easy deep link and persistence.
- Cons: Requires a global effect or provider to read params and show/hide sidebar.

2. Parallel routes (modal routes pattern)

- Example: `/calendar` with a parallel UI segment `/_side/notifications`.
- Pros: Strong separation; co-located route loaders.
- Cons: More router complexity; larger refactor.

Recommendation: Query params using React Router’s `useSearchParams`. Provide a small hook `useRightSidebarRouter()` to get/set `{ type, id, open }`.

---

## Persistence Strategy

- Per sidebar type, persist width via `ResizablePanelGroup` `autoSaveId={`right-sidebar:${type}`}` to localStorage automatically.
- Router persists open type and id; on reload, `RightSidebarRoot` mounts the correct sidebar.
- Optional enhancement: Last-opened type remembered in localStorage and restored only when not explicitly set in URL.

---

## Accessibility

Desktop panel (non-modal):

- Use `<aside role="complementary" aria-labelledby="right-sidebar-title">` and ensure content has an `h2` with that id.
- Do not trap focus; allow TAB to move into/out of the panel naturally.
- Provide a keyboard-focusable close button with `aria-label="Close"` and support `Escape` to close.
- Maintain contrast and tokenized colors per our `SHADCN-UI-USAGE.md`.

Mobile sheet (modal):

- Use the `Sheet` (Radix dialog) which handles focus trap, aria, Escape, and backdrop.
- Content titles wired to `aria-labelledby`.

Resize handle:

- Provide a focusable handle area with a visible affordance (we have `ResizableHandle withHandle`).
- Make sure the handle is keyboard-focusable and doesn’t accidentally close the panel.

---

## UX Recommendations

- Defaults: open width 460px (notifications), 560px (post details). Min 320px; Max 720px.
- Toolbar: right-aligned Close button, left-aligned title. Actions aligned next to title (Refresh, Mark all read, Filters).
- Animation: 200ms enter/leave; no bounce; token-friendly transitions.
- Scrolling: Inner `ScrollArea` for content; keep header + actions sticky.
- Keyboard: ESC to close; Arrow keys and Enter within lists; maintain scroll position if possible.
- Mobile: Sheet width 100vw; breakpoints at `md` to switch between panel and sheet.

---

## Example Skeleton (Desktop)

```tsx
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { SidebarRegistry } from '@/right-sidebar/registry';

export function AppShellWithRightSidebar({ children }: { children: React.ReactNode }) {
  const { type, id, open } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : null;
  const autoSaveId = type ? `right-sidebar:${type}` : 'right-sidebar:none';

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId} className="h-full">
      <ResizablePanel defaultSize={open ? 70 : 100} minSize={30}>
        {children}
      </ResizablePanel>
      {open && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={30} minSize={20} maxSize={60}>
            <aside role="complementary" className="flex h-full flex-col">
              {Sidebar ? <Sidebar id={id} /> : null}
            </aside>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
```

Mobile fallback (simplified):

```tsx
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function RightSidebarMobile() {
  const isSmall = useMediaQuery('(max-width: 768px)');
  const { type, id, open, close } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : null;
  if (!isSmall) return null;
  return (
    <Sheet open={open} onOpenChange={(o) => (!o ? close() : null)}>
      <SheetContent side="right" className="w-[100vw] p-0">
        {Sidebar ? <Sidebar id={id} /> : null}
      </SheetContent>
    </Sheet>
  );
}
```

---

## Notifications as First Sidebar

- Use existing `useNotificationsStore` for data.
- Replace `NotificationsDropdown` flow with a router action: clicking the bell sets `?sidebar=notifications`.
- Toolbar: Refresh, Mark all as read, Filters (future), and Close.
- List: All/unread tabs (future), optimized render, CTA buttons inline.

---

## Performance & Tech Notes

- `react-resizable-panels@3.x` is already installed; persistence via `autoSaveId` stores layout in localStorage.
- Keep sidebar content lazy-loaded per type to avoid initial bundle bloat. Use dynamic import for `NotificationsSidebar` and `PostSidebar`.
- Avoid focus trap on desktop panel; only trap in mobile sheet.
- Keep animation lightweight; prefer CSS transitions over JS animations.

---

## Risks & Mitigations

- Router coupling: Keep a small hook to encapsulate search param handling (`useRightSidebarRouter`).
- Layout jank on first paint: Use `autoSaveId` and sensible default sizes; avoid layout flashes by rendering container immediately then content.
- A11Y regressions: Leverage Radix for modal sheet; add testing for keyboard navigation and roles.
- Conflicts with existing pages: Implement at `AppLayout` level so all pages get consistent placement; provide opt-out for routes that should hide the sidebar.

---

## Open Questions

- Should we deprecate the full `/notifications` page in favor of the sidebar, or keep both (sidebar as default, page for power users)?
- Do we want a keyboard shortcut (e.g., `⌘/Ctrl + .`) to toggle the sidebar and `⌘/Ctrl + Shift + .` to cycle types?
- Should persistence be user-level or brand+user scoped (e.g., width differs per brand workspace)?
- For posts: will the sidebar show read-only details or editable form? (Editable suggests wider default width and more complex interaction.)

---

## Recommendation

Adopt the router-driven, universal right sidebar with a resizable desktop panel and mobile sheet fallback using the components we already ship. Start with notifications, then expand to posts and help. Persist widths per type and maintain open state via URL. This balances UX quality, performance, and implementation effort with minimal new dependencies.
