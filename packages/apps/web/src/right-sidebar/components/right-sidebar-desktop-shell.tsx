import { DndContext } from '@dnd-kit/core';
import type { ComponentType, ReactNode } from 'react';
import type { RightSidebarResizeBindings } from '../hooks/use-right-sidebar-width';

interface RightSidebarDesktopShellProps {
  children: ReactNode;
  open: boolean;
  id?: string;
  Sidebar?: ComponentType<{ id?: string }>;
  effectiveWidthPx: number;
  asideRef: React.RefObject<HTMLDivElement | null>;
  resizeBindings: RightSidebarResizeBindings;
}

function RightSidebarResizeHandle({
  resizeBindings,
}: {
  resizeBindings: RightSidebarResizeBindings;
}) {
  return (
    <div
      ref={resizeBindings.setResizeHandleRef}
      {...resizeBindings.resizeHandleListeners}
      {...resizeBindings.resizeHandleAttributes}
      aria-hidden="true"
      className="absolute top-0 -left-2 z-40 h-full w-4 cursor-col-resize bg-transparent"
      style={{ touchAction: 'none' }}
      onMouseDown={resizeBindings.onResizeHandleMouseDown}
      onTouchStart={resizeBindings.onResizeHandleTouchStart}
    />
  );
}

export function RightSidebarDesktopShell({
  children,
  open,
  id,
  Sidebar,
  effectiveWidthPx,
  asideRef,
  resizeBindings,
}: RightSidebarDesktopShellProps) {
  return (
    <div className="relative min-h-[60vh]">
      {children}
      {open ? (
        <DndContext
          sensors={resizeBindings.sensors}
          onDragStart={resizeBindings.onDragStart}
          onDragMove={resizeBindings.onDragMove}
          onDragEnd={resizeBindings.onDragEnd}
        >
          <aside
            role="complementary"
            aria-labelledby="right-sidebar-title"
            className="bg-card border-border animate-in fade-in-0 slide-in-from-right group fixed right-0 z-50 h-screen border-l"
            style={{ top: 0, width: `${effectiveWidthPx}px` }}
            ref={asideRef}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="bg-border pointer-events-none absolute top-0 left-0 z-50 h-full w-px"
            />
            <RightSidebarResizeHandle resizeBindings={resizeBindings} />
            {Sidebar ? (
              <div className="flex h-full flex-col overflow-auto">{<Sidebar id={id} />}</div>
            ) : null}
          </aside>
        </DndContext>
      ) : null}
    </div>
  );
}
