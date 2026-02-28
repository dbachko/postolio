import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
import type * as AuthUtils from '../utils/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpHandler } from './http-handler';

vi.mock('../utils/auth', async (importOriginal) => {
  const actual = await importOriginal<AuthUtils>();
  return {
    ...actual,
    verifyToken: vi.fn().mockResolvedValue({ userId: 'user-012', email: 'test@example.com' }),
    authenticateRequest: vi.fn().mockReturnValue({ userId: 'user-012', email: 'test@example.com' }),
  };
});

vi.mock('../services/schedule-service', () => {
  class MockScheduleService {
    createSchedule = vi.fn();
    publishNow = vi.fn();
    getSchedule = vi.fn();
    listSchedules = vi.fn();
    updateSchedule = vi.fn();
    deleteSchedule = vi.fn();
    healthCheck = vi.fn();
  }

  return { ScheduleService: MockScheduleService };
});

type MockScheduleService = {
  createSchedule: ReturnType<typeof vi.fn>;
  publishNow: ReturnType<typeof vi.fn>;
  getSchedule: ReturnType<typeof vi.fn>;
  listSchedules: ReturnType<typeof vi.fn>;
  updateSchedule: ReturnType<typeof vi.fn>;
  deleteSchedule: ReturnType<typeof vi.fn>;
  healthCheck: ReturnType<typeof vi.fn>;
};

const AUTHORIZATION_HEADERS = {
  Authorization: 'Bearer test-jwt-token',
};

const DEFAULT_IMAGE_ASSET = {
  key: 'images/2025-01-01/brand/content-123-abcd.jpg',
  type: 'image',
  order: 0,
};

function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

function buildEvent(overrides: Partial<APIGatewayProxyEvent>): Partial<APIGatewayProxyEvent> {
  const headers = {
    ...AUTHORIZATION_HEADERS,
    ...(overrides.headers ?? {}),
  };

  return {
    ...overrides,
    headers,
  };
}

let httpHandler: HttpHandler;
let mockScheduleService: MockScheduleService;

beforeEach(() => {
  vi.clearAllMocks();
  httpHandler = new HttpHandler();

  mockScheduleService = (
    httpHandler as unknown as {
      scheduleService: MockScheduleService;
    }
  ).scheduleService;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpHandler handle create and publish', () => {
  it('should handle POST /schedules request', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      path: '/schedules',
      body: JSON.stringify({
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'post',
        mediaType: 'image',
        scheduledAt: futureIso(1),
        mediaAssets: [DEFAULT_IMAGE_ASSET],
        firstComment: 'First comment from API',
      }),
    });

    const mockSchedule = {
      scheduleId: 'schedule-456',
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      platform: 'instagram',
      contentType: 'post',
      mediaType: 'image',
      scheduledAt: futureIso(1),
      status: 'pending',
    };

    mockScheduleService.createSchedule.mockResolvedValue({
      success: true,
      schedule: mockSchedule,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(201);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toEqual(mockSchedule);
    expect(responseBody.timestamp).toBeDefined();
    expect(mockScheduleService.createSchedule).toHaveBeenCalledWith({
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      platform: 'instagram',
      contentType: 'post',
      mediaType: 'image',
      scheduledAt: expect.any(String),
      mediaAssets: [DEFAULT_IMAGE_ASSET],
      firstComment: 'First comment from API',
    });
  });

  it('should handle POST /schedules/publish-now request', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      path: '/schedules/publish-now',
      body: JSON.stringify({
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'overridden',
        platform: 'instagram',
        contentType: 'post',
        mediaType: 'image',
        mediaAssets: [DEFAULT_IMAGE_ASSET],
        firstComment: 'First comment from API',
      }),
    });

    const mockSchedule = {
      scheduleId: 'schedule-456',
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      platform: 'instagram',
      contentType: 'post',
      mediaType: 'image',
      scheduledAt: new Date().toISOString(),
      status: 'scheduled',
    };

    mockScheduleService.publishNow.mockResolvedValue({
      success: true,
      schedule: mockSchedule,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(201);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toEqual(mockSchedule);
    expect(responseBody.timestamp).toBeDefined();
    expect(mockScheduleService.publishNow).toHaveBeenCalledWith({
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      platform: 'instagram',
      contentType: 'post',
      mediaType: 'image',
      mediaAssets: [DEFAULT_IMAGE_ASSET],
      firstComment: 'First comment from API',
    });
  });
});

describe('HttpHandler handle read and list', () => {
  it('should handle GET /schedules/{id} request', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
    });

    const mockSchedule = {
      scheduleId: 'test-123',
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      status: 'pending',
      scheduledAt: new Date().toISOString(),
    };

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: mockSchedule,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toEqual(mockSchedule);
    expect(responseBody.timestamp).toBeDefined();
    expect(mockScheduleService.getSchedule).toHaveBeenCalledWith('test-123');
  });

  it('should handle GET /schedules request with brand filter', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules',
      queryStringParameters: {
        brandId: 'brand-789',
        limit: '10',
      },
    });

    const mockSchedules = {
      schedules: [
        { scheduleId: 'test-1', brandId: 'brand-789', userId: 'user-012' },
        { scheduleId: 'test-2', brandId: 'brand-789', userId: 'user-012' },
      ],
      nextToken: undefined,
    };

    mockScheduleService.listSchedules.mockResolvedValue({
      success: true,
      schedules: mockSchedules.schedules,
      pagination: {
        nextToken: mockSchedules.nextToken,
        hasMore: false,
      },
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data.schedules).toEqual(mockSchedules.schedules);
    expect(responseBody.data.pagination).toBeDefined();
    expect(responseBody.timestamp).toBeDefined();
    expect(mockScheduleService.listSchedules).toHaveBeenCalledWith({
      brandId: 'brand-789',
      limit: '10',
    });
  });
});

describe('HttpHandler handle update and delete', () => {
  it('should handle PUT /schedules/{id} request', async () => {
    const event = buildEvent({
      httpMethod: 'PUT',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
      body: JSON.stringify({
        caption: 'Updated caption',
        scheduledAt: futureIso(2),
      }),
    });

    const mockUpdatedSchedule = {
      scheduleId: 'test-123',
      brandId: 'brand-789',
      userId: 'user-012',
      caption: 'Updated caption',
      scheduledAt: futureIso(2),
      status: 'pending',
    };

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: mockUpdatedSchedule,
    });

    mockScheduleService.updateSchedule.mockResolvedValue({
      success: true,
      schedule: mockUpdatedSchedule,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toEqual(mockUpdatedSchedule);
    expect(responseBody.timestamp).toBeDefined();
    expect(mockScheduleService.updateSchedule).toHaveBeenCalledWith('test-123', {
      caption: 'Updated caption',
      scheduledAt: expect.any(String),
    });
  });

  it('should return 400 for invalid schedule update payload', async () => {
    const event = buildEvent({
      httpMethod: 'PUT',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
      body: JSON.stringify({
        thumbOffset: -1,
      }),
    });

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: {
        scheduleId: 'test-123',
        brandId: 'brand-789',
        userId: 'user-012',
        status: 'pending',
        scheduledAt: futureIso(1),
      },
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Invalid request',
      details: {
        errors: ['thumbOffset must be greater than or equal to 0'],
      },
    });
    expect(mockScheduleService.updateSchedule).not.toHaveBeenCalled();
  });

  it('should handle DELETE /schedules/{id} request', async () => {
    const event = buildEvent({
      httpMethod: 'DELETE',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
    });

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: {
        scheduleId: 'test-123',
        brandId: 'brand-789',
        userId: 'user-012',
        status: 'pending',
      },
    });

    mockScheduleService.deleteSchedule.mockResolvedValue({ success: true });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(204);
    expect(result.body).toBe('');
    expect(mockScheduleService.deleteSchedule).toHaveBeenCalledWith('test-123');
  });
});

describe('HttpHandler handle routing and validation errors', () => {
  it('should return 400 for invalid JSON in request body', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      path: '/schedules',
      body: 'invalid json',
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Invalid JSON in request body',
      code: 'INVALID_REQUEST_BODY',
    });
  });

  it('should return 405 for unsupported HTTP methods', async () => {
    const event = buildEvent({
      httpMethod: 'PATCH',
      path: '/schedules',
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(405);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Method not allowed',
      code: 'METHOD_NOT_ALLOWED',
    });
  });

  it('should return 404 for unknown routes', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/unknown-path',
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Route not found',
      code: 'ROUTE_NOT_FOUND',
    });
  });

  it('should handle missing required query parameters', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules',
      queryStringParameters: null,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Brand ID is required',
      code: 'MISSING_BRAND_ID',
    });
  });

  it('should handle service errors gracefully', async () => {
    const event = buildEvent({
      httpMethod: 'POST',
      path: '/schedules',
      body: JSON.stringify({
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        scheduledAt: futureIso(1),
      }),
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Invalid request',
      details: {
        errors: ['contentType is required and must be a string'],
      },
    });
  });
});

describe('HttpHandler handle data access failures', () => {
  it('should return 404 for non-existent schedule', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules/non-existent',
      pathParameters: { id: 'non-existent' },
    });

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: undefined,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Schedule not found',
      code: 'SCHEDULE_NOT_FOUND',
    });
  });

  it('should handle unexpected errors', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
    });

    mockScheduleService.getSchedule.mockRejectedValue(new Error('Database connection failed'));

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body)).toEqual({
      error: 'Failed to get schedule',
    });
  });
});

describe('HttpHandler with API Gateway v2 events', () => {
  it('should handle API Gateway v2 events', async () => {
    const event: Partial<APIGatewayProxyEventV2> = {
      requestContext: {
        http: {
          method: 'GET',
          path: '/schedules/test-123',
        },
      } as unknown as APIGatewayProxyEventV2['requestContext'],
      pathParameters: { id: 'test-123' },
      headers: AUTHORIZATION_HEADERS,
    };

    const mockSchedule = {
      scheduleId: 'test-123',
      contentId: 'content-123',
      brandId: 'brand-789',
      userId: 'user-012',
      status: 'pending',
    };

    mockScheduleService.getSchedule.mockResolvedValue({
      success: true,
      schedule: mockSchedule,
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEventV2);

    expect(result.statusCode).toBe(200);
    const responseBody = JSON.parse(result.body);
    expect(responseBody.success).toBe(true);
    expect(responseBody.data).toEqual(mockSchedule);
    expect(responseBody.timestamp).toBeDefined();
  });
});

describe('HttpHandler CORS headers', () => {
  it('should include CORS headers in all responses', async () => {
    const event = buildEvent({
      httpMethod: 'GET',
      path: '/schedules/test-123',
      pathParameters: { id: 'test-123' },
    });

    mockScheduleService.getSchedule.mockResolvedValue({ scheduleId: 'test-123' });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
  });

  it('should handle OPTIONS preflight requests', async () => {
    const event = buildEvent({
      httpMethod: 'OPTIONS',
      path: '/schedules',
    });

    const result = await httpHandler.handle(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('');
    expect(result.headers).toEqual({
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
  });
});
