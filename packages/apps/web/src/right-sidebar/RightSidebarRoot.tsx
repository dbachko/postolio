import { useEffect, useMemo, useRef, useState } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { SidebarRegistry } from './registry';
import { useMediaQuery } from '@/hooks/useMediaQuery';

function pxToPercent(px: number, groupWidth: number) {
  if (!groupWidth || groupWidth <= 0) return 30;
  const pct = (px / groupWidth) * 100;
  return Math.min(60, Math.max(20, Math.round(pct)));
}

export function RightSidebarRoot({ children }: { children: React.ReactNode }) {
  const { type, id, open, close } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : undefined;
  const defaultWidthPx = type ? SidebarRegistry[type]?.defaultWidthPx : undefined;
  const isSmall = useMediaQuery('(max-width: 768px)');
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [groupWidth, setGroupWidth] = useState<number>(0);

  useEffect(() => {
    const measure = () => {
      if (groupRef.current) {
        setGroupWidth(groupRef.current.clientWidth);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Compute default right panel percent based on px preference
  const defaultRightPct = useMemo(() => {
    if (!open || !defaultWidthPx) return 30; // reasonable default
    return pxToPercent(defaultWidthPx, groupWidth);
  }, [open, defaultWidthPx, groupWidth]);

  // Mobile: render as Sheet; Desktop: resizable panel
  if (isSmall) {
    return (
      <>
        <div ref={groupRef} className="min-h-[60vh]">
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

  const autoSaveId = type ? `right-sidebar:${type}` : 'right-sidebar:none';

  return (
    <div ref={groupRef} className="h-full min-h-[60vh]">
      <ResizablePanelGroup direction="horizontal" autoSaveId={autoSaveId} className="h-full">
        <ResizablePanel defaultSize={open ? 100 - defaultRightPct : 100} minSize={30}>
          {children}
        </ResizablePanel>
        {open && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={defaultRightPct} minSize={20} maxSize={60}>
              {Sidebar ? <Sidebar id={id} /> : null}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
