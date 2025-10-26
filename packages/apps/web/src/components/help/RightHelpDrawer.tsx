import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

interface RightHelpDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RightHelpDrawer({ open, onOpenChange }: RightHelpDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:w-[460px]">
        <SheetHeader>
          <SheetTitle>Help Sidebar (beta)</SheetTitle>
        </SheetHeader>
        <div className="text-foreground text-sm">
          <p className="mb-3">
            This is a scaffold for a persistent right sidebar. We’ll wire this to an AI chat and
            contextual tips later.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>Ask questions about features (coming soon)</li>
            <li>See context-aware suggestions per page (coming soon)</li>
            <li>One-click apply actions from suggestions (coming soon)</li>
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
