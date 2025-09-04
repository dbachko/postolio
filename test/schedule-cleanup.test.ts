import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDocumentClient, ScanCommand, DeleteCommand, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SchedulerClient, ListSchedulesCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { handler } from '../aws-infrastructure/lib/lambda/schedule-cleanup/index';
import { EventBridgeEvent } from 'aws-lambda';

// Mock AWS SDK clients
vi.mock('@aws-sdk/lib-dynamodb');
vi.mock('@aws-sdk/client-scheduler');
vi.mock('@aws-lambda-powertools/logger');
vi.mock('@aws-lambda-powertools/tracer');
vi.mock('@aws-lambda-powertools/metrics');

describe('Schedule Cleanup Lambda', () => {
  let mockDocClient: any;
  let mockSchedulerClient: any;
  
  beforeEach(() => {
    // Setup environment variables
    process.env.SCHEDULES_TABLE = 'test-schedules-table';
    process.env.SCHEDULER_GROUP_NAME = 'test-scheduler-group';
    
    // Mock DynamoDB client
    mockDocClient = {
      send: vi.fn(),
    };
    
    // Mock Scheduler client
    mockSchedulerClient = {
      send: vi.fn(),
    };
    
    // Mock the client constructors
    vi.mocked(DynamoDBDocumentClient).from = vi.fn().mockReturnValue(mockDocClient);
    vi.mocked(SchedulerClient).mockImplementation(() => mockSchedulerClient);
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });
  
  describe('Orphaned DynamoDB Entries Cleanup', () => {
    it('should delete orphaned entries without brandId', async () => {
      // Mock scan to find orphaned entries
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          return Promise.resolve({
            Items: [
              { pk: 'SCHEDULE#SCH_123', sk: 'METADATA', status: 'failed' },
              { pk: 'SCHEDULE#SCH_456', sk: 'METADATA', status: 'failed' },
            ],
          });
        }
        if (command instanceof BatchWriteCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      expect(result.orphanedSchedules).toBe(2);
      expect(result.errors).toHaveLength(0);
      
      // Verify BatchWrite was called to delete orphaned entries
      const batchWriteCalls = mockDocClient.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof BatchWriteCommand
      );
      expect(batchWriteCalls).toHaveLength(1);
    });
    
    it('should handle errors gracefully', async () => {
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          return Promise.reject(new Error('DynamoDB error'));
        }
        return Promise.resolve({});
      });
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      expect(result.orphanedSchedules).toBe(0);
      expect(result.errors).toContain('DynamoDB cleanup: DynamoDB error');
    });
  });
  
  describe('Orphaned EventBridge Rules Cleanup', () => {
    it('should delete EventBridge rules without matching DynamoDB entries', async () => {
      // Mock ListSchedules to return orphaned rules
      mockSchedulerClient.send.mockImplementation((command: any) => {
        if (command instanceof ListSchedulesCommand) {
          return Promise.resolve({
            Schedules: [
              { Name: 'schedule-SCH_789' },
              { Name: 'schedule-SCH_101112' },
            ],
          });
        }
        if (command instanceof DeleteScheduleCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Mock DynamoDB scan to return no matching entries
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          // Return empty for both orphaned checks and schedule lookups
          return Promise.resolve({ Items: [] });
        }
        return Promise.resolve({});
      });
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      expect(result.orphanedEventBridgeRules).toBe(2);
      
      // Verify DeleteSchedule was called for each orphaned rule
      const deleteScheduleCalls = mockSchedulerClient.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof DeleteScheduleCommand
      );
      expect(deleteScheduleCalls).toHaveLength(2);
    });
  });
  
  describe('Old Failed Schedules Cleanup', () => {
    it('should delete failed schedules older than 30 days', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31);
      
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          // Check if this is the old failed schedules scan
          const filterExpression = command.input.FilterExpression;
          if (filterExpression && filterExpression.includes('createdAt')) {
            return Promise.resolve({
              Items: [
                { 
                  pk: 'SCHEDULE#SCH_OLD1', 
                  sk: 'METADATA', 
                  status: 'failed',
                  createdAt: oldDate.toISOString(),
                },
              ],
            });
          }
          // Return empty for other scans
          return Promise.resolve({ Items: [] });
        }
        if (command instanceof DeleteCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Mock empty EventBridge schedules
      mockSchedulerClient.send.mockImplementation(() => 
        Promise.resolve({ Schedules: [] })
      );
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      expect(result.failedSchedules).toBe(1);
      
      // Verify Delete was called for old failed schedule
      const deleteCalls = mockDocClient.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof DeleteCommand
      );
      expect(deleteCalls).toHaveLength(1);
    });
  });
  
  describe('Scheduled Items Validation', () => {
    it('should mark schedules with missing required fields as failed', async () => {
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          const filterExpression = command.input.FilterExpression;
          if (filterExpression && filterExpression.includes('#status = :scheduled')) {
            return Promise.resolve({
              Items: [
                { 
                  pk: 'SCHEDULE#SCH_INVALID', 
                  sk: 'METADATA',
                  scheduleId: 'SCH_INVALID',
                  status: 'scheduled',
                  // Missing brandId and userId
                  contentId: 'content123',
                },
              ],
            });
          }
          return Promise.resolve({ Items: [] });
        }
        if (command instanceof UpdateCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      // Mock EventBridge delete for cleanup
      mockSchedulerClient.send.mockImplementation((command: any) => {
        if (command instanceof ListSchedulesCommand) {
          return Promise.resolve({ Schedules: [] });
        }
        if (command instanceof DeleteScheduleCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      // Verify Update was called to mark schedule as failed
      const updateCalls = mockDocClient.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof UpdateCommand
      );
      expect(updateCalls).toHaveLength(1);
      
      // Verify the update sets status to failed
      const updateCommand = updateCalls[0][0];
      expect(updateCommand.input.UpdateExpression).toContain('SET #status = :failed');
      
      // Verify EventBridge rule deletion was attempted
      const deleteScheduleCalls = mockSchedulerClient.send.mock.calls.filter(
        (call: any[]) => call[0] instanceof DeleteScheduleCommand
      );
      expect(deleteScheduleCalls).toHaveLength(1);
    });
  });
  
  describe('Complete Cleanup Flow', () => {
    it('should execute all cleanup tasks and return summary', async () => {
      // Setup mocks for a comprehensive cleanup run
      let scanCallCount = 0;
      mockDocClient.send.mockImplementation((command: any) => {
        if (command instanceof ScanCommand) {
          scanCallCount++;
          // Return different results for different scans
          if (scanCallCount === 1) {
            // Orphaned entries scan
            return Promise.resolve({
              Items: [{ pk: 'SCHEDULE#SCH_ORPHAN', sk: 'METADATA', status: 'failed' }],
            });
          } else if (scanCallCount === 3) {
            // Old failed schedules scan  
            const oldDate = new Date();
            oldDate.setDate(oldDate.getDate() - 31);
            return Promise.resolve({
              Items: [{ 
                pk: 'SCHEDULE#SCH_OLD', 
                sk: 'METADATA', 
                status: 'failed',
                createdAt: oldDate.toISOString(),
              }],
            });
          } else if (scanCallCount === 4) {
            // Scheduled items validation scan
            return Promise.resolve({
              Items: [{ 
                pk: 'SCHEDULE#SCH_VALID', 
                sk: 'METADATA',
                status: 'scheduled',
                brandId: 'brand123',
                userId: 'user123',
                contentId: 'content123',
              }],
            });
          }
          return Promise.resolve({ Items: [] });
        }
        if (command instanceof BatchWriteCommand || 
            command instanceof DeleteCommand ||
            command instanceof UpdateCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      mockSchedulerClient.send.mockImplementation((command: any) => {
        if (command instanceof ListSchedulesCommand) {
          return Promise.resolve({
            Schedules: [{ Name: 'schedule-SCH_ORPHAN_EB' }],
          });
        }
        if (command instanceof DeleteScheduleCommand) {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });
      
      const event: EventBridgeEvent<'Scheduled Event', any> = {
        version: '0',
        id: 'test-event-id',
        'detail-type': 'Scheduled Event',
        source: 'aws.events',
        account: '123456789',
        time: new Date().toISOString(),
        region: 'us-east-1',
        resources: [],
        detail: {},
      };
      
      const result = await handler(event);
      
      // Verify all cleanup operations were executed
      expect(result.orphanedSchedules).toBeGreaterThanOrEqual(1);
      expect(result.orphanedEventBridgeRules).toBeGreaterThanOrEqual(1);
      expect(result.failedSchedules).toBeGreaterThanOrEqual(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});