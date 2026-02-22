/**
 * HTTP Request Handler
 *
 * Handles all HTTP CRUD operations for schedule management
 * Separated from EventBridge handlers for better maintainability
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  APIGatewayProxyEventV2,
} from 'aws-lambda';
import { ScheduleService } from '../services/schedule-service';
import {
  validatePublishNowRequest,
  validateScheduleRequest,
  validateScheduleUpdateRequest,
} from '../validators/schedule-validator';
import { createErrorResponse, createSuccessResponse } from '../utils/response-utils';
import { authenticateRequest, AuthenticationError } from '../utils/auth';

const logger = new Logger({ serviceName: 'schedule-management-http' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-management-http',
});

export class HttpHandler {
  private scheduleService: ScheduleService;

  constructor() {
    this.scheduleService = new ScheduleService();
  }

  /**
   * Main HTTP request handler
   */
  async handle(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult> {
    logger.info('Processing HTTP request', {
      path: this.getPath(event),
      method: this.getMethod(event),
    });

    const method = this.getMethod(event);
    const path = this.getPath(event);

    // Handle OPTIONS requests for CORS
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: '',
      };
    }

    try {
      // CRITICAL: Authenticate request (except health check)
      let authenticatedUserId: string | undefined;
      if (path !== '/health') {
        try {
          const user = authenticateRequest(event);
          authenticatedUserId = user.userId;
          logger.info('User authenticated', { userId: authenticatedUserId, path });
        } catch (error) {
          if (error instanceof AuthenticationError) {
            logger.warn('Authentication failed', { error: error.message, path });
            return createErrorResponse(error.statusCode, error.message, undefined, 'UNAUTHORIZED');
          }
          throw error; // Re-throw unexpected errors
        }
      }

      // Route requests to appropriate handlers
      if (path.startsWith('/schedules')) {
        return await this.handleScheduleRoutes(event, method, path, authenticatedUserId!);
      }
      if (path === '/health') {
        return await this.handleHealthCheck();
      }
      return createErrorResponse(404, 'Route not found', undefined, 'ROUTE_NOT_FOUND');
    } catch (error) {
      logger.error('HTTP request failed', { error, path, method });
      metrics.addMetric('HttpRequestError', MetricUnit.Count, 1);

      return createErrorResponse(500, 'Internal server error', undefined, 'INTERNAL_ERROR');
    } finally {
      this.flushMetrics();
    }
  }

  /**
   * Handle schedule-related routes
   */
  private async handleScheduleRoutes(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    method: string,
    path: string,
    userId: string
  ): Promise<APIGatewayProxyResult> {
    const pathSegments = path.split('/').filter(Boolean);

    switch (method) {
      case 'POST':
        if (pathSegments.length === 1) {
          // POST /schedules - create new schedule
          return await this.createSchedule(event, userId);
        }
        if (pathSegments.length === 2 && pathSegments[1] === 'publish-now') {
          // POST /schedules/publish-now - publish immediately (no EventBridge schedule creation)
          return await this.publishNow(event, userId);
        }
        return createErrorResponse(404, 'Route not found');

      case 'GET':
        if (pathSegments.length === 1) {
          // GET /schedules - list schedules with filters
          return await this.listSchedules(event, userId);
        }
        if (pathSegments.length === 2) {
          // GET /schedules/{id} - get specific schedule
          return await this.getSchedule(pathSegments[1], userId);
        }
        return createErrorResponse(404, 'Route not found');

      case 'PUT':
        if (pathSegments.length === 2) {
          // PUT /schedules/{id} - update schedule
          return await this.updateSchedule(event, pathSegments[1], userId);
        }
        return createErrorResponse(404, 'Route not found');

      case 'DELETE':
        if (pathSegments.length === 2) {
          // DELETE /schedules/{id} - delete schedule
          return await this.deleteSchedule(pathSegments[1], userId);
        }
        return createErrorResponse(404, 'Route not found', undefined, 'ROUTE_NOT_FOUND');

      default:
        return createErrorResponse(405, 'Method not allowed', undefined, 'METHOD_NOT_ALLOWED');
    }
  }

  /**
   * Create a new schedule
   */
  private async createSchedule(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    userId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);

      let scheduleRequest;
      try {
        scheduleRequest = JSON.parse(body);
      } catch {
        return createErrorResponse(
          400,
          'Invalid JSON in request body',
          undefined,
          'INVALID_REQUEST_BODY'
        );
      }

      // Always use the authenticated userId from IAM for validation + creation
      scheduleRequest.userId = userId;

      // Validate request
      const validation = validateScheduleRequest(scheduleRequest);
      if (!validation.valid) {
        logger.warn('Schedule validation failed', {
          errors: validation.errors,
          userId,
        });
        return createErrorResponse(400, 'Invalid request', { errors: validation.errors });
      }

      // CRITICAL: Verify user owns the brand before creating schedule
      const brandId = scheduleRequest.brandId;
      if (!brandId) {
        return createErrorResponse(400, 'Brand ID is required', undefined, 'MISSING_BRAND_ID');
      }

      const result = await this.scheduleService.createSchedule(scheduleRequest);

      if (result.success) {
        metrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);
        return createSuccessResponse(201, result.schedule);
      }
      logger.warn('Schedule service failed to create schedule', {
        error: result.error,
        userId,
        brandId,
      });
      return createErrorResponse(400, result.error || 'Failed to create schedule');
    } catch (error) {
      logger.error('Failed to create schedule', { error });
      return createErrorResponse(500, 'Failed to create schedule');
    }
  }

  /**
   * Publish content immediately by creating/updating a schedule record and emitting schedule.due.
   */
  private async publishNow(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    userId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);

      let scheduleRequest;
      try {
        scheduleRequest = JSON.parse(body);
      } catch {
        return createErrorResponse(
          400,
          'Invalid JSON in request body',
          undefined,
          'INVALID_REQUEST_BODY'
        );
      }

      // Always use the authenticated userId from IAM for validation + creation
      scheduleRequest.userId = userId;

      // Validate request
      const validation = validatePublishNowRequest(scheduleRequest);
      if (!validation.valid) {
        logger.warn('Publish-now validation failed', {
          errors: validation.errors,
          userId,
        });
        return createErrorResponse(400, 'Invalid request', { errors: validation.errors });
      }

      const brandId = scheduleRequest.brandId;
      if (!brandId) {
        return createErrorResponse(400, 'Brand ID is required', undefined, 'MISSING_BRAND_ID');
      }

      const result = await this.scheduleService.publishNow(scheduleRequest);

      if (result.success) {
        metrics.addMetric('PublishNowEnqueued', MetricUnit.Count, 1);
        return createSuccessResponse(201, result.schedule);
      }

      logger.warn('Schedule service failed to publish now', {
        error: result.error,
        userId,
        brandId,
      });
      return createErrorResponse(400, result.error || 'Failed to publish now');
    } catch (error) {
      logger.error('Failed to publish now', { error });
      return createErrorResponse(500, 'Failed to publish now');
    }
  }

  /**
   * List schedules with optional filters
   */
  private async listSchedules(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    userId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      const queryParams = this.getQueryParams(event);

      // Brand ID is required for listing schedules
      if (!queryParams.brandId) {
        return createErrorResponse(400, 'Brand ID is required', undefined, 'MISSING_BRAND_ID');
      }

      const result = await this.scheduleService.listSchedules(queryParams);

      if (result.success) {
        const schedulesForUser = (result.schedules || []).filter(
          (schedule) => schedule.userId === userId
        );
        return createSuccessResponse(200, {
          schedules: schedulesForUser,
          pagination: result.pagination,
        });
      }
      return createErrorResponse(400, result.error || 'Failed to list schedules');
    } catch (error) {
      logger.error('Failed to list schedules', { error });
      return createErrorResponse(500, 'Failed to list schedules');
    }
  }

  /**
   * Get a specific schedule
   */
  private async getSchedule(scheduleId: string, userId: string): Promise<APIGatewayProxyResult> {
    try {
      const result = await this.scheduleService.getSchedule(scheduleId);

      if (result.success && result.schedule) {
        // CRITICAL: Verify user owns the brand associated with this schedule
        const brandId = result.schedule.brandId;
        if (!brandId) {
          logger.error('Schedule missing brandId', { scheduleId });
          return createErrorResponse(500, 'Schedule data is invalid');
        }

        if (result.schedule.userId !== userId) {
          logger.warn('Unauthorized schedule access attempt', { userId, scheduleId });
          return createErrorResponse(403, 'Forbidden: You do not have access to this schedule');
        }

        return createSuccessResponse(200, result.schedule);
      }
      if (result.success && !result.schedule) {
        return createErrorResponse(404, 'Schedule not found', undefined, 'SCHEDULE_NOT_FOUND');
      }
      return createErrorResponse(400, result.error || 'Failed to get schedule');
    } catch (error) {
      logger.error('Failed to get schedule', { error, scheduleId });
      return createErrorResponse(500, 'Failed to get schedule');
    }
  }

  /**
   * Update a schedule
   */
  private async updateSchedule(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    scheduleId: string,
    userId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      // CRITICAL: First get the schedule to verify ownership
      const existingSchedule = await this.scheduleService.getSchedule(scheduleId);

      if (!existingSchedule.success || !existingSchedule.schedule) {
        return createErrorResponse(404, 'Schedule not found', undefined, 'SCHEDULE_NOT_FOUND');
      }

      const brandId = existingSchedule.schedule.brandId;
      if (!brandId) {
        logger.error('Schedule missing brandId', { scheduleId });
        return createErrorResponse(500, 'Schedule data is invalid');
      }

      if (existingSchedule.schedule.userId !== userId) {
        logger.warn('Unauthorized schedule update attempt', { userId, scheduleId, brandId });
        return createErrorResponse(403, 'Forbidden: You do not have access to this schedule');
      }

      const body = this.getBody(event);
      let updateRequest: Record<string, unknown>;
      try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return createErrorResponse(
            400,
            'Invalid JSON in request body',
            undefined,
            'INVALID_REQUEST_BODY'
          );
        }
        updateRequest = parsed as Record<string, unknown>;
      } catch {
        return createErrorResponse(
          400,
          'Invalid JSON in request body',
          undefined,
          'INVALID_REQUEST_BODY'
        );
      }

      // Never allow userId override (publisher token retrieval depends on schedule userId).
      if (
        typeof updateRequest.userId === 'string' &&
        updateRequest.userId.length > 0 &&
        updateRequest.userId !== userId
      ) {
        logger.warn('Attempted userId override in schedule update request', {
          userId,
          scheduleId,
          attemptedUserId: updateRequest.userId,
        });
        return createErrorResponse(403, 'Forbidden: You do not have access to this schedule');
      }

      // Validate update payload
      const validation = validateScheduleUpdateRequest(updateRequest);
      if (!validation.valid) {
        logger.warn('Schedule update validation failed', {
          errors: validation.errors,
          userId,
          scheduleId,
        });
        return createErrorResponse(400, 'Invalid request', { errors: validation.errors });
      }

      const result = await this.scheduleService.updateSchedule(scheduleId, updateRequest);

      if (result.success) {
        metrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);
        return createSuccessResponse(200, result.schedule);
      }
      return createErrorResponse(400, result.error || 'Failed to update schedule');
    } catch (error) {
      logger.error('Failed to update schedule', { error, scheduleId });
      return createErrorResponse(500, 'Failed to update schedule');
    }
  }

  /**
   * Delete a schedule
   */
  private async deleteSchedule(scheduleId: string, userId: string): Promise<APIGatewayProxyResult> {
    try {
      // CRITICAL: First get the schedule to verify ownership
      const existingSchedule = await this.scheduleService.getSchedule(scheduleId);

      if (!existingSchedule.success || !existingSchedule.schedule) {
        return createErrorResponse(404, 'Schedule not found', undefined, 'SCHEDULE_NOT_FOUND');
      }

      const brandId = existingSchedule.schedule.brandId;
      if (!brandId) {
        logger.error('Schedule missing brandId', { scheduleId });
        return createErrorResponse(500, 'Schedule data is invalid');
      }

      if (existingSchedule.schedule.userId !== userId) {
        logger.warn('Unauthorized schedule deletion attempt', { userId, scheduleId, brandId });
        return createErrorResponse(403, 'Forbidden: You do not have access to this schedule');
      }

      const result = await this.scheduleService.deleteSchedule(scheduleId);

      if (result.success) {
        metrics.addMetric('ScheduleDeleted', MetricUnit.Count, 1);
        return createSuccessResponse(204, null);
      }
      return createErrorResponse(400, result.error || 'Failed to delete schedule');
    } catch (error) {
      logger.error('Failed to delete schedule', { error, scheduleId });
      return createErrorResponse(500, 'Failed to delete schedule');
    }
  }

  /**
   * Health check endpoint
   */
  private async handleHealthCheck(): Promise<APIGatewayProxyResult> {
    try {
      const healthStatus = await this.scheduleService.healthCheck();

      if (healthStatus.healthy) {
        return createSuccessResponse(200, {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          details: healthStatus.details,
        });
      }
      return createErrorResponse(503, 'Service unhealthy', {
        status: 'unhealthy',
        details: healthStatus.details,
      });
    } catch (error) {
      logger.error('Health check failed', { error });
      return createErrorResponse(503, 'Health check failed');
    }
  }

  // Utility methods for extracting data from different event types
  private getMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    if ('httpMethod' in event) {
      return event.httpMethod; // API Gateway v1.0
    }
    return event.requestContext.http.method; // API Gateway v2.0 / Function URL
  }

  private getPath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    if ('path' in event) {
      return event.path; // API Gateway v1.0
    }
    return event.requestContext.http.path; // API Gateway v2.0 / Function URL
  }

  private getBody(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    return event.body || '{}';
  }

  private getQueryParams(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Record<string, string> {
    if ('queryStringParameters' in event) {
      // Filter out undefined values from query parameters
      const params: Record<string, string> = {};
      if (event.queryStringParameters) {
        for (const [key, value] of Object.entries(event.queryStringParameters)) {
          if (value !== undefined) {
            params[key] = value;
          }
        }
      }
      return params;
    }
    // API Gateway v2.0 / Function URL
    const params: Record<string, string> = {};
    if (event.queryStringParameters) {
      for (const [key, value] of Object.entries(event.queryStringParameters)) {
        if (value !== undefined) {
          params[key] = value;
        }
      }
    }
    return params;
  }

  /**
   * Publish metrics only when present to avoid Powertools warnings
   */
  private flushMetrics(): void {
    if (metrics.hasStoredMetrics()) {
      metrics.publishStoredMetrics();
    } else {
      metrics.clearMetrics();
      metrics.clearDimensions();
      metrics.clearMetadata();
    }
  }
}

// Export singleton instance
export const httpHandler = new HttpHandler();
