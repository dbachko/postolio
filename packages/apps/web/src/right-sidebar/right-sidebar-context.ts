import { createContext, useContext } from 'react';

export interface RightSidebarLayoutContextValue {
  open: boolean;
  isSmall: boolean;
  extraWidthPx: number;
  setExtraWidthPx: (width: number) => void;
}

const RightSidebarLayoutContext = createContext<RightSidebarLayoutContextValue | null>(null);

export function useRightSidebarLayout() {
  return useContext(RightSidebarLayoutContext);
}

export { RightSidebarLayoutContext };
