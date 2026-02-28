import { useMemo, useRef, type ReactNode } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { SidebarRegistry } from './registry';
import { RightSidebarLayoutContext } from './right-sidebar-context';
import { RightSidebarDesktopShell } from './components/right-sidebar-desktop-shell';
import { RightSidebarMobileShell } from './components/right-sidebar-mobile-shell';
import { useRightSidebarEscapeClose } from './hooks/use-right-sidebar-escape-close';
import { useRightSidebarWidth } from './hooks/use-right-sidebar-width';

export function RightSidebarRoot({ children }: { children: ReactNode }) {
  const { type, id, open, close } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : undefined;
  const defaultWidthPx = type ? SidebarRegistry[type]?.defaultWidthPx : undefined;
  const isSmall = useMediaQuery('(max-width: 1023px)');
  const asideRef = useRef<HTMLDivElement | null>(null);
  const widthModel = useRightSidebarWidth({ open, type, defaultWidthPx, asideRef });
  const contextValue = useMemo(
    () => ({
      open,
      isSmall,
      extraWidthPx: widthModel.extraWidthPx,
      setExtraWidthPx: widthModel.setExtraWidthPx,
    }),
    [isSmall, open, widthModel.extraWidthPx, widthModel.setExtraWidthPx]
  );

  useRightSidebarEscapeClose({ open, isSmall, close, asideRef });

  return (
    <RightSidebarLayoutContext.Provider value={contextValue}>
      {isSmall ? (
        <RightSidebarMobileShell open={open} close={close} id={id} Sidebar={Sidebar}>
          {children}
        </RightSidebarMobileShell>
      ) : (
        <RightSidebarDesktopShell
          open={open}
          id={id}
          Sidebar={Sidebar}
          effectiveWidthPx={widthModel.effectiveWidthPx}
          asideRef={asideRef}
          resizeBindings={widthModel}
        >
          {children}
        </RightSidebarDesktopShell>
      )}
    </RightSidebarLayoutContext.Provider>
  );
}
