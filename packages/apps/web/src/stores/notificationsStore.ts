import { create } from 'zustand';
import { notifications as notificationsApi } from '@/lib/api';
import type { Notification } from '@/lib/api';

interface NotificationsState {
  items: Notification[];
  nextCursor?: string;
  unreadCount: number;
  isOpen: boolean;
  loading: boolean;
  fetchLatest: () => Promise<void>;
  fetchMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  setOpen: (open: boolean) => void;
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  items: [],
  nextCursor: undefined,
  unreadCount: 0,
  isOpen: false,
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
    if (!cursor) return;
    const res = await notificationsApi.list({ cursor, limit: 20 });
    set((state) => ({ items: [...state.items, ...res.items], nextCursor: res.nextCursor }));
  },

  markRead: async (id: string) => {
    // optimistic
    set((state) => ({
      items: state.items.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
    await notificationsApi.mark(id, { read: true });
  },

  markAllRead: async () => {
    set((state) => ({
      items: state.items.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })),
      unreadCount: 0,
    }));
    await notificationsApi.markAllRead();
  },

  setOpen: (open: boolean) => set({ isOpen: open }),
}));
