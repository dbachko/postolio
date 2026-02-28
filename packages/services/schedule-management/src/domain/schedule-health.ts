import { CreateScheduleCommand, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import {
  docClient,
  getSchedulerEventBusTargetConfig,
  scheduleLogger,
  schedulerClient,
} from './schedule-context';

type ScheduleConfig = {
  schedulesTable: string;
};

export async function healthCheckOperation(
  config: ScheduleConfig
): Promise<{ healthy: boolean; details: string }> {
  try {
    await probeDynamoDB(config);
    await probeScheduler();

    return {
      healthy: true,
      details: 'All schedule service components are healthy',
    };
  } catch (error) {
    scheduleLogger.error('Schedule service health check failed', { error });

    return {
      healthy: false,
      details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function probeDynamoDB(config: ScheduleConfig): Promise<void> {
  await docClient.send(
    new GetCommand({
      TableName: config.schedulesTable,
      Key: { pk: 'HEALTH_CHECK', sk: 'TEST' },
    })
  );
}

async function probeScheduler(): Promise<void> {
  const targetCfg = await getSchedulerEventBusTargetConfig();

  await schedulerClient.send(
    new CreateScheduleCommand({
      Name: 'health-check-test',
      GroupName: targetCfg.groupName,
      ScheduleExpression: 'at(2030-01-01T00:00:00)',
      Target: {
        Arn: targetCfg.eventBusArn,
        RoleArn: targetCfg.roleArn,
        Input: JSON.stringify({ test: true }),
        EventBridgeParameters: { DetailType: 'schedule.due', Source: 'postolio.scheduling' },
      },
      FlexibleTimeWindow: { Mode: 'OFF' },
    })
  );

  await schedulerClient.send(
    new DeleteScheduleCommand({
      Name: 'health-check-test',
      GroupName: targetCfg.groupName,
    })
  );
}
