/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export interface PageMetaOverride {
  title?: string;
  description?: string;
}

interface PageMetaContextValue {
  override: PageMetaOverride | null;
  setOverride: (override: PageMetaOverride | null) => void;
}

const PageMetaContext = createContext<PageMetaContextValue | null>(null);

export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [override, setOverride] = useState<PageMetaOverride | null>(null);
  const value = useMemo(() => ({ override, setOverride }), [override]);
  return <PageMetaContext.Provider value={value}>{children}</PageMetaContext.Provider>;
}

export function usePageMeta() {
  const ctx = useContext(PageMetaContext);
  if (!ctx) {
    throw new Error('usePageMeta must be used within a PageMetaProvider');
  }
  return ctx;
}
