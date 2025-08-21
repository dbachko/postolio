/**
 * Configuration for the schedule management Lambda function
 * Centralizes all configuration including DynamoDB indexes
 */

export interface DynamoDBConfig {
  tableName: string;
  indexes: {
    brand: {
      name: string;
      partitionKey: string;
      sortKey: string;
    };
    status: {
      name: string;
      partitionKey: string;
      sortKey: string;
    };
  };
}

export function getDynamoDBConfig(): DynamoDBConfig {
  // Support both new and legacy index names during migration
  const isLegacyTable = !process.env.SCHEDULES_TABLE_BRAND_INDEX;
  
  return {
    tableName: process.env.SCHEDULES_TABLE!,
    indexes: {
      brand: {
        name: process.env.SCHEDULES_TABLE_BRAND_INDEX || 'GSI1',
        partitionKey: 'gsi1pk', // These remain the same for backward compatibility
        sortKey: 'gsi1sk',
      },
      status: {
        name: process.env.SCHEDULES_TABLE_STATUS_INDEX || 'GSI2',
        partitionKey: 'status',
        sortKey: 'scheduledAt',
      },
    },
  };
}

export const SCHEDULE_STATUS = {
  SCHEDULED: 'scheduled',
  PROCESSING: 'processing',
  PUBLISHED: 'published',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type ScheduleStatus = typeof SCHEDULE_STATUS[keyof typeof SCHEDULE_STATUS];