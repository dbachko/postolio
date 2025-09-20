import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface Campaign {
  id: string;
  status: 'creating' | 'preview' | 'active' | 'paused' | 'completed' | 'failed' | 'processing';
  brandId: string;
  name: string;
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Content {
  id: string;
  campaignId?: string;
  brandId: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  scheduledAt?: string;
  caption?: string;
  hashtags?: string[];
}

/**
 * Get campaign by content ID using the content's campaignId relationship
 * Note: Content might be stored as schedule in SCHEDULES_TABLE with pk: SCHEDULE#contentId
 */
export async function getCampaignByContentId(contentId: string): Promise<Campaign | null> {
  try {
    // Try to get schedule/content from SCHEDULES_TABLE first (most common case)
    const scheduleResult = await docClient.send(
      new GetCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `SCHEDULE#${contentId}`,
          sk: 'METADATA',
        },
      })
    );

    let campaignId: string | undefined;

    if (scheduleResult.Item?.campaignId) {
      campaignId = scheduleResult.Item.campaignId;
    } else {
      // Fallback: try content table if available
      try {
        const contentResult = await docClient.send(
          new GetCommand({
            TableName: process.env.CONTENT_TABLE || process.env.SCHEDULES_TABLE!,
            Key: {
              pk: `CONTENT#${contentId}`,
              sk: 'METADATA',
            },
          })
        );

        if (contentResult.Item?.campaignId) {
          campaignId = contentResult.Item.campaignId;
        }
      } catch {
        // Ignore fallback errors
      }
    }

    if (!campaignId) {
      // Content not associated with a campaign - allow operation
      return null;
    }

    // Get the campaign details
    return await getCampaignById(campaignId);
  } catch (error) {
    console.error('Failed to get campaign by content ID:', error);
    // On error, return null to allow operation (fail-open for availability)
    return null;
  }
}

/**
 * Get campaign by campaign ID directly
 * Note: Campaigns might be stored in a separate table or in the schedules table
 */
export async function getCampaignById(campaignId: string): Promise<Campaign | null> {
  try {
    // Try campaigns table first if it exists
    let result;

    if (process.env.CAMPAIGNS_TABLE) {
      result = await docClient.send(
        new GetCommand({
          TableName: process.env.CAMPAIGNS_TABLE,
          Key: {
            pk: `CAMPAIGN#${campaignId}`,
            sk: 'METADATA',
          },
        })
      );
    }

    // Fallback to schedules table if campaigns table doesn't exist or no result
    if (!result?.Item && process.env.SCHEDULES_TABLE) {
      result = await docClient.send(
        new GetCommand({
          TableName: process.env.SCHEDULES_TABLE,
          Key: {
            pk: `CAMPAIGN#${campaignId}`,
            sk: 'METADATA',
          },
        })
      );
    }

    return result?.Item as Campaign | null;
  } catch (error) {
    console.error('Failed to get campaign by ID:', error);
    // On error, return null to allow operation (fail-open for availability)
    return null;
  }
}

/**
 * Check if a campaign is active (can publish content)
 */
export function isCampaignActive(campaign: Campaign | null): boolean {
  if (!campaign) {
    // No campaign means standalone content - allow publishing
    return true;
  }

  return campaign.status === 'active';
}

/**
 * Check if a campaign allows scheduling operations
 */
export function canCampaignSchedule(campaign: Campaign | null): boolean {
  if (!campaign) {
    // No campaign means standalone content - allow scheduling
    return true;
  }

  // Allow scheduling for active campaigns and campaigns in preview (for initial setup)
  return campaign.status === 'active' || campaign.status === 'preview';
}

/**
 * Get the reason why a campaign cannot publish
 */
export function getCampaignBlockReason(campaign: Campaign | null): string | null {
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
    case 'creating':
      return 'Campaign is still being created';
    case 'processing':
      return 'Campaign is being processed';
    case 'active':
      return null; // No block
    case 'preview':
      return 'Campaign is in preview mode';
    default:
      return `Campaign status is ${campaign.status}`;
  }
}

/**
 * Get the reason why a campaign cannot be scheduled
 */
export function getCampaignScheduleBlockReason(campaign: Campaign | null): string | null {
  if (!campaign) {
    return null;
  }

  switch (campaign.status) {
    case 'paused':
      return 'Campaign is paused - scheduling updates skipped';
    case 'completed':
      return 'Campaign has completed';
    case 'failed':
      return 'Campaign has failed';
    case 'creating':
      return 'Campaign is still being created';
    case 'processing':
      return 'Campaign is being processed';
    case 'active':
    case 'preview':
      return null; // No block
    default:
      return `Campaign status is ${campaign.status}`;
  }
}