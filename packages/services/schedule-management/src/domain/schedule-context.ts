import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SchedulerClient } from '@aws-sdk/client-scheduler';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

export const scheduleLogger = new Logger({ serviceName: 'schedule-service' });

const tracer = new Tracer({ serviceName: 'schedule-service' });

export const scheduleMetrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'schedule-service',
});

const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
export const docClient = DynamoDBDocumentClient.from(dynamoClient);
export const schedulerClient = tracer.captureAWSv3Client(new SchedulerClient({}));
export const eventBridgeClient = tracer.captureAWSv3Client(new EventBridgeClient({}));

export interface SchedulerEventBusTargetConfig {
  roleArn: string;
  eventBusArn: string;
  groupName: string;
}

export async function getSchedulerEventBusTargetConfig(): Promise<SchedulerEventBusTargetConfig> {
  const groupName = process.env.SCHEDULER_GROUP_NAME || 'default';
  const roleArn = process.env.SCHEDULER_EVENTS_ROLE_ARN;
  const eventBusArn = process.env.SCHEDULING_EVENT_BUS_ARN;

  if (!roleArn || !eventBusArn) {
    throw new Error('Missing scheduler event bus configuration (roleArn or eventBusArn)');
  }

  return { roleArn, eventBusArn, groupName };
}

export function getEventBusName(): string {
  return process.env.EVENT_BUS_NAME || 'default';
}
