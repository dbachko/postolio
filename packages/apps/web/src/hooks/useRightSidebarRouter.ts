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

  const openSidebar = (t: string, opts?: { id?: string }) => {
    const next = new URLSearchParams(searchParams);
    next.set('sidebar', t);
    if (opts?.id) next.set('sidebarId', opts.id);
    else next.delete('sidebarId');
    setSearchParams(next, { replace: false });
  };

  const close = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('sidebar');
    next.delete('sidebarId');
    setSearchParams(next, { replace: false });
  };

  return { type, id, open, openSidebar, close } as RightSidebarRouteState & {
    openSidebar: (t: string, opts?: { id?: string }) => void;
    close: () => void;
  };
}
