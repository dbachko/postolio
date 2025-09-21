/**
 * HTTP Request Handler
 *
 * Handles all HTTP CRUD operations for schedule management
 * Separated from EventBridge handlers for better maintainability
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { APIGatewayProxyEvent, APIGatewayProxyResult, APIGatewayProxyEventV2 } from 'aws-lambda';
import { ScheduleService } from '../services/schedule-service';
import { CampaignService, CampaignRequest } from '../services/campaign-service';
import {
  validateCampaignRequest,
  validateScheduleRequest,
} from '../validators/schedule-validator';
import { createErrorResponse, createSuccessResponse } from '../utils/response-utils';

const logger = new Logger({ serviceName: 'schedule-management-http' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-management-http',
});

export class HttpHandler {
  private scheduleService: ScheduleService;
  private campaignService: CampaignService;

  constructor() {
    this.scheduleService = new ScheduleService();
    this.campaignService = new CampaignService();
  }

  /**
   * Main HTTP request handler
   */
  async handle(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Promise<APIGatewayProxyResult> {
    logger.info('Processing HTTP request', {
      path: this.getPath(event),
      method: this.getMethod(event),
    });

    const method = this.getMethod(event);
    const path = this.getPath(event);

    try {
      // Route requests to appropriate handlers
      if (path.startsWith('/schedules')) {
        return await this.handleScheduleRoutes(event, method, path);
      } else if (path.startsWith('/campaigns')) {
        return await this.handleCampaignRoutes(event, method, path);
      } else if (path === '/health') {
        return await this.handleHealthCheck();
      } else {
        return createErrorResponse(404, 'Route not found');
      }
    } catch (error) {
      logger.error('HTTP request failed', { error, path, method });
      metrics.addMetric('HttpRequestError', MetricUnit.Count, 1);

      return createErrorResponse(
        500,
        'Internal server error',
        process.env.LOG_LEVEL === 'DEBUG' ? { error: String(error) } : undefined
      );
    } finally {
      metrics.publishStoredMetrics();
    }
  }

  /**
   * Handle schedule-related routes
   */
  private async handleScheduleRoutes(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    method: string,
    path: string
  ): Promise<APIGatewayProxyResult> {
    const pathSegments = path.split('/').filter(Boolean);

    switch (method) {
      case 'POST':
        if (pathSegments.length === 1) {
          // POST /schedules - create new schedule
          return await this.createSchedule(event);
        }
        return createErrorResponse(404, 'Route not found');

      case 'GET':
        if (pathSegments.length === 1) {
          // GET /schedules - list schedules with filters
          return await this.listSchedules(event);
        } else if (pathSegments.length === 2) {
          // GET /schedules/{id} - get specific schedule
          return await this.getSchedule(pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      case 'PUT':
        if (pathSegments.length === 2) {
          // PUT /schedules/{id} - update schedule
          return await this.updateSchedule(event, pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      case 'DELETE':
        if (pathSegments.length === 2) {
          // DELETE /schedules/{id} - delete schedule
          return await this.deleteSchedule(pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      default:
        return createErrorResponse(405, 'Method not allowed');
    }
  }

  /**
   * Handle campaign-related routes
   */
  private async handleCampaignRoutes(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    method: string,
    path: string
  ): Promise<APIGatewayProxyResult> {
    const pathSegments = path.split('/').filter(Boolean);

    switch (method) {
      case 'POST':
        if (pathSegments.length === 1) {
          // POST /campaigns - create new campaign
          return await this.createCampaign(event);
        }
        return createErrorResponse(404, 'Route not found');

      case 'GET':
        if (pathSegments.length === 1) {
          // GET /campaigns - list campaigns
          return await this.listCampaigns(event);
        } else if (pathSegments.length === 2) {
          // GET /campaigns/{id} - get specific campaign
          return await this.getCampaign(pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      case 'PUT':
        if (pathSegments.length === 2) {
          // PUT /campaigns/{id} - update campaign
          return await this.updateCampaign(event, pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      case 'DELETE':
        if (pathSegments.length === 2) {
          // DELETE /campaigns/{id} - delete campaign
          return await this.deleteCampaign(pathSegments[1]);
        }
        return createErrorResponse(404, 'Route not found');

      default:
        return createErrorResponse(405, 'Method not allowed');
    }
  }

  /**
   * Create a new schedule
   */
  private async createSchedule(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);
      const scheduleRequest = JSON.parse(body);

      // Validate request
      const validation = validateScheduleRequest(scheduleRequest);
      if (!validation.valid) {
        return createErrorResponse(400, 'Invalid request', { errors: validation.errors });
      }

      const result = await this.scheduleService.createSchedule(scheduleRequest);

      if (result.success) {
        metrics.addMetric('ScheduleCreated', MetricUnit.Count, 1);
        return createSuccessResponse(201, result.schedule);
      } else {
        return createErrorResponse(400, result.error || 'Failed to create schedule');
      }
    } catch (error) {
      logger.error('Failed to create schedule', { error });
      return createErrorResponse(500, 'Failed to create schedule');
    }
  }

  /**
   * List schedules with optional filters
   */
  private async listSchedules(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult> {
    try {
      const queryParams = this.getQueryParams(event);
      const result = await this.scheduleService.listSchedules(queryParams);

      if (result.success) {
        return createSuccessResponse(200, {
          schedules: result.schedules,
          pagination: result.pagination,
        });
      } else {
        return createErrorResponse(400, result.error || 'Failed to list schedules');
      }
    } catch (error) {
      logger.error('Failed to list schedules', { error });
      return createErrorResponse(500, 'Failed to list schedules');
    }
  }

  /**
   * Get a specific schedule
   */
  private async getSchedule(scheduleId: string): Promise<APIGatewayProxyResult> {
    try {
      const result = await this.scheduleService.getSchedule(scheduleId);

      if (result.success && result.schedule) {
        return createSuccessResponse(200, result.schedule);
      } else if (result.success && !result.schedule) {
        return createErrorResponse(404, 'Schedule not found');
      } else {
        return createErrorResponse(400, result.error || 'Failed to get schedule');
      }
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
    scheduleId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);
      const updateRequest = JSON.parse(body);

      const result = await this.scheduleService.updateSchedule(scheduleId, updateRequest);

      if (result.success) {
        metrics.addMetric('ScheduleUpdated', MetricUnit.Count, 1);
        return createSuccessResponse(200, result.schedule);
      } else {
        return createErrorResponse(400, result.error || 'Failed to update schedule');
      }
    } catch (error) {
      logger.error('Failed to update schedule', { error, scheduleId });
      return createErrorResponse(500, 'Failed to update schedule');
    }
  }

  /**
   * Delete a schedule
   */
  private async deleteSchedule(scheduleId: string): Promise<APIGatewayProxyResult> {
    try {
      const result = await this.scheduleService.deleteSchedule(scheduleId);

      if (result.success) {
        metrics.addMetric('ScheduleDeleted', MetricUnit.Count, 1);
        return createSuccessResponse(204, null);
      } else {
        return createErrorResponse(400, result.error || 'Failed to delete schedule');
      }
    } catch (error) {
      logger.error('Failed to delete schedule', { error, scheduleId });
      return createErrorResponse(500, 'Failed to delete schedule');
    }
  }

  /**
   * Create a new campaign
   */
  private async createCampaign(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);
      const campaignRequest = JSON.parse(body);

      // Validate the request
      const validation = validateCampaignRequest(campaignRequest);
      if (!validation.valid) {
        return createErrorResponse(400, validation.errors.join(', '));
      }

      // Type assertion after validation
      const typedRequest = campaignRequest as CampaignRequest;
      const result = await this.campaignService.createCampaign(typedRequest);

      if (result.success) {
        metrics.addMetric('CampaignCreated', MetricUnit.Count, 1);
        return createSuccessResponse(201, result.campaign);
      } else {
        return createErrorResponse(400, result.error || 'Failed to create campaign');
      }
    } catch (error) {
      logger.error('Failed to create campaign', { error });
      return createErrorResponse(500, 'Failed to create campaign');
    }
  }

  /**
   * List campaigns
   */
  private async listCampaigns(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResult> {
    try {
      const queryParams = this.getQueryParams(event);
      const result = await this.campaignService.listCampaigns(queryParams);

      if (result.success) {
        return createSuccessResponse(200, {
          campaigns: result.campaigns,
          pagination: result.pagination,
        });
      } else {
        return createErrorResponse(400, result.error || 'Failed to list campaigns');
      }
    } catch (error) {
      logger.error('Failed to list campaigns', { error });
      return createErrorResponse(500, 'Failed to list campaigns');
    }
  }

  /**
   * Get a specific campaign
   */
  private async getCampaign(campaignId: string): Promise<APIGatewayProxyResult> {
    try {
      const result = await this.campaignService.getCampaign(campaignId);

      if (result.success && result.campaign) {
        return createSuccessResponse(200, result.campaign);
      } else if (result.success && !result.campaign) {
        return createErrorResponse(404, 'Campaign not found');
      } else {
        return createErrorResponse(400, result.error || 'Failed to get campaign');
      }
    } catch (error) {
      logger.error('Failed to get campaign', { error, campaignId });
      return createErrorResponse(500, 'Failed to get campaign');
    }
  }

  /**
   * Update a campaign
   */
  private async updateCampaign(
    event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
    campaignId: string
  ): Promise<APIGatewayProxyResult> {
    try {
      const body = this.getBody(event);
      const updateRequest = JSON.parse(body);

      const result = await this.campaignService.updateCampaign(campaignId, updateRequest);

      if (result.success) {
        metrics.addMetric('CampaignUpdated', MetricUnit.Count, 1);
        return createSuccessResponse(200, result.campaign);
      } else {
        return createErrorResponse(400, result.error || 'Failed to update campaign');
      }
    } catch (error) {
      logger.error('Failed to update campaign', { error, campaignId });
      return createErrorResponse(500, 'Failed to update campaign');
    }
  }

  /**
   * Delete a campaign
   */
  private async deleteCampaign(campaignId: string): Promise<APIGatewayProxyResult> {
    try {
      const result = await this.campaignService.deleteCampaign(campaignId);

      if (result.success) {
        metrics.addMetric('CampaignDeleted', MetricUnit.Count, 1);
        return createSuccessResponse(204, null);
      } else {
        return createErrorResponse(400, result.error || 'Failed to delete campaign');
      }
    } catch (error) {
      logger.error('Failed to delete campaign', { error, campaignId });
      return createErrorResponse(500, 'Failed to delete campaign');
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
      } else {
        return createErrorResponse(503, 'Service unhealthy', {
          status: 'unhealthy',
          details: healthStatus.details,
        });
      }
    } catch (error) {
      logger.error('Health check failed', { error });
      return createErrorResponse(503, 'Health check failed');
    }
  }

  // Utility methods for extracting data from different event types
  private getMethod(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    if ('httpMethod' in event) {
      return event.httpMethod; // API Gateway v1.0
    } else {
      return event.requestContext.http.method; // API Gateway v2.0 / Function URL
    }
  }

  private getPath(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    if ('path' in event) {
      return event.path; // API Gateway v1.0
    } else {
      return event.requestContext.http.path; // API Gateway v2.0 / Function URL
    }
  }

  private getBody(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): string {
    return event.body || '{}';
  }

  private getQueryParams(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): Record<string, string> {
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
    } else {
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
  }
}

// Export singleton instance
export const httpHandler = new HttpHandler();
