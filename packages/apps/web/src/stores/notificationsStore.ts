import { create } from 'zustand';
import { notifications as notificationsApi, type Notification } from '@/lib/api';

interface NotificationsState {
  items: Notification[];
  nextCursor?: string;
  unreadCount: number;
  loading: boolean;
  fetchLatest: () => Promise<void>;
  fetchMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  nextCursor: undefined,
  unreadCount: 0,
  loading: false,

  fetchLatest: async () => {
    set({ loading: true });
    try {
      const res = await notificationsApi.list({ limit: 20 });
      set({ items: res.items, nextCursor: res.nextCursor, unreadCount: res.unreadCount });
    } finally {
      set({ loading: false });
    }
  },

  fetchMore: async () => {
    const cursor = get().nextCursor;
    if (!cursor) {
      return;
    }
    const res = await notificationsApi.list({ cursor, limit: 20 });
    set((state) => ({ items: [...state.items, ...res.items], nextCursor: res.nextCursor }));
  },

  markRead: async (id: string) => {
    // optimistic: remove from unread view and sidebar; keep list fetch authoritative
    set((state) => {
      const updated = state.items.map((n) =>
        n.id === id ? { ...n, readAt: new Date().toISOString() } : n
      );
      return {
        items: updated,
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    });
    await notificationsApi.mark(id, { read: true });
  },

  markAllRead: async () => {
    set((state) => ({
      items: state.items.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })),
      unreadCount: 0,
    }));
    await notificationsApi.markAllRead();
  },
}));
