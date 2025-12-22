import type { HttpRequest } from '../http/http';

export type PublishingQueueLaneKey = 'post' | 'reel' | 'story' | 'any';

export type PublishingQueueSummary = {
  id: string;
  name: string;
  paused: boolean;
  isDefault: boolean;
  slotCount?: number;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type PublishingQueueSlot = {
  id: string;
  dayOfWeek: number;
  localTime: string;
  laneKey: PublishingQueueLaneKey;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublishingQueueSlotInstance = {
  slotId: string;
  queueId: string;
  laneKey: PublishingQueueLaneKey;
  scheduledAt: string;
  occupied: boolean;
  occupiedContentId: string | null;
};

export type PublishingQueueItem = {
  id: string;
  queueId: string;
  contentId: string;
  laneKey: PublishingQueueLaneKey;
  position: number;
  notBefore: string | null;
  createdAt: string;
  updatedAt: string;
  estimatedScheduledAt: string | null;
  content: {
    id: string;
    caption: string;
    status: string;
    contentType: string;
    scheduledAt: string | null;
  } | null;
};

export type PublishingQueueLaneItems = {
  laneKey: PublishingQueueLaneKey;
  items: PublishingQueueItem[];
};

export class PublishingQueuesClient {
  constructor(private request: HttpRequest) {}

  listQueuesForSocialAccount(socialAccountId: string) {
    return this.request(
      `/api/social-accounts/${encodeURIComponent(socialAccountId)}/queues`
    ) as Promise<{
      success: boolean;
      data: { socialAccountId: string; queues: PublishingQueueSummary[] };
    }>;
  }

  createQueue(socialAccountId: string, name: string) {
    return this.request(`/api/social-accounts/${encodeURIComponent(socialAccountId)}/queues`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }) as Promise<{
      success: boolean;
      data?: Omit<PublishingQueueSummary, 'slotCount' | 'itemCount'>;
      error?: string;
    }>;
  }

  updateQueue(queueId: string, data: { name?: string; paused?: boolean }) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }) as Promise<{ success: boolean; data?: any; error?: string }>;
  }

  getQueueSlots(queueId: string) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/slots`) as Promise<{
      success: boolean;
      data: { queueId: string; socialAccountId: string; slots: PublishingQueueSlot[] };
    }>;
  }

  setQueueSlots(
    queueId: string,
    slots: Array<{
      dayOfWeek: number;
      localTime: string;
      laneKey: PublishingQueueLaneKey;
      enabled: boolean;
    }>
  ) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/slots`, {
      method: 'PUT',
      body: JSON.stringify({ slots }),
    }) as Promise<{ success: boolean; error?: string }>;
  }

  copySlotsFromQueue(queueId: string, fromQueueId: string) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/copy-slots-from`, {
      method: 'POST',
      body: JSON.stringify({ fromQueueId }),
    }) as Promise<{ success: boolean; error?: string }>;
  }

  addQueueItem(queueId: string, contentId: string) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ contentId }),
    }) as Promise<{ success: boolean; data?: any; error?: string; maxAllowed?: number }>;
  }

  listSlotInstances(params: {
    queueId: string;
    laneKey?: PublishingQueueLaneKey;
    limit?: number;
    after?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.laneKey) qs.set('laneKey', params.laneKey);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.after) qs.set('after', params.after);

    return this.request(
      `/api/queues/${encodeURIComponent(params.queueId)}/slot-instances${qs.toString() ? `?${qs.toString()}` : ''}`
    ) as Promise<{
      success: boolean;
      data: {
        queueId: string;
        socialAccountId: string;
        timezone: string;
        instances: PublishingQueueSlotInstance[];
      };
    }>;
  }

  listQueueItems(params: {
    queueId: string;
    laneKey?: PublishingQueueLaneKey;
    limit?: number;
    after?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.laneKey) qs.set('laneKey', params.laneKey);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.after) qs.set('after', params.after);

    return this.request(
      `/api/queues/${encodeURIComponent(params.queueId)}/items${qs.toString() ? `?${qs.toString()}` : ''}`
    ) as Promise<{
      success: boolean;
      data: {
        queueId: string;
        socialAccountId: string;
        timezone: string;
        lanes: PublishingQueueLaneItems[];
      };
    }>;
  }
}
