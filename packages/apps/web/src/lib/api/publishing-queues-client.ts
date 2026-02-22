import type { HttpRequest } from '../http/http';

export type PublishingQueueLaneKey = 'post' | 'reel' | 'story' | 'any';

export type PublishingQueueSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  slotCount?: number;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type PublishingQueueListResponse = {
  success: boolean;
  data: {
    socialAccountId: string;
    queues: PublishingQueueSummary[];
    queueDepthCurrent?: number;
    queueDepthMax?: number | null;
  };
};

export type PublishingQueueSlot = {
  id: string;
  dayOfWeek: number;
  localTime: string;
  laneKey: PublishingQueueLaneKey;
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
    primaryAssetId?: string | null;
    mediaAssets?: Array<{ assetId: string; displayOrder: number }> | null;
    mediaAssetCount?: number | null;
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
    ) as Promise<PublishingQueueListResponse>;
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

  updateQueue(queueId: string, data: { name?: string; isDefault?: boolean }) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }) as Promise<{ success: boolean; data?: any; error?: string }>;
  }

  deleteQueue(queueId: string) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}`, {
      method: 'DELETE',
    }) as Promise<{
      success: boolean;
      error?: string;
      data?: {
        deletedQueueId: string;
        movedItemsCount: number;
        movedToQueueId: string;
      };
      errors?: Array<{ contentId: string; error: string }>;
      recompute?: any;
    }>;
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
    }>
  ) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/slots`, {
      method: 'PUT',
      body: JSON.stringify({ slots }),
    }) as Promise<{ success: boolean; error?: string }>;
  }

  applyPostingGoal(queueId: string, postsPerWeek: number) {
    return this.request(`/api/queues/${encodeURIComponent(queueId)}/posting-goal`, {
      method: 'POST',
      body: JSON.stringify({ postsPerWeek }),
    }) as Promise<{
      success: boolean;
      error?: string;
      data?: {
        postsPerWeek: number;
        requestedSlots: number;
        createdSlots: number;
        conflictingSlots: number;
        slots: Array<{
          dayOfWeek: number;
          localTime: string;
          laneKey: PublishingQueueLaneKey;
        }>;
      };
    }>;
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

  removeQueueItem(queueId: string, itemId: string) {
    return this.request(
      `/api/queues/${encodeURIComponent(queueId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' }
    ) as Promise<{ success: boolean; data?: any; error?: string }>;
  }

  listSlotInstances(params: {
    queueId: string;
    laneKey?: PublishingQueueLaneKey;
    limit?: number;
    after?: string;
  }) {
    const qs = new URLSearchParams();
    if (params.laneKey) {
      qs.set('laneKey', params.laneKey);
    }
    if (params.limit) {
      qs.set('limit', String(params.limit));
    }
    if (params.after) {
      qs.set('after', params.after);
    }

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
    if (params.laneKey) {
      qs.set('laneKey', params.laneKey);
    }
    if (params.limit) {
      qs.set('limit', String(params.limit));
    }
    if (params.after) {
      qs.set('after', params.after);
    }

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
