import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface DynamoCampaign {
  pk: string; // CAMPAIGN#{campaignId}
  sk: string; // METADATA
  campaignId: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  brandId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Schedule {
  pk: string; // SCHEDULE#{contentId}
  sk: string; // METADATA
  scheduleId: string;
  contentId: string;
  campaignId?: string; // Link to campaign
  brandId: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  scheduledAt?: string;
  caption?: string;
  hashtags?: string[];
  // ... other schedule fields
}

/**
 * Get campaign by content ID using the schedule's campaignId field
 */
export async function getCampaignByContentId(contentId: string): Promise<DynamoCampaign | null> {
  try {
    // Get the schedule record to find the campaignId
    const scheduleResult = await docClient.send(
      new GetCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `SCHEDULE#${contentId}`,
          sk: 'METADATA',
        },
      })
    );

    const schedule = scheduleResult.Item as Schedule | undefined;
    if (!schedule?.campaignId) {
      // Content not associated with a campaign - allow operation
      return null;
    }

    // Get the campaign details from campaigns table
    return await getCampaignById(schedule.campaignId);
  } catch (error) {
    console.error('Failed to get campaign by content ID:', error);
    // On error, return null to allow operation (fail-open for availability)
    return null;
  }
}

/**
 * Get campaign by campaign ID from the dedicated campaigns table
 */
export async function getCampaignById(campaignId: string): Promise<DynamoCampaign | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.CAMPAIGNS_TABLE || process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `CAMPAIGN#${campaignId}`,
          sk: 'METADATA',
        },
      })
    );

    return result?.Item as DynamoCampaign | null;
  } catch (error) {
    console.error('Failed to get campaign by ID:', error);
    // On error, return null to allow operation (fail-open for availability)
    return null;
  }
}

/**
 * Check if a campaign is active (can publish content)
 */
export function isCampaignActive(campaign: DynamoCampaign | null): boolean {
  if (!campaign) {
    // No campaign means standalone content - allow publishing
    return true;
  }

  return campaign.status === 'active';
}

/**
 * Check if a campaign allows scheduling operations
 */
export function canCampaignSchedule(campaign: DynamoCampaign | null): boolean {
  if (!campaign) {
    // No campaign means standalone content - allow scheduling
    return true;
  }

  // Only active campaigns can be scheduled (simplified from previous logic)
  return campaign.status === 'active';
}

/**
 * Get the reason why a campaign cannot publish
 */
export function getCampaignBlockReason(campaign: DynamoCampaign | null): string | null {
  if (!campaign) {
    return null;
  }

  switch (campaign.status) {
    case 'paused':
      return 'Campaign is paused';
    case 'completed':
      return 'Campaign has completed';
    case 'failed':
      return 'Campaign has failed';
    case 'active':
      return null; // No block
    default:
      return `Campaign status is ${campaign.status}`;
  }
}

/**
 * Get the reason why a campaign cannot be scheduled
 */
export function getCampaignScheduleBlockReason(campaign: DynamoCampaign | null): string | null {
  if (!campaign) {
    return null;
  }

  switch (campaign.status) {
    case 'paused':
      return 'Campaign is paused - scheduling updates blocked';
    case 'completed':
      return 'Campaign has completed';
    case 'failed':
      return 'Campaign has failed';
    case 'active':
      return null; // No block
    default:
      return `Campaign status is ${campaign.status}`;
  }
}

/**
 * Create a new campaign record in DynamoDB
 */
export async function createCampaign(
  campaignId: string,
  brandId: string,
  status: DynamoCampaign['status'] = 'active'
): Promise<DynamoCampaign> {
  const now = new Date().toISOString();
  const campaign: DynamoCampaign = {
    pk: `CAMPAIGN#${campaignId}`,
    sk: 'METADATA',
    campaignId,
    status,
    brandId,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: process.env.CAMPAIGNS_TABLE || process.env.SCHEDULES_TABLE!,
      Item: campaign,
    })
  );

  return campaign;
}

/**
 * Update campaign status in DynamoDB
 */
export async function updateCampaignStatus(
  campaignId: string,
  status: DynamoCampaign['status']
): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: process.env.CAMPAIGNS_TABLE || process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `CAMPAIGN#${campaignId}`,
        sk: 'METADATA',
      },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':updatedAt': new Date().toISOString(),
      },
    })
  );
}
