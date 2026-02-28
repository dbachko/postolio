import { PointerSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { auth as authApi } from '@/lib/api';
import { getNumberSetting, setNumberSetting } from '@/lib/settings/localSettings';

const DEFAULT_WIDTH_PX = 460;
const MIN_WIDTH_PX = 360;
const MAX_WIDTH_PX = 960;

type DragMoveEvent = { delta: { x: number; y: number } };

interface SidebarWidthStateArgs {
  open: boolean;
  type?: string;
  defaultWidthPx?: number;
  asideRef: RefObject<HTMLDivElement | null>;
}

interface SidebarWidthState {
  extraWidthPx: number;
  setExtraWidthPx: Dispatch<SetStateAction<number>>;
  effectiveWidthPx: number;
  applyWidth: (next: number) => number;
  widthRef: MutableRefObject<number>;
  setGlobalDragging: (active: boolean) => void;
  commitWidth: () => Promise<void>;
}

export interface RightSidebarResizeBindings {
  sensors: ReturnType<typeof useSensors>;
  resizeHandleAttributes: ReturnType<typeof useDraggable>['attributes'];
  resizeHandleListeners: ReturnType<typeof useDraggable>['listeners'];
  setResizeHandleRef: ReturnType<typeof useDraggable>['setNodeRef'];
  onDragStart: () => void;
  onDragMove: (event: DragMoveEvent) => void;
  onDragEnd: () => void;
  onResizeHandleMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeHandleTouchStart: (event: ReactTouchEvent<HTMLDivElement>) => void;
}

export interface RightSidebarWidthModel extends RightSidebarResizeBindings {
  extraWidthPx: number;
  setExtraWidthPx: Dispatch<SetStateAction<number>>;
  effectiveWidthPx: number;
}

function normalizeSidebarType(type?: string): string | undefined {
  if (!type) {
    return undefined;
  }
  return type === 'post-create' ? 'post' : type;
}

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, Math.round(width)));
}

function readStoredWidth(storageKey?: string): number | undefined {
  if (!storageKey) {
    return undefined;
  }
  return getNumberSetting(storageKey, {
    min: MIN_WIDTH_PX,
    max: MAX_WIDTH_PX,
    positive: true,
  }) as number | undefined;
}

function writeStoredWidth(storageKey: string | undefined, width: number) {
  if (!storageKey) {
    return;
  }
  setNumberSetting(storageKey, width);
}

function useApplyStoredWidthOnOpen({
  open,
  defaultWidthPx,
  storageKey,
  applyWidth,
}: {
  open: boolean;
  defaultWidthPx?: number;
  storageKey?: string;
  applyWidth: (next: number) => number;
}) {
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const storedWidth = readStoredWidth(storageKey);
    if (typeof storedWidth === 'number') {
      applyWidth(storedWidth);
      return;
    }
    if (defaultWidthPx) {
      applyWidth(defaultWidthPx);
    }
  }, [applyWidth, defaultWidthPx, open, storageKey]);
}

function useSyncWidthWithProfile({
  open,
  persistedType,
  storageKey,
  applyWidth,
}: {
  open: boolean;
  persistedType?: string;
  storageKey?: string;
  applyWidth: (next: number) => number;
}) {
  useEffect(() => {
    let active = true;
    const syncWidth = async () => {
      if (!open || !persistedType) {
        return;
      }
      const localWidth = readStoredWidth(storageKey);
      if (typeof localWidth === 'number') {
        applyWidth(localWidth);
      }
      try {
        const me = await authApi.getProfile();
        const prefs = me?.user?.uiPreferences as Record<string, any> | undefined;
        const saved = prefs?.rightSidebar?.[persistedType];
        if (!active || typeof saved !== 'number' || saved <= 0) {
          return;
        }
        if (typeof localWidth === 'number') {
          if (Math.abs(localWidth - saved) > 1) {
            await authApi.updateRightSidebarWidth({
              type: persistedType,
              width: clampWidth(localWidth),
            });
          }
          return;
        }
        const next = applyWidth(saved);
        writeStoredWidth(storageKey, next);
      } catch {
        // ignore profile sync failures
      }
    };
    void syncWidth();
    return () => {
      active = false;
    };
  }, [applyWidth, open, persistedType, storageKey]);
}

function useSidebarWidthState({
  open,
  type,
  defaultWidthPx,
  asideRef,
}: SidebarWidthStateArgs): SidebarWidthState {
  const persistedType = normalizeSidebarType(type);
  const storageKey = persistedType ? `ui:rightSidebar:${persistedType}:width` : undefined;
  const [widthPx, setWidthPx] = useState<number>(defaultWidthPx ?? DEFAULT_WIDTH_PX);
  const [extraWidthPx, setExtraWidthPx] = useState(0);
  const widthRef = useRef(widthPx);
  const effectiveWidthPx = widthPx + extraWidthPx;

  const applyWidth = useCallback((next: number) => {
    const clamped = clampWidth(next);
    widthRef.current = clamped;
    setWidthPx(clamped);
    return clamped;
  }, []);

  const setGlobalDragging = useCallback((active: boolean) => {
    if (typeof document === 'undefined') {
      return;
    }
    document.body.style.userSelect = active ? 'none' : '';
    document.body.style.cursor = active ? 'col-resize' : '';
  }, []);

  const commitWidth = useCallback(async () => {
    const domWidth = asideRef.current?.getBoundingClientRect().width;
    const baseWidth = typeof domWidth === 'number' ? domWidth - extraWidthPx : widthRef.current;
    const finalWidth = clampWidth(baseWidth);
    widthRef.current = finalWidth;
    writeStoredWidth(storageKey, finalWidth);
    if (!persistedType) {
      return;
    }
    await authApi.updateRightSidebarWidth({ type: persistedType, width: finalWidth });
  }, [asideRef, extraWidthPx, persistedType, storageKey]);

  useApplyStoredWidthOnOpen({ open, defaultWidthPx, storageKey, applyWidth });
  useSyncWidthWithProfile({ open, persistedType, storageKey, applyWidth });

  useEffect(() => {
    if (!open) {
      setExtraWidthPx(0);
    }
  }, [open]);

  return {
    extraWidthPx,
    setExtraWidthPx,
    effectiveWidthPx,
    applyWidth,
    widthRef,
    setGlobalDragging,
    commitWidth,
  };
}

function useSidebarResizeBindings({
  applyWidth,
  widthRef,
  setGlobalDragging,
  commitWidth,
}: Pick<SidebarWidthState, 'applyWidth' | 'widthRef' | 'setGlobalDragging' | 'commitWidth'>) {
  const dragStartWidthRef = useRef(0);
  const dndBindings = useSidebarDragBindings({
    applyWidth,
    widthRef,
    setGlobalDragging,
    commitWidth,
    dragStartWidthRef,
  });
  const nativeBindings = useSidebarNativeResizeBindings({
    applyWidth,
    widthRef,
    setGlobalDragging,
    commitWidth,
    dragStartWidthRef,
  });

  return { ...dndBindings, ...nativeBindings };
}

function useSidebarDragBindings({
  applyWidth,
  widthRef,
  setGlobalDragging,
  commitWidth,
  dragStartWidthRef,
}: Pick<SidebarWidthState, 'applyWidth' | 'widthRef' | 'setGlobalDragging' | 'commitWidth'> & {
  dragStartWidthRef: MutableRefObject<number>;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: 'right-sidebar-resize' });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));

  const onDragStart = useCallback(() => {
    dragStartWidthRef.current = widthRef.current;
    setGlobalDragging(true);
  }, [dragStartWidthRef, setGlobalDragging, widthRef]);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const dx = event.delta.x || 0;
      applyWidth(dragStartWidthRef.current - dx);
    },
    [applyWidth, dragStartWidthRef]
  );

  const onDragEnd = useCallback(() => {
    setGlobalDragging(false);
    void commitWidth();
  }, [commitWidth, setGlobalDragging]);

  return {
    sensors,
    resizeHandleAttributes: attributes,
    resizeHandleListeners: listeners,
    setResizeHandleRef: setNodeRef,
    onDragStart,
    onDragMove,
    onDragEnd,
  };
}

function useSidebarNativeResizeBindings({
  applyWidth,
  widthRef,
  setGlobalDragging,
  commitWidth,
  dragStartWidthRef,
}: Pick<SidebarWidthState, 'applyWidth' | 'widthRef' | 'setGlobalDragging' | 'commitWidth'> & {
  dragStartWidthRef: MutableRefObject<number>;
}) {
  const nativeStartXRef = useRef(0);
  const nativeActiveRef = useRef(false);

  const startNativeResize = useCallback(
    (startX: number, mode: 'mouse' | 'touch') => {
      nativeActiveRef.current = true;
      nativeStartXRef.current = startX;
      dragStartWidthRef.current = widthRef.current;
      setGlobalDragging(true);
      const onMove = (clientX: number) => {
        if (!nativeActiveRef.current) {
          return;
        }
        const dx = clientX - nativeStartXRef.current;
        applyWidth(dragStartWidthRef.current - dx);
      };
      const onEnd = () => {
        nativeActiveRef.current = false;
        setGlobalDragging(false);
        void commitWidth();
      };
      if (mode === 'mouse') {
        registerMouseResize(onMove, onEnd);
        return;
      }
      registerTouchResize(onMove, onEnd);
    },
    [applyWidth, commitWidth, dragStartWidthRef, setGlobalDragging, widthRef]
  );

  const onResizeHandleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      startNativeResize(event.clientX, 'mouse');
    },
    [startNativeResize]
  );

  const onResizeHandleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const touch = event.touches?.[0];
      if (!touch) {
        return;
      }
      startNativeResize(touch.clientX, 'touch');
    },
    [startNativeResize]
  );

  return {
    onResizeHandleMouseDown,
    onResizeHandleTouchStart,
  };
}

function registerMouseResize(onMove: (clientX: number) => void, onEnd: () => void) {
  const handleMove = (event: globalThis.MouseEvent) => onMove(event.clientX || 0);
  const handleUp = () => {
    window.removeEventListener('mousemove', handleMove);
    window.removeEventListener('mouseup', handleUp);
    onEnd();
  };
  window.addEventListener('mousemove', handleMove);
  window.addEventListener('mouseup', handleUp);
}

function registerTouchResize(onMove: (clientX: number) => void, onEnd: () => void) {
  const handleMove = (event: globalThis.TouchEvent) => {
    const touch = event.touches?.[0];
    if (touch) {
      onMove(touch.clientX);
    }
  };
  const handleUp = () => {
    window.removeEventListener('touchmove', handleMove);
    window.removeEventListener('touchend', handleUp);
    onEnd();
  };
  window.addEventListener('touchmove', handleMove, { passive: true });
  window.addEventListener('touchend', handleUp);
}

export function useRightSidebarWidth(args: SidebarWidthStateArgs): RightSidebarWidthModel {
  const widthState = useSidebarWidthState(args);
  const resizeBindings = useSidebarResizeBindings(widthState);

  return useMemo(
    () => ({
      extraWidthPx: widthState.extraWidthPx,
      setExtraWidthPx: widthState.setExtraWidthPx,
      effectiveWidthPx: widthState.effectiveWidthPx,
      ...resizeBindings,
    }),
    [
      resizeBindings,
      widthState.effectiveWidthPx,
      widthState.extraWidthPx,
      widthState.setExtraWidthPx,
    ]
  );
}
