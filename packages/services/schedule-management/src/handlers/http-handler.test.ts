import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpHandler } from './http-handler';
import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';

// Mock services
vi.mock('../services/schedule-service', () => ({
  ScheduleService: vi.fn(() => ({
    createSchedule: vi.fn(),
    getSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    cancelSchedule: vi.fn(),
    getSchedulesByBrand: vi.fn(),
  })),
}));

vi.mock('../services/campaign-service', () => ({
  CampaignService: vi.fn(() => ({
    getCampaign: vi.fn(),
    updateCampaign: vi.fn(),
    getCampaignsByBrand: vi.fn(),
  })),
}));

vi.mock('@postolio/aws', () => ({
  createServiceLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    operationStart: vi.fn(),
    operationSuccess: vi.fn(),
    operationFailure: vi.fn(),
  })),
}));

describe('HttpHandler', () => {
  let httpHandler: HttpHandler;
  let mockScheduleService: {
    createSchedule: ReturnType<typeof vi.fn>;
    getSchedule: ReturnType<typeof vi.fn>;
    getSchedulesByBrand: ReturnType<typeof vi.fn>;
    updateSchedule: ReturnType<typeof vi.fn>;
    cancelSchedule: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    httpHandler = new HttpHandler();

    // Get the mock instances
    mockScheduleService = (httpHandler as unknown as { scheduleService: typeof mockScheduleService }).scheduleService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('handle', () => {
    it('should handle POST /schedules request', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          contentId: 'content-123',
          brandId: 'brand-789',
          userId: 'user-012',
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        headers: {},
      };

      mockScheduleService.createSchedule.mockResolvedValue({
        success: true,
        scheduleId: 'schedule-456',
        message: 'Schedule created successfully',
      });

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(201);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        scheduleId: 'schedule-456',
        message: 'Schedule created successfully',
      });
      expect(mockScheduleService.createSchedule).toHaveBeenCalledWith({
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        scheduledAt: expect.any(String),
      });
    });

    it('should handle GET /schedules/{id} request', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules/test-123',
        pathParameters: { id: 'test-123' },
        headers: {},
      };

      const mockSchedule = {
        scheduleId: 'test-123',
        contentId: 'content-123',
        status: 'pending',
        scheduledAt: new Date().toISOString(),
      };

      mockScheduleService.getSchedule.mockResolvedValue(mockSchedule);

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockSchedule);
      expect(mockScheduleService.getSchedule).toHaveBeenCalledWith('test-123');
    });

    it('should handle GET /schedules request with brand filter', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules',
        queryStringParameters: {
          brandId: 'brand-789',
          limit: '10',
        },
        headers: {},
      };

      const mockSchedules = {
        schedules: [
          { scheduleId: 'test-1', brandId: 'brand-789' },
          { scheduleId: 'test-2', brandId: 'brand-789' },
        ],
        nextToken: undefined,
      };

      mockScheduleService.getSchedulesByBrand.mockResolvedValue(mockSchedules);

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockSchedules);
      expect(mockScheduleService.getSchedulesByBrand).toHaveBeenCalledWith(
        'brand-789',
        { limit: 10 }
      );
    });

    it('should handle PUT /schedules/{id} request', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: '/schedules/test-123',
        pathParameters: { id: 'test-123' },
        body: JSON.stringify({
          caption: 'Updated caption',
          scheduledAt: new Date(Date.now() + 7200000).toISOString(),
        }),
        headers: {},
      };

      mockScheduleService.updateSchedule.mockResolvedValue({
        success: true,
        message: 'Schedule updated successfully',
      });

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Schedule updated successfully',
      });
      expect(mockScheduleService.updateSchedule).toHaveBeenCalledWith({
        scheduleId: 'test-123',
        updates: {
          caption: 'Updated caption',
          scheduledAt: expect.any(String),
        },
      });
    });

    it('should handle DELETE /schedules/{id} request', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: '/schedules/test-123',
        pathParameters: { id: 'test-123' },
        headers: {},
      };

      mockScheduleService.cancelSchedule.mockResolvedValue({
        success: true,
        message: 'Schedule cancelled successfully',
      });

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual({
        success: true,
        message: 'Schedule cancelled successfully',
      });
      expect(mockScheduleService.cancelSchedule).toHaveBeenCalledWith('test-123');
    });

    it('should return 404 for non-existent schedule', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules/non-existent',
        pathParameters: { id: 'non-existent' },
        headers: {},
      };

      mockScheduleService.getSchedule.mockResolvedValue(null);

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Schedule not found',
        code: 'SCHEDULE_NOT_FOUND',
      });
    });

    it('should return 400 for invalid JSON in request body', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: 'invalid json',
        headers: {},
      };

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Invalid JSON in request body',
        code: 'INVALID_REQUEST_BODY',
      });
    });

    it('should return 405 for unsupported HTTP methods', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PATCH',
        path: '/schedules',
        headers: {},
      };

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(405);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Method not allowed',
        code: 'METHOD_NOT_ALLOWED',
      });
    });

    it('should return 404 for unknown routes', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/unknown-path',
        headers: {},
      };

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Route not found',
        code: 'ROUTE_NOT_FOUND',
      });
    });

    it('should handle missing required query parameters', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules',
        queryStringParameters: null, // No brandId provided
        headers: {},
      };

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Brand ID is required',
        code: 'MISSING_BRAND_ID',
      });
    });

    it('should handle service errors gracefully', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          contentId: 'content-123',
          brandId: 'brand-789',
          userId: 'user-012',
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        headers: {},
      };

      const serviceError = new Error('Campaign validation failed') as Error & { code: string; retryable: boolean };
      serviceError.name = 'ServiceError';
      serviceError.code = 'CAMPAIGN_VALIDATION_FAILED';
      serviceError.retryable = false;

      mockScheduleService.createSchedule.mockRejectedValue(serviceError);

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Campaign validation failed',
        code: 'CAMPAIGN_VALIDATION_FAILED',
        retryable: false,
      });
    });

    it('should handle unexpected errors', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules/test-123',
        pathParameters: { id: 'test-123' },
        headers: {},
      };

      mockScheduleService.getSchedule.mockRejectedValue(new Error('Database connection failed'));

      const result = await httpHandler.handle(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body)).toEqual({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    });

    // Test API Gateway v2 event format
    it('should handle API Gateway v2 events', async () => {
      const event: Partial<APIGatewayProxyEventV2> = {
        requestContext: {
          http: {
            method: 'GET',
            path: '/schedules/test-123',
          },
        } as unknown as APIGatewayProxyEventV2['requestContext'],
        pathParameters: { id: 'test-123' },
        headers: {},
      };

      const mockSchedule = {
        scheduleId: 'test-123',
        contentId: 'content-123',
        status: 'pending',
      };

      mockScheduleService.getSchedule.mockResolvedValue(mockSchedule);

      const result = await httpHandler.handle(event as APIGatewayProxyEventV2);

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual(mockSchedule);
    });
  });

  describe('CORS headers', () => {
    it('should include CORS headers in all responses', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules/test-123',
        pathParameters: { id: 'test-123' },
        headers: {},
      };

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
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'OPTIONS',
        path: '/schedules',
        headers: {},
      };

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
});
