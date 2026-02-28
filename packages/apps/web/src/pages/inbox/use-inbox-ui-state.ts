import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { InboxChannelFilter, InboxPlatformFilter } from './types';

export type InboxUiState = {
  selectedAccountId: string;
  channel: InboxChannelFilter;
  platform: InboxPlatformFilter;
  itemQuery: string;
  selectedItemKey: string | null;
  activeReplyFor: string | null;
  replyText: string;
};

export function useInboxUiState(brandId?: string) {
  const [state, setState] = useState<InboxUiState>({
    selectedAccountId: '',
    channel: 'all',
    platform: 'all',
    itemQuery: '',
    selectedItemKey: null,
    activeReplyFor: null,
    replyText: '',
  });

  useEffect(() => {
    setState({
      selectedAccountId: '',
      channel: 'all',
      platform: 'all',
      itemQuery: '',
      selectedItemKey: null,
      activeReplyFor: null,
      replyText: '',
    });
  }, [brandId]);

  return { state, setState };
}

export function createInboxStateSetters(setState: Dispatch<SetStateAction<InboxUiState>>) {
  return {
    setSelectedAccountId: (selectedAccountId: string) =>
      setState((prev) => ({ ...prev, selectedAccountId })),
    setChannel: (channel: InboxChannelFilter) => setState((prev) => ({ ...prev, channel })),
    setPlatform: (platform: InboxPlatformFilter) => setState((prev) => ({ ...prev, platform })),
    setItemQuery: (itemQuery: string) => setState((prev) => ({ ...prev, itemQuery })),
    setSelectedItemKey: (selectedItemKey: string | null) =>
      setState((prev) => ({ ...prev, selectedItemKey })),
    setActiveReplyFor: (activeReplyFor: string | null) =>
      setState((prev) => ({ ...prev, activeReplyFor })),
    setReplyText: (replyText: string) => setState((prev) => ({ ...prev, replyText })),
  };
}
