import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Reusable sidebar component that provides consistent UI across the app.
 * Based on the PostSidebar pattern with header, scrollable content, and optional sticky footer.
 */
export function AppSidebar({
  open,
  onOpenChange,
  title,
  children,
  footer,
  className,
}: AppSidebarProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          'flex flex-col overflow-hidden p-0 sm:max-w-2xl',
          // Hide the default close button that SheetContent adds
          '[&>button[class*="absolute"]]:hidden',
          className
        )}
      >
        {/* Header with title and close button - matches navigation height (h-12) */}
        <div className="bg-card flex h-12 flex-shrink-0 items-center justify-between border-b px-4">
          <Breadcrumb aria-label="sidebar-title">
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            aria-label="Close sidebar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-4 py-6">{children}</div>

        {/* Optional sticky footer */}
        {footer && (
          <div className="border-border bg-card flex-shrink-0 border-t px-4 py-3">{footer}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
