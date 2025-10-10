import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { BrandAnalysisCompletedDetail, BrandAnalysisFailedDetail } from './types';

const busName = process.env.EVENT_BUS_NAME || 'default';
const eventBridge = new EventBridge({});

export async function publishCompleted(detail: BrandAnalysisCompletedDetail) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          DetailType: 'brand.analysis.completed',
          Source: 'postolio.brand',
          EventBusName: busName,
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );
}

export async function publishFailed(detail: BrandAnalysisFailedDetail) {
  await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          DetailType: 'brand.analysis.failed',
          Source: 'postolio.brand',
          EventBusName: busName,
          Detail: JSON.stringify(detail),
        },
      ],
    })
  );
}
