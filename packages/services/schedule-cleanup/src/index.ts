import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand,
  QueryCommand, 
  UpdateCommand, 
  DeleteCommand,
  BatchWriteCommand 
} from '@aws-sdk/lib-dynamodb';
import { 
  SchedulerClient, 
  DeleteScheduleCommand,
  ListSchedulesCommand 
} from '@aws-sdk/client-scheduler';

// Initialize Powertools
const logger = new Logger({ serviceName: 'schedule-cleanup' });
const tracer = new Tracer({ serviceName: 'schedule-cleanup' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'schedule-cleanup' });

interface CleanupResult {
  orphanedSchedules: number;
  orphanedEventBridgeRules: number;
  failedSchedules: number;
  errors: string[];
}

export const handler = async (): Promise<CleanupResult> => {
  logger.info('Starting schedule cleanup job');
  
  // Initialize AWS SDK clients inside handler for better Lambda performance
  const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
  const docClient = DynamoDBDocumentClient.from(dynamoClient);
  const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));
  
  const result: CleanupResult = {
    orphanedSchedules: 0,
    orphanedEventBridgeRules: 0,
    failedSchedules: 0,
    errors: [],
  };

  try {
    // 1. Find orphaned DynamoDB entries (failed status without brandId)
    await cleanupOrphanedDynamoDBEntries(result, docClient);
    
    // 2. Find EventBridge rules without matching DynamoDB entries
    await cleanupOrphanedEventBridgeRules(result, docClient, schedulerClient);
    
    // 3. Mark old failed schedules for deletion
    await cleanupOldFailedSchedules(result, docClient);
    
    // 4. Validate consistency of scheduled items
    await validateScheduledItems(result, docClient, schedulerClient);
    
  logger.info('Schedule cleanup completed', { result });
    
    // Publish metrics
    metrics.addMetric('OrphanedSchedulesCleaned', MetricUnit.Count, result.orphanedSchedules);
    metrics.addMetric('OrphanedEventBridgeRulesCleaned', MetricUnit.Count, result.orphanedEventBridgeRules);
    metrics.addMetric('FailedSchedulesCleaned', MetricUnit.Count, result.failedSchedules);
    
  } catch (error) {
    logger.error('Schedule cleanup job failed', error as Error);
    result.errors.push((error as Error).message);
    metrics.addMetric('CleanupJobFailed', MetricUnit.Count, 1);
  } finally {
    metrics.publishStoredMetrics();
  }
  
  return result;
};

async function cleanupOrphanedDynamoDBEntries(result: CleanupResult, docClient: DynamoDBDocumentClient): Promise<void> {
  logger.info('Cleaning up orphaned DynamoDB entries');
  
  try {
    // Scan for failed schedules without brandId
    const scanResult = await docClient.send(new ScanCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      FilterExpression: '#status = :failed AND attribute_not_exists(brandId)',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':failed': 'failed',
      },
    }));
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
      logger.info('No orphaned DynamoDB entries found');
      return;
    }
    
    logger.info(`Found ${scanResult.Items.length} orphaned entries to clean up`);
    
    // Delete orphaned entries in batches
    const deleteRequests = scanResult.Items.map(item => ({
      DeleteRequest: {
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      },
    }));
    
    // Process in batches of 25 (DynamoDB limit)
    for (let i = 0; i < deleteRequests.length; i += 25) {
      const batch = deleteRequests.slice(i, i + 25);
      
      await docClient.send(new BatchWriteCommand({
        RequestItems: {
          [process.env.SCHEDULES_TABLE!]: batch,
        },
      }));
      
      result.orphanedSchedules += batch.length;
      logger.info(`Deleted batch of ${batch.length} orphaned entries`);
    }
    
  } catch (error) {
    logger.error('Failed to cleanup orphaned DynamoDB entries', error as Error);
    result.errors.push(`DynamoDB cleanup: ${(error as Error).message}`);
  }
}

async function cleanupOrphanedEventBridgeRules(result: CleanupResult, docClient: DynamoDBDocumentClient, schedulerClient: SchedulerClient): Promise<void> {
  logger.info('Cleaning up orphaned EventBridge rules');
  
  try {
    // List all schedules from EventBridge
    const listResult = await schedulerClient.send(new ListSchedulesCommand({
      GroupName: process.env.SCHEDULER_GROUP_NAME,
      MaxResults: 100, // Process in batches
    }));
    
    if (!listResult.Schedules || listResult.Schedules.length === 0) {
      logger.info('No EventBridge schedules found');
      return;
    }
    
    // Check each EventBridge schedule against DynamoDB
    for (const schedule of listResult.Schedules) {
      if (!schedule.Name) continue;
      
      // Extract schedule ID from the name (format: schedule-SCH_xxx)
      const scheduleId = schedule.Name.replace('schedule-', '');
      
      // Check if corresponding DynamoDB entry exists using Query on GSI
      const dynamoResult = await docClient.send(new QueryCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        IndexName: process.env.SCHEDULES_TABLE_SCHEDULE_INDEX || 'GSI-ScheduleId',
        KeyConditionExpression: 'scheduleId = :scheduleId',
        ExpressionAttributeValues: {
          ':scheduleId': scheduleId,
        },
        Limit: 1,
      }));
      
      // If no DynamoDB entry exists, delete the EventBridge rule
      if (!dynamoResult.Items || dynamoResult.Items.length === 0) {
        logger.info(`Found orphaned EventBridge rule: ${schedule.Name}`);
        
        try {
          await schedulerClient.send(new DeleteScheduleCommand({
            Name: schedule.Name,
            GroupName: process.env.SCHEDULER_GROUP_NAME,
          }));
          
          result.orphanedEventBridgeRules++;
          logger.info(`Deleted orphaned EventBridge rule: ${schedule.Name}`);
          } catch {
          logger.error(`Failed to delete EventBridge rule: ${schedule.Name}`);
          result.errors.push(`EventBridge deletion: ${schedule.Name}`);
        }
      }
    }
    
  } catch (error) {
    logger.error('Failed to cleanup orphaned EventBridge rules', error as Error);
    result.errors.push(`EventBridge cleanup: ${(error as Error).message}`);
  }
}

async function cleanupOldFailedSchedules(result: CleanupResult, docClient: DynamoDBDocumentClient): Promise<void> {
  logger.info('Cleaning up old failed schedules');
  
  try {
    // Calculate cutoff date (30 days ago)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    const cutoffTimestamp = cutoffDate.toISOString();
    
    // Scan for old failed schedules
    const scanResult = await docClient.send(new ScanCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      FilterExpression: '#status = :failed AND createdAt < :cutoff',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':cutoff': cutoffTimestamp,
      },
    }));
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
      logger.info('No old failed schedules found');
      return;
    }
    
    logger.info(`Found ${scanResult.Items.length} old failed schedules to clean up`);
    
    // Delete old failed schedules
    for (const item of scanResult.Items) {
      await docClient.send(new DeleteCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      }));
      
      result.failedSchedules++;
    }
    
  } catch (error) {
    logger.error('Failed to cleanup old failed schedules', error as Error);
    result.errors.push(`Failed schedule cleanup: ${(error as Error).message}`);
  }
}

async function validateScheduledItems(result: CleanupResult, docClient: DynamoDBDocumentClient, schedulerClient: SchedulerClient): Promise<void> {
  logger.info('Validating scheduled items consistency');
  
  try {
    // Scan for scheduled items
    const scanResult = await docClient.send(new ScanCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      FilterExpression: '#status = :scheduled',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':scheduled': 'scheduled',
      },
    }));
    
    if (!scanResult.Items || scanResult.Items.length === 0) {
      logger.info('No scheduled items to validate');
      return;
    }
    
    // Validate each scheduled item
    for (const item of scanResult.Items) {
      // Check if required fields are present
      if (!item.brandId || !item.userId || !item.contentId) {
        logger.warn('Found scheduled item with missing required fields', {
          scheduleId: item.scheduleId,
          missingBrandId: !item.brandId,
          missingUserId: !item.userId,
          missingContentId: !item.contentId,
        });
        
        // Mark as failed if missing critical fields
        await docClient.send(new UpdateCommand({
          TableName: process.env.SCHEDULES_TABLE!,
          Key: {
            pk: item.pk,
            sk: item.sk,
          },
          UpdateExpression: 'SET #status = :failed, schedulingError = :error, updatedAt = :now',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':error': 'Missing required fields detected during cleanup',
            ':now': new Date().toISOString(),
          },
        }));
        
        // Try to clean up associated EventBridge rule if it exists
        if (item.scheduleId) {
          try {
            await schedulerClient.send(new DeleteScheduleCommand({
              Name: `schedule-${item.scheduleId}`,
              GroupName: process.env.SCHEDULER_GROUP_NAME,
            }));
            logger.info(`Deleted EventBridge rule for invalid schedule: ${item.scheduleId}`);
          } catch {
            // Rule might not exist, which is fine
            logger.debug(`EventBridge rule might not exist for: ${item.scheduleId}`);
          }
        }
      }
    }
    
  } catch (error) {
    logger.error('Failed to validate scheduled items', error as Error);
    result.errors.push(`Validation: ${(error as Error).message}`);
  }
}
