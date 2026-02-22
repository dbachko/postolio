import type { HttpRequest } from '../http/http';

export interface NotificationItem {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  nextCursor?: string;
  unreadCount: number;
}

export interface NotificationPreferenceItem {
  id?: string;
  userId?: string;
  brandId?: string | null;
  category: string;
  type: string;
  // 'all' represents a master toggle for a type/category
  channel: 'in_app' | 'email' | 'digest' | 'push' | 'slack' | 'all';
  enabled: boolean;
  frequency?: 'instant' | 'daily' | 'weekly' | null;
  digestTime?: string | null;
}

export class NotificationsClient {
  constructor(private request: HttpRequest) {}

  list(params?: {
    cursor?: string;
    limit?: number;
    filter?: 'unread' | 'all' | 'archived';
    category?: string;
    type?: string;
    since?: string;
    brandId?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.cursor) {
      qs.set('cursor', params.cursor);
    }
    if (params?.limit) {
      qs.set('limit', String(params.limit));
    }
    if (params?.filter) {
      qs.set('filter', params.filter);
    }
    if (params?.category) {
      qs.set('category', params.category);
    }
    if (params?.type) {
      qs.set('type', params.type);
    }
    if (params?.since) {
      qs.set('since', params.since);
    }
    if (params?.brandId) {
      qs.set('brandId', params.brandId);
    }
    const query = qs.toString();
    return this.request(
      `/api/notifications${query ? `?${query}` : ''}`
    ) as Promise<NotificationListResponse>;
  }

  mark(id: string, patch: { read?: boolean; archived?: boolean; seen?: boolean }) {
    return this.request(`/api/notifications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }) as Promise<{ success: boolean }>;
  }

  markAllRead(before?: string) {
    return this.request(`/api/notifications/mark-all-read`, {
      method: 'POST',
      body: JSON.stringify(before ? { before } : {}),
    }) as Promise<{ success: boolean; marked: number }>;
  }

  getPreferences(brandId?: string) {
    const qs = brandId ? `?brandId=${encodeURIComponent(brandId)}` : '';
    return this.request(`/api/notifications/preferences${qs}`) as Promise<{
      items: NotificationPreferenceItem[];
      defaults: Array<
        Pick<NotificationPreferenceItem, 'category' | 'type' | 'channel' | 'enabled'>
      >;
    }>;
  }

  updatePreferences(updates: Array<Omit<NotificationPreferenceItem, 'id' | 'userId'>>) {
    return this.request(`/api/notifications/preferences`, {
      method: 'PATCH',
      body: JSON.stringify({ updates }),
    }) as Promise<{ success: boolean }>;
  }

  sendTest(brandId?: string, title?: string, body?: string) {
    return this.request(`/api/notifications/test`, {
      method: 'POST',
      body: JSON.stringify({ brandId, title, body }),
    }) as Promise<{ success: boolean; id: string }>;
  }
}
