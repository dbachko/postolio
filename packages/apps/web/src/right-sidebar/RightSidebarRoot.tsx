import { useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { SidebarRegistry } from './registry';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function RightSidebarRoot({ children }: { children: React.ReactNode }) {
  const { type, id, open, close } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : undefined;
  const defaultWidthPx = type ? SidebarRegistry[type]?.defaultWidthPx : undefined;
  const isSmall = useMediaQuery('(max-width: 768px)');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState<number>(() => defaultWidthPx || 460);

  // Sync width from registry defaults each time a type opens
  useEffect(() => {
    if (open && defaultWidthPx) setWidthPx(defaultWidthPx);
  }, [open, defaultWidthPx]);

  // Mobile: render as Sheet; Desktop: resizable panel
  if (isSmall) {
    return (
      <>
        <div ref={containerRef} className="min-h-[60vh]">
          {children}
        </div>
        <Sheet open={open} onOpenChange={(o) => (!o ? close() : null)}>
          <SheetContent side="right" className="w-[100vw] p-0">
            {Sidebar ? <Sidebar id={id} /> : null}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop overlay below the sticky nav (h-14 = 3.5rem)
  return (
    <div ref={containerRef} className="relative min-h-[60vh]">
      {children}
      {open && (
        <aside
          role="complementary"
          aria-labelledby="right-sidebar-title"
          className="bg-card border-border animate-in fade-in-0 slide-in-from-right fixed right-0 z-30 h-[calc(100%-3.5rem)] border-l shadow-xl"
          style={{ top: '3.5rem', width: `${widthPx}px` }}
        >
          {Sidebar ? <Sidebar id={id} /> : null}
        </aside>
      )}
    </div>
  );
}
