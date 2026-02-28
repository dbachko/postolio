import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { scheduleLogger, docClient } from './schedule-context';
import type { ListSchedulesResult, Schedule, ScheduleResult } from '../types/schedule';

type ScheduleConfig = {
  schedulesTable: string;
  indexes: {
    brand: { name?: string };
    status: { name?: string };
    schedule: { name?: string };
  };
};

export async function getScheduleById(
  config: ScheduleConfig,
  scheduleId: string
): Promise<ScheduleResult> {
  try {
    const result = await docClient.send(
      new QueryCommand({
        TableName: config.schedulesTable,
        IndexName: config.indexes.schedule.name,
        KeyConditionExpression: 'scheduleId = :scheduleId',
        ExpressionAttributeValues: {
          ':scheduleId': scheduleId,
        },
      })
    );

    return {
      success: true,
      schedule: (result.Items || [])[0] as Schedule | undefined,
    };
  } catch (error) {
    scheduleLogger.error('Failed to get schedule', { error, scheduleId });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function listSchedules(
  config: ScheduleConfig,
  queryParams: Record<string, string>
): Promise<ListSchedulesResult> {
  try {
    const command = buildListCommand(config, queryParams);
    const result = await docClient.send(command);

    return {
      success: true,
      schedules: (result.Items || []) as Schedule[],
      pagination: {
        nextToken: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : undefined,
        hasMore: !!result.LastEvaluatedKey,
      },
    };
  } catch (error) {
    scheduleLogger.error('Failed to list schedules', { error, queryParams });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

function buildListCommand(
  config: ScheduleConfig,
  queryParams: Record<string, string>
): QueryCommand {
  const { brandId, status, limit = '20', nextToken } = queryParams;
  const parsedLimit = parseInt(limit, 10);
  const exclusiveStartKey = nextToken ? JSON.parse(nextToken) : undefined;

  if (brandId) {
    if (!config.indexes.brand.name) {
      throw new Error('Brand index not configured');
    }

    return new QueryCommand({
      TableName: config.schedulesTable,
      IndexName: config.indexes.brand.name,
      KeyConditionExpression: 'gsi1pk = :brandKey',
      ExpressionAttributeValues: {
        ':brandKey': `BRAND#${brandId}`,
      },
      Limit: parsedLimit,
      ExclusiveStartKey: exclusiveStartKey,
    });
  }

  if (status) {
    if (!config.indexes.status.name) {
      throw new Error('Status index not configured');
    }

    return new QueryCommand({
      TableName: config.schedulesTable,
      IndexName: config.indexes.status.name,
      KeyConditionExpression: 'status = :status',
      ExpressionAttributeValues: {
        ':status': status,
      },
      Limit: parsedLimit,
      ExclusiveStartKey: exclusiveStartKey,
    });
  }

  return new QueryCommand({
    TableName: config.schedulesTable,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': 'SCHEDULE#',
    },
    Limit: parsedLimit,
    ExclusiveStartKey: exclusiveStartKey,
  });
}
