import { useSearchParams } from 'react-router-dom';

export interface RightSidebarRouteState {
  type?: string;
  id?: string;
  open: boolean;
}

export function useRightSidebarRouter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get('sidebar') ?? undefined;
  const id = searchParams.get('sidebarId') ?? undefined;
  const open = Boolean(type);

  const openSidebar = (
    t: string,
    opts?: { id?: string; params?: Record<string, string | undefined | null> }
  ) => {
    const next = new URLSearchParams(searchParams);
    next.set('sidebar', t);
    if (opts?.id) {
      next.set('sidebarId', opts.id);
    } else {
      next.delete('sidebarId');
    }
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v == null || v === '') {
          next.delete(k);
        } else {
          next.set(k, String(v));
        }
      }
    }
    setSearchParams(next, { replace: false });
  };

  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('sidebar');
    next.delete('sidebarId');
    // Clean up known aux params used by sidebars
    next.delete('assetId');
    next.delete('imageUrl');
    setSearchParams(next, { replace: false });
  };

  return { type, id, open, openSidebar, close } as RightSidebarRouteState & {
    openSidebar: (
      t: string,
      opts?: { id?: string; params?: Record<string, string | undefined | null> }
    ) => void;
    close: () => void;
  };
}
