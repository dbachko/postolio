import type { ComponentType, ReactNode } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';

interface RightSidebarMobileShellProps {
  children: ReactNode;
  open: boolean;
  close: () => void;
  id?: string;
  Sidebar?: ComponentType<{ id?: string }>;
}

export function RightSidebarMobileShell({
  children,
  open,
  close,
  id,
  Sidebar,
}: RightSidebarMobileShellProps) {
  return (
    <>
      <div className="min-h-[60vh]">{children}</div>
      <Sheet open={open} onOpenChange={(nextOpen) => (!nextOpen ? close() : null)}>
        <SheetContent side="right" className="p-0" style={{ width: 'calc(100vw - 50px)' }}>
          {Sidebar ? <Sidebar id={id} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
