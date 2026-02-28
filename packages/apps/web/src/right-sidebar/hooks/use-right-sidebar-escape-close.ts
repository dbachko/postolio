import { useEffect } from 'react';

interface UseRightSidebarEscapeCloseArgs {
  open: boolean;
  isSmall: boolean;
  close: () => void;
  asideRef: React.RefObject<HTMLDivElement | null>;
}

export function useRightSidebarEscapeClose({
  open,
  isSmall,
  close,
  asideRef,
}: UseRightSidebarEscapeCloseArgs) {
  useEffect(() => {
    if (!open || isSmall) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      const hasOpenPortal = document.querySelector(
        '[data-radix-portal] [data-state="open"],[data-radix-popper-content-wrapper] [data-state="open"]'
      );
      if (hasOpenPortal) {
        return;
      }
      const asideElement = asideRef.current;
      const activeElement = document.activeElement as HTMLElement | null;
      if (asideElement && activeElement && asideElement.contains(activeElement)) {
        activeElement.blur();
        event.preventDefault();
        return;
      }
      close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [asideRef, close, isSmall, open]);
}
