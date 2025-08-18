import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler as scheduleHandler } from '../aws-infrastructure/lib/lambda/schedule-management/index';

// Mock AWS services
jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/client-scheduler');
jest.mock('@aws-sdk/client-secrets-manager');
jest.mock('@aws-lambda-powertools/logger');
jest.mock('@aws-lambda-powertools/tracer');
jest.mock('@aws-lambda-powertools/metrics');

describe('Content Scheduler API Tests', () => {
  let dynamoClient: DynamoDBDocumentClient;
  const testBrandId = 'test-brand-123';
  const testContentId = 'test-content-456';
  const testUserId = 'test-user-789';

  beforeAll(() => {
    // Set up environment variables
    process.env.SCHEDULES_TABLE = 'test-schedules-table';
    process.env.SCHEDULER_GROUP_NAME = 'test-scheduler-group';
    process.env.PUBLISHER_LAMBDA_ARN = 'arn:aws:lambda:us-east-1:123456789012:function:test-publisher';
    process.env.SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-scheduler-role';
    
    // Initialize mock DynamoDB client
    dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  });

  afterAll(async () => {
    // Clean up test data using a real DynamoDB client (not mocked)
    // Skip cleanup in test environment since we're using mocks
    if (process.env.NODE_ENV !== 'test') {
      // Temporarily restore the real implementation for cleanup
      jest.unmock('@aws-sdk/client-dynamodb');
      jest.unmock('@aws-sdk/lib-dynamodb');
      
      const { DynamoDBClient: RealDynamoDBClient } = await import('@aws-sdk/client-dynamodb');
      const { DynamoDBDocumentClient: RealDocClient, ScanCommand: RealScanCommand, DeleteCommand: RealDeleteCommand } = await import('@aws-sdk/lib-dynamodb');
      
      const realDynamoClient = RealDocClient.from(new RealDynamoDBClient({}));
      
      const scanResult = await realDynamoClient.send(new RealScanCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        FilterExpression: 'brandId = :brandId',
        ExpressionAttributeValues: {
          ':brandId': testBrandId,
        },
      }));

      if (scanResult.Items && scanResult.Items.length > 0) {
        for (const item of scanResult.Items) {
          await realDynamoClient.send(new RealDeleteCommand({
            TableName: process.env.SCHEDULES_TABLE!,
            Key: {
              pk: item.pk,
              sk: item.sk,
            },
          }));
        }
      }
    }
  });

  describe('POST /schedules - Create Schedule', () => {
    it('should create a new schedule with valid data', async () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: futureDate,
          contentType: 'image',
          caption: 'Test post caption',
          hashtags: ['test', 'scheduler'],
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(201);
      const body = JSON.parse(result.body);
      expect(body.scheduleId).toBeDefined();
      expect(body.message).toBe('Schedule created successfully');
    });

    it('should reject schedule with invalid platform', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'invalid-platform',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Validation failed');
      expect(body.errors).toContain('platform must be one of: instagram, facebook, twitter, linkedin, youtube');
    });

    it('should reject schedule with past date', async () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: pastDate,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Validation failed');
      expect(body.errors).toContain('scheduledAt must be in the future');
    });

    it('should validate required fields', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({}),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Validation failed');
      expect(body.errors).toContain('brandId is required');
      expect(body.errors).toContain('contentId is required');
      expect(body.errors).toContain('platform is required');
      expect(body.errors).toContain('scheduledAt is required');
    });

    it('should enforce platform-specific caption length', async () => {
      const longCaption = 'a'.repeat(300); // Exceeds Twitter's 280 limit
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'twitter',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          caption: longCaption,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Validation failed');
      expect(body.errors).toContain('caption exceeds maximum length of 280 characters for twitter');
    });
  });

  describe('GET /schedules - List Schedules', () => {
    let createdScheduleId: string;

    beforeEach(async () => {
      // Create a test schedule
      const createEvent: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          contentType: 'image',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const createResult = await scheduleHandler(createEvent as APIGatewayProxyEvent);
      const body = JSON.parse(createResult.body);
      createdScheduleId = body.scheduleId;
    });

    it('should list schedules for a brand', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules',
        queryStringParameters: {
          brandId: testBrandId,
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.schedules).toBeDefined();
      expect(Array.isArray(body.schedules)).toBe(true);
    });

    it('should filter schedules by status', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules',
        queryStringParameters: {
          brandId: testBrandId,
          status: 'scheduled',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.schedules).toBeDefined();
      if (body.schedules.length > 0) {
        expect(body.schedules.every((s: any) => s.status === 'scheduled')).toBe(true);
      }
    });
  });

  describe('GET /schedules/{scheduleId} - Get Schedule', () => {
    let createdScheduleId: string;

    beforeEach(async () => {
      // Create a test schedule
      const createEvent: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const createResult = await scheduleHandler(createEvent as APIGatewayProxyEvent);
      const body = JSON.parse(createResult.body);
      createdScheduleId = body.scheduleId;
    });

    it('should retrieve a specific schedule', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: `/schedules/${createdScheduleId}`,
        pathParameters: {
          scheduleId: createdScheduleId,
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.scheduleId).toBe(createdScheduleId);
      expect(body.brandId).toBe(testBrandId);
    });

    it('should return 404 for non-existent schedule', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/schedules/non-existent-id',
        pathParameters: {
          scheduleId: 'non-existent-id',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Schedule not found');
    });
  });

  describe('PUT /schedules/{scheduleId} - Update Schedule', () => {
    let createdScheduleId: string;

    beforeEach(async () => {
      // Create a test schedule
      const createEvent: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          caption: 'Original caption',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const createResult = await scheduleHandler(createEvent as APIGatewayProxyEvent);
      const body = JSON.parse(createResult.body);
      createdScheduleId = body.scheduleId;
    });

    it('should update schedule caption', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: `/schedules/${createdScheduleId}`,
        pathParameters: {
          scheduleId: createdScheduleId,
        },
        body: JSON.stringify({
          caption: 'Updated caption',
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Schedule updated successfully');
      expect(body.data.caption).toBe('Updated caption');
    });

    it('should update schedule time and adjust EventBridge', async () => {
      const newScheduledAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'PUT',
        path: `/schedules/${createdScheduleId}`,
        pathParameters: {
          scheduleId: createdScheduleId,
        },
        body: JSON.stringify({
          scheduledAt: newScheduledAt,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.data.scheduledAt).toBe(newScheduledAt);
    });
  });

  describe('DELETE /schedules/{scheduleId} - Delete Schedule', () => {
    let createdScheduleId: string;

    beforeEach(async () => {
      // Create a test schedule
      const createEvent: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/schedules',
        body: JSON.stringify({
          brandId: testBrandId,
          contentId: testContentId,
          platform: 'instagram',
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const createResult = await scheduleHandler(event as APIGatewayProxyEvent);
      const body = JSON.parse(createResult.body);
      createdScheduleId = body.scheduleId;
    });

    it('should delete a schedule', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'DELETE',
        path: `/schedules/${createdScheduleId}`,
        pathParameters: {
          scheduleId: createdScheduleId,
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(204);
      expect(result.body).toBe('');
      
      // Verify schedule is deleted
      const getEvent: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: `/schedules/${createdScheduleId}`,
        pathParameters: {
          scheduleId: createdScheduleId,
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };
      
      const getResult = await scheduleHandler(getEvent as APIGatewayProxyEvent);
      expect(getResult.statusCode).toBe(404);
    });
  });

  describe('OPTIONS - CORS Preflight', () => {
    it('should handle CORS preflight requests', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'OPTIONS',
        path: '/schedules',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type,Authorization',
        },
        requestContext: {
          requestId: 'test-request-id',
        } as any,
      };

      const result = await scheduleHandler(event as APIGatewayProxyEvent);
      
      expect(result.statusCode).toBe(200);
      expect(result.headers).toBeDefined();
      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers!['Access-Control-Allow-Methods']).toContain('POST');
      expect(result.headers!['Access-Control-Allow-Headers']).toContain('Content-Type');
    });
  });
});