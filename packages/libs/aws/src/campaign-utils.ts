import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createServiceLogger } from './logger';
import { campaignConsistency } from './campaign-consistency';

const logger = createServiceLogger('campaign-utils');
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

function getSchedulesTableName(): string | undefined {
  const table = process.env.SCHEDULES_TABLE;
  if (!table) {
    logger.warn('Missing schedules table configuration', {
      variable: 'SCHEDULES_TABLE',
    });
  }
  return table;
}

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
  // ... other schedule fields
}

/**
 * Get campaign by content ID using the schedule's campaignId field
 */
export async function getCampaignByContentId(contentId: string): Promise<DynamoCampaign | null> {
  try {
    // Get the schedule record to find the campaignId
    const schedulesTable = getSchedulesTableName();
    if (!schedulesTable) {
      // Fail-open: cannot determine campaign without table; allow caller to proceed
      return null;
    }

    const scheduleResult = await docClient.send(
      new GetCommand({
        TableName: schedulesTable,
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
    logger.error('Failed to get campaign by content ID', {
      operation: 'getCampaignByContentId',
      error,
      contentId,
    });
    // On error, return null to allow operation (fail-open for availability)
    return null;
  }
}

/**
 * Get campaign by campaign ID from the dedicated campaigns table
 * Includes consistency validation for critical operations
 */
export async function getCampaignById(
  campaignId: string,
  validateConsistency: boolean = false
): Promise<DynamoCampaign | null> {
  try {
    const campaignsTable = getSchedulesTableName();
    if (!campaignsTable) {
      logger.warn('Missing schedules table configuration; skipping DynamoDB read', {
        operation: 'getCampaignById',
        campaignId,
      });
      return null;
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: campaignsTable,
        Key: {
          pk: `CAMPAIGN#${campaignId}`,
          sk: 'METADATA',
        },
      })
    );

    const dynamoCampaign = result?.Item as DynamoCampaign | null;

    // If consistency validation is requested and we have a campaign
    if (validateConsistency && dynamoCampaign) {
      try {
        const consistencyCheck = await campaignConsistency.checkConsistency(campaignId);

        if (!consistencyCheck.isConsistent) {
          logger.consistencyIssue('Campaign consistency mismatch detected', {
            campaignId,
            expected: consistencyCheck.conflict?.resolvedValue,
            actual: consistencyCheck.conflict?.dynamoValue,
            source: 'dynamodb_vs_postgresql',
          });

          // Auto-reconcile if possible
          const reconciliation = await campaignConsistency.reconcileCampaignState(campaignId);
          if (reconciliation.success) {
            logger.operationSuccess('auto-reconcile campaign state', {
              campaignId,
              action: reconciliation.action,
              details: reconciliation.details,
            });

            // Return the reconciled campaign
            if (reconciliation.action === 'sync_to_dynamo' && consistencyCheck.pgCampaign) {
              // Return updated campaign state based on PostgreSQL
              return await getCampaignById(campaignId, false); // Avoid infinite recursion
            }
          } else {
            logger.operationFailure('auto-reconcile campaign state', reconciliation.error, {
              campaignId,
            });
          }
        }
      } catch (consistencyError) {
        logger.error('Consistency check failed, continuing with DynamoDB data', {
          operation: 'consistency_check',
          error: consistencyError,
          campaignId,
        });
        // Continue with DynamoDB data if consistency check fails
      }
    }

    return dynamoCampaign;
  } catch (error) {
    logger.error('Failed to get campaign by ID', {
      operation: 'getCampaignById',
      error,
      campaignId,
    });
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

  const campaignsTable = getSchedulesTableName();
  if (!campaignsTable) {
    throw new Error('Schedules table not configured');
  }

  await docClient.send(
    new PutCommand({
      TableName: campaignsTable,
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
  const campaignsTable = getSchedulesTableName();
  if (!campaignsTable) {
    throw new Error('Schedules table not configured');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: campaignsTable,
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
