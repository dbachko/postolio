import {
  type CreateScheduleInput,
  type ListSchedulesParams,
  type Platform,
  type PublishNowInput,
  type Schedule,
  type ScheduleList,
  type UpdateScheduleInput,
  CreateScheduleInputSchema,
  ListSchedulesParamsSchema,
  PublishNowInputSchema,
  ScheduleListSchema,
  ScheduleSchema,
  UpdateScheduleInputSchema,
} from './content-scheduler-client.schemas.js';
import {
  executeWithCircuitBreaker,
  getCachedResponse,
  retryWithBackoff,
  setCachedResponse,
} from './content-scheduler-client.internal.js';

type ClientLike = any;

export async function createScheduleOperation(
  client: ClientLike,
  data: CreateScheduleInput
): Promise<Schedule> {
  return executeWithCircuitBreaker(client, async () => {
    const validatedData = CreateScheduleInputSchema.parse(data);
    const response = await retryWithBackoff<any>(client, () =>
      client.client.post('schedules', validatedData)
    );

    if (client.debug) {
      const size = client.safeSize(response.data);
      client.log('info', 'scheduler.http.create.response', {
        status: response.status,
        size,
        body: size < 2048 ? response.data : undefined,
      });
    }

    const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
    return client.parseScheduleResponseData(responseBody.data, {
      path: 'schedules',
      status: response.status,
    });
  });
}

export async function publishNowOperation(
  client: ClientLike,
  data: PublishNowInput
): Promise<Schedule> {
  return executeWithCircuitBreaker(client, async () => {
    const validatedData = PublishNowInputSchema.parse(data);
    const response = await retryWithBackoff<any>(client, () =>
      client.client.post('schedules/publish-now', validatedData)
    );

    if (client.debug) {
      const size = client.safeSize(response.data);
      client.log('info', 'scheduler.http.publishNow.response', {
        status: response.status,
        size,
        body: size < 2048 ? response.data : undefined,
      });
    }

    const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
    return client.parseScheduleResponseData(responseBody.data, {
      path: 'schedules/publish-now',
      status: response.status,
    });
  });
}

export async function updateScheduleOperation(
  client: ClientLike,
  id: string,
  data: UpdateScheduleInput
): Promise<Schedule> {
  return executeWithCircuitBreaker(client, async () => {
    const validatedData = UpdateScheduleInputSchema.parse(data);
    const response = await retryWithBackoff<any>(client, () =>
      client.client.put(`schedules/${id}`, validatedData)
    );
    const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
    return client.parseScheduleResponseData(responseBody.data, {
      path: `schedules/${id}`,
      status: response.status,
    });
  });
}

export async function deleteScheduleOperation(
  client: ClientLike,
  id: string,
  options?: { userId?: string }
): Promise<void> {
  return executeWithCircuitBreaker(client, async () => {
    const headers: Record<string, string> = {};
    const userId = options?.userId?.trim().length ? options.userId.trim() : null;
    if (userId) {
      headers['X-User-Context'] = userId;
    }

    await retryWithBackoff(client, () =>
      client.client.delete(`schedules/${id}`, Object.keys(headers).length ? { headers } : undefined)
    );
  });
}

export async function getScheduleOperation(client: ClientLike, id: string): Promise<Schedule> {
  const cacheKey = `GET:schedules/${id}`;
  const cached = getCachedResponse(client, cacheKey);
  if (cached) {
    return cached as Schedule;
  }

  return executeWithCircuitBreaker(client, async () => {
    const response = await retryWithBackoff<any>(client, () =>
      client.client.get(`schedules/${id}`)
    );
    const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
    const result = ScheduleSchema.parse(responseBody.data);
    setCachedResponse(client, cacheKey, result, response.headers.etag);
    return result;
  });
}

export async function listSchedulesOperation(
  client: ClientLike,
  params: ListSchedulesParams = { limit: 20, offset: 0 }
): Promise<ScheduleList> {
  return executeWithCircuitBreaker(client, async () => {
    const validatedParams = ListSchedulesParamsSchema.parse(params);
    const response = await retryWithBackoff<any>(client, () =>
      client.client.get('schedules', { params: validatedParams })
    );
    const responseBody = response.data as { success: boolean; data: unknown; timestamp: string };
    return ScheduleListSchema.parse(responseBody.data);
  });
}

export function cancelScheduleOperation(client: ClientLike, id: string): Promise<Schedule> {
  return updateScheduleOperation(client, id, { status: 'cancelled' });
}

export function rescheduleOperation(
  client: ClientLike,
  id: string,
  newTime: Date,
  requiredFields: {
    brandId: string;
    contentId: string;
    userId: string;
    platform?: string;
  }
): Promise<Schedule> {
  const updateData: UpdateScheduleInput = {
    scheduledAt: newTime.toISOString(),
    status: 'scheduled',
    brandId: requiredFields.brandId,
    contentId: requiredFields.contentId,
    userId: requiredFields.userId,
    platform: (requiredFields.platform as Platform) || 'instagram',
  };
  return updateScheduleOperation(client, id, updateData);
}

export function getSchedulesByBrandOperation(
  client: ClientLike,
  brandId: string,
  params: Omit<ListSchedulesParams, 'brandId'> = { limit: 20, offset: 0 }
): Promise<ScheduleList> {
  return listSchedulesOperation(client, { ...params, brandId });
}

export async function getUpcomingSchedulesOperation(
  client: ClientLike,
  brandId: string,
  limit = 10
): Promise<Schedule[]> {
  const result = await listSchedulesOperation(client, {
    brandId,
    status: 'scheduled',
    startTime: new Date().toISOString(),
    limit,
    offset: 0,
  });
  return result.schedules;
}

export async function getSchedulingStatsOperation(client: ClientLike, brandId: string) {
  const statuses = [
    'scheduled',
    'published',
    'failed',
    'cancelled',
    'canceled',
    'processing',
  ] as const;
  type StatStatus = (typeof statuses)[number];

  const results = await Promise.all(
    statuses.map((status) =>
      listSchedulesOperation(client, {
        brandId,
        status,
        limit: 1,
        offset: 0,
      })
    )
  );

  const stats: Record<StatStatus, number> = {
    scheduled: 0,
    published: 0,
    failed: 0,
    cancelled: 0,
    canceled: 0,
    processing: 0,
  };
  statuses.forEach((status, index) => {
    const result = results[index];
    stats[status] = result ? (result.total ?? 0) : 0;
  });

  return {
    scheduled: stats.scheduled,
    published: stats.published,
    failed: stats.failed,
    cancelled: stats.cancelled + stats.canceled,
    processing: stats.processing,
  };
}

export async function healthCheckOperation(client: ClientLike): Promise<boolean> {
  try {
    const response = await client.client.get('health', { timeout: 5000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
