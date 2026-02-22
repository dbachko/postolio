import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useRightSidebarRouter } from '@/hooks/useRightSidebarRouter';
import { SidebarRegistry } from './registry';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { auth as authApi } from '@/lib/api';
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { getNumberSetting, setNumberSetting } from '@/lib/settings/localSettings';
import { RightSidebarLayoutContext } from './right-sidebar-context';

export function RightSidebarRoot({ children }: { children: React.ReactNode }) {
  const { type, id, open, close } = useRightSidebarRouter();
  const Sidebar = type ? SidebarRegistry[type]?.Component : undefined;
  const defaultWidthPx = type ? SidebarRegistry[type]?.defaultWidthPx : undefined;
  // Treat tablet / <lg as "small" so the sidebar uses Sheet overlay instead of squeezing content.
  const isSmall = useMediaQuery('(max-width: 1023px)');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState<number>(() => defaultWidthPx || 460);
  const [extraWidthPx, setExtraWidthPx] = useState<number>(0);
  const minWidth = 360;
  const maxWidth = 960;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));
  const dragStartWidthRef = useRef<number>(0);
  const nativeStartXRef = useRef<number>(0);
  const nativeActiveRef = useRef<boolean>(false);
  // Normalize types that should share the same persisted width (e.g., post + post-create)
  const persistedType = type === 'post-create' ? 'post' : type;
  const storageKey = persistedType ? `ui:rightSidebar:${persistedType}:width` : undefined;
  const widthRef = useRef<number>(defaultWidthPx || 460);
  const effectiveWidthPx = widthPx + extraWidthPx;
  const contextValue = useMemo(
    () => ({ open, isSmall, extraWidthPx, setExtraWidthPx }),
    [open, isSmall, extraWidthPx]
  );

  const clamp = useCallback(
    (w: number) => Math.max(minWidth, Math.min(maxWidth, Math.round(w))),
    [minWidth, maxWidth]
  );

  const applyWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      widthRef.current = clamped;
      setWidthPx(clamped);
      return clamped;
    },
    [clamp]
  );

  const setGlobalDragging = useCallback((active: boolean) => {
    if (typeof document === 'undefined') {
      return;
    }
    const b = document.body as HTMLBodyElement;
    if (active) {
      b.style.userSelect = 'none';
      b.style.cursor = 'col-resize';
    } else {
      b.style.userSelect = '';
      b.style.cursor = '';
    }
  }, []);

  // Draggable handle for resizing via dnd-kit
  const { attributes, listeners, setNodeRef } = useDraggable({ id: 'right-sidebar-resize' });

  // Apply localStorage width (or default) before paint to avoid flicker
  useLayoutEffect(() => {
    if (!open || !persistedType) {
      return;
    }
    let applied = false;
    try {
      const ls = storageKey
        ? (getNumberSetting(storageKey, { min: minWidth, max: maxWidth, positive: true }) as
            | number
            | undefined)
        : undefined;
      if (typeof ls === 'number') {
        applyWidth(ls);
        applied = true;
      }
    } catch {}
    if (!applied && defaultWidthPx) {
      applyWidth(defaultWidthPx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  // Load profile width when sidebar opens. Prefer localStorage to avoid flicker; sync server to LS if needed.
  useEffect(() => {
    let active = true;
    const syncWidth = async () => {
      if (!open || !persistedType) {
        return;
      }
      // LocalStorage first for instant UX
      try {
        const ls = storageKey
          ? (getNumberSetting(storageKey, { min: minWidth, max: maxWidth, positive: true }) as
              | number
              | undefined)
          : undefined;
        if (typeof ls === 'number') {
          setWidthPx(clamp(ls));
        }
      } catch {}
      try {
        const me = await authApi.getProfile();
        const saved = (me?.user?.uiPreferences as any)?.rightSidebar?.[persistedType];
        const rawLs = storageKey
          ? (getNumberSetting(storageKey, { min: minWidth, max: maxWidth, positive: true }) as
              | number
              | undefined)
          : undefined;
        const hasLs = typeof rawLs === 'number';
        if (active && typeof saved === 'number' && saved > 0) {
          if (hasLs) {
            // Prefer localStorage (last local user choice); align server if different
            if (Math.abs((rawLs as number) - saved) > 1) {
              try {
                await authApi.updateRightSidebarWidth({
                  type: persistedType,
                  width: clamp(rawLs as number),
                });
              } catch {}
            }
          } else {
            // No LS; apply server and store to LS
            const next = applyWidth(saved);
            try {
              if (storageKey) {
                setNumberSetting(storageKey, next);
              }
            } catch {}
          }
        } else if (hasLs) {
          // No server saved; push LS to server
          try {
            await authApi.updateRightSidebarWidth({
              type: persistedType,
              width: clamp(rawLs as number),
            });
          } catch {}
        }
      } catch (_e) {
        // ignore
      }
    };
    void syncWidth();
    return () => {
      active = false;
    };
  }, [open, type, clamp, storageKey, applyWidth, persistedType]);

  // Global hotkeys to close sidebar (desktop)
  useEffect(() => {
    if (!open || isSmall) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      const doc = document;

      // If any portalled overlay (dialog, popover, select, etc.) is open,
      // let that component handle Escape without closing the sidebar.
      const hasOpenPortal = doc.querySelector(
        '[data-radix-portal] [data-state="open"],[data-radix-popper-content-wrapper] [data-state="open"]'
      );
      if (hasOpenPortal) {
        return;
      }

      const asideEl = asideRef.current;
      const activeEl = doc.activeElement as HTMLElement | null;

      // If focus is inside the sidebar, blur first; a subsequent Escape can close it.
      if (asideEl && activeEl && asideEl.contains(activeEl)) {
        if (typeof activeEl.blur === 'function') {
          activeEl.blur();
          event.preventDefault();
          return;
        }
      }

      // No overlays or focused elements on top of the sidebar; safe to close it.
      close();
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, isSmall, close]);

  useEffect(() => {
    if (!open) {
      setExtraWidthPx(0);
    }
  }, [open]);

  // Mobile: render as Sheet; Desktop: resizable panel
  if (isSmall) {
    return (
      <RightSidebarLayoutContext.Provider value={contextValue}>
        <>
          <div ref={containerRef} className="min-h-[60vh]">
            {children}
          </div>
          <Sheet open={open} onOpenChange={(o) => (!o ? close() : null)}>
            <SheetContent side="right" className="p-0" style={{ width: 'calc(100vw - 50px)' }}>
              {Sidebar ? <Sidebar id={id} /> : null}
            </SheetContent>
          </Sheet>
        </>
      </RightSidebarLayoutContext.Provider>
    );
  }

  // Desktop overlay below the sticky nav (h-14 = 3.5rem)
  return (
    <RightSidebarLayoutContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative min-h-[60vh]">
        {children}
        {open && (
          <DndContext
            sensors={sensors}
            onDragStart={() => {
              dragStartWidthRef.current = widthRef.current;
              setGlobalDragging(true);
            }}
            onDragMove={(event: { delta: { x: number; y: number } }) => {
              const dx = event.delta.x || 0; // positive when moving right
              // Expected for right-anchored panel: moving RIGHT decreases width; LEFT increases
              applyWidth(dragStartWidthRef.current - dx);
            }}
            onDragEnd={async () => {
              setGlobalDragging(false);
              try {
                const domW = asideRef.current?.getBoundingClientRect().width;
                const nextBase = typeof domW === 'number' ? domW - extraWidthPx : widthRef.current;
                const finalW = clamp(nextBase);
                widthRef.current = finalW;
                if (storageKey) {
                  setNumberSetting(storageKey, finalW);
                }
              } catch {}
              if (persistedType) {
                try {
                  await authApi.updateRightSidebarWidth({
                    type: persistedType,
                    width: widthRef.current,
                  });
                } catch {
                  // ignore persist errors
                }
              }
            }}
          >
            <aside
              role="complementary"
              aria-labelledby="right-sidebar-title"
              className="bg-card border-border animate-in fade-in-0 slide-in-from-right group fixed right-0 z-50 h-screen border-l"
              style={{ top: 0, width: `${effectiveWidthPx}px` }}
              ref={asideRef}
            >
              {/* Visual 1–2px border line (and semantic separator) */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize sidebar"
                className="bg-border pointer-events-none absolute top-0 left-0 z-50 h-full w-px"
              />

              {/* Resize handle hotspot (transparent until hover) - keep thin */}
              <div
                ref={setNodeRef}
                {...listeners}
                {...attributes}
                aria-hidden="true"
                className="absolute top-0 -left-2 z-40 h-full w-4 cursor-col-resize bg-transparent"
                style={{ touchAction: 'none' }}
                onMouseDown={(e) => {
                  // Native fallback to ensure resize always works
                  e.preventDefault();
                  nativeActiveRef.current = true;
                  nativeStartXRef.current = e.clientX;
                  dragStartWidthRef.current = widthRef.current;
                  setGlobalDragging(true);
                  const onMove = (ev: MouseEvent) => {
                    if (!nativeActiveRef.current) {
                      return;
                    }
                    const dx = (ev.clientX || 0) - nativeStartXRef.current;
                    // Right-anchored: moving RIGHT decreases width
                    applyWidth(dragStartWidthRef.current - dx);
                  };
                  const onUp = async () => {
                    nativeActiveRef.current = false;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    setGlobalDragging(false);
                    if (persistedType) {
                      try {
                        const domW = asideRef.current?.getBoundingClientRect().width;
                        const nextBase =
                          typeof domW === 'number' ? domW - extraWidthPx : widthRef.current;
                        const finalW = clamp(nextBase);
                        widthRef.current = finalW;
                        if (storageKey) {
                          setNumberSetting(storageKey, finalW);
                        }
                        await authApi.updateRightSidebarWidth({
                          type: persistedType,
                          width: finalW,
                        });
                      } catch {
                        // ignore
                      }
                    }
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                onTouchStart={(e) => {
                  // Native touch fallback
                  if (!e.touches || e.touches.length === 0) {
                    return;
                  }
                  nativeActiveRef.current = true;
                  nativeStartXRef.current = e.touches[0].clientX;
                  dragStartWidthRef.current = widthRef.current;
                  setGlobalDragging(true);
                  const onMove = (ev: TouchEvent) => {
                    if (!nativeActiveRef.current) {
                      return;
                    }
                    const t = ev.touches && ev.touches[0];
                    if (!t) {
                      return;
                    }
                    const dx = t.clientX - nativeStartXRef.current;
                    // Right-anchored: moving RIGHT decreases width
                    applyWidth(dragStartWidthRef.current - dx);
                  };
                  const onUp = async () => {
                    nativeActiveRef.current = false;
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('touchend', onUp);
                    setGlobalDragging(false);
                    if (persistedType) {
                      try {
                        const domW = asideRef.current?.getBoundingClientRect().width;
                        const nextBase =
                          typeof domW === 'number' ? domW - extraWidthPx : widthRef.current;
                        const finalW = clamp(nextBase);
                        widthRef.current = finalW;
                        if (storageKey) {
                          setNumberSetting(storageKey, finalW);
                        }
                        await authApi.updateRightSidebarWidth({
                          type: persistedType,
                          width: finalW,
                        });
                      } catch {
                        // ignore
                      }
                    }
                  };
                  window.addEventListener('touchmove', onMove, { passive: true });
                  window.addEventListener('touchend', onUp);
                }}
              />

              {Sidebar ? (
                <div className="flex h-full flex-col overflow-auto">{<Sidebar id={id} />}</div>
              ) : null}
            </aside>
          </DndContext>
        )}
      </div>
    </RightSidebarLayoutContext.Provider>
  );
}
