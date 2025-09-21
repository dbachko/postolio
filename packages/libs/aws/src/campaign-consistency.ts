/**
 * Campaign Consistency Handler
 *
 * Ensures PostgreSQL (source of truth) and DynamoDB (microservices cache)
 * remain consistent for campaign state management.
 *
 * Implements eventual consistency with conflict resolution and reconciliation.
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { PrismaClient, Campaign as PrismaCampaign, CampaignStatus } from '@postolio/database';
import { getCampaignById, type DynamoCampaign } from './campaign-utils';

const logger = new Logger({ serviceName: 'campaign-consistency' });
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const eventBridge = new EventBridge({});

export interface ConsistencyCheckResult {
  isConsistent: boolean;
  pgCampaign: PrismaCampaign | null;
  dynamoCampaign: DynamoCampaign | null;
  conflict?: {
    field: string;
    pgValue: unknown;
    dynamoValue: unknown;
    resolvedValue: unknown;
  };
}

export interface ReconciliationResult {
  success: boolean;
  action: 'sync_to_dynamo' | 'sync_to_pg' | 'no_action' | 'manual_review';
  details: string;
  error?: string;
}

export class CampaignConsistencyHandler {
  private prisma: PrismaClient | null = null;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || null;
  }

  /**
   * Initialize Prisma client if not provided in constructor
   */
  private async getPrismaClient(): Promise<PrismaClient> {
    if (!this.prisma) {
      this.prisma = new PrismaClient({
        log: process.env.LOG_LEVEL === 'DEBUG' ? ['query'] : [],
      });
    }
    return this.prisma;
  }

  /**
   * Check consistency between PostgreSQL and DynamoDB for a campaign
   */
  async checkConsistency(campaignId: string): Promise<ConsistencyCheckResult> {
    logger.info('Checking campaign consistency', { campaignId });

    try {
      const [pgCampaign, dynamoCampaign] = await Promise.all([
        this.getCampaignFromPostgreSQL(campaignId),
        getCampaignById(campaignId),
      ]);

      // If either is missing, there's an inconsistency
      if (!pgCampaign && !dynamoCampaign) {
        return {
          isConsistent: true, // Both missing is consistent
          pgCampaign: null,
          dynamoCampaign: null,
        };
      }

      if (!pgCampaign || !dynamoCampaign) {
        return {
          isConsistent: false,
          pgCampaign,
          dynamoCampaign,
        };
      }

      // Check status consistency (most critical field)
      const pgStatus = this.mapPrismaStatusToDynamo(pgCampaign.status);
      if (pgStatus !== dynamoCampaign.status) {
        return {
          isConsistent: false,
          pgCampaign,
          dynamoCampaign,
          conflict: {
            field: 'status',
            pgValue: pgStatus,
            dynamoValue: dynamoCampaign.status,
            resolvedValue: pgStatus, // PostgreSQL is source of truth
          },
        };
      }

      // Check other critical fields
      if (pgCampaign.brandId !== dynamoCampaign.brandId) {
        return {
          isConsistent: false,
          pgCampaign,
          dynamoCampaign,
          conflict: {
            field: 'brandId',
            pgValue: pgCampaign.brandId,
            dynamoValue: dynamoCampaign.brandId,
            resolvedValue: pgCampaign.brandId, // PostgreSQL is source of truth
          },
        };
      }

      logger.info('Campaign consistency check passed', { campaignId });
      return {
        isConsistent: true,
        pgCampaign,
        dynamoCampaign,
      };
    } catch (error) {
      logger.error('Failed to check campaign consistency', { error, campaignId });
      throw error;
    }
  }

  /**
   * Reconcile campaign state between PostgreSQL and DynamoDB
   * PostgreSQL is always the source of truth
   */
  async reconcileCampaignState(campaignId: string): Promise<ReconciliationResult> {
    logger.info('Starting campaign reconciliation', { campaignId });

    try {
      const consistencyCheck = await this.checkConsistency(campaignId);

      if (consistencyCheck.isConsistent) {
        return {
          success: true,
          action: 'no_action',
          details: 'Campaign state is already consistent',
        };
      }

      const { pgCampaign, dynamoCampaign } = consistencyCheck;

      // Case 1: Campaign exists in PostgreSQL but not DynamoDB
      if (pgCampaign && !dynamoCampaign) {
        await this.syncCampaignToDynamoDB(pgCampaign);
        return {
          success: true,
          action: 'sync_to_dynamo',
          details: 'Created missing campaign record in DynamoDB',
        };
      }

      // Case 2: Campaign exists in DynamoDB but not PostgreSQL
      if (!pgCampaign && dynamoCampaign) {
        // This is unusual - DynamoDB should not have campaigns that don't exist in PostgreSQL
        logger.warn('Campaign exists in DynamoDB but not PostgreSQL - manual review required', {
          campaignId,
          dynamoCampaign,
        });
        return {
          success: false,
          action: 'manual_review',
          details:
            'Campaign exists in DynamoDB but not in PostgreSQL - requires manual investigation',
        };
      }

      // Case 3: Both exist but have conflicts
      if (pgCampaign && dynamoCampaign && consistencyCheck.conflict) {
        await this.syncCampaignToDynamoDB(pgCampaign);

        // Emit reconciliation event for audit purposes
        await this.emitReconciliationEvent(campaignId, consistencyCheck.conflict);

        return {
          success: true,
          action: 'sync_to_dynamo',
          details: `Resolved conflict in ${consistencyCheck.conflict.field}: ${consistencyCheck.conflict.dynamoValue} → ${consistencyCheck.conflict.resolvedValue}`,
        };
      }

      return {
        success: false,
        action: 'manual_review',
        details: 'Unexpected inconsistency state - requires manual review',
      };
    } catch (error) {
      logger.error('Failed to reconcile campaign state', { error, campaignId });
      return {
        success: false,
        action: 'manual_review',
        details: `Reconciliation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Sync campaign from PostgreSQL to DynamoDB
   */
  private async syncCampaignToDynamoDB(pgCampaign: PrismaCampaign): Promise<void> {
    const dynamoCampaign: DynamoCampaign = {
      pk: `CAMPAIGN#${pgCampaign.id}`,
      sk: 'METADATA',
      campaignId: pgCampaign.id,
      status: this.mapPrismaStatusToDynamo(pgCampaign.status),
      brandId: pgCampaign.brandId,
      createdAt: pgCampaign.createdAt.toISOString(),
      updatedAt: pgCampaign.updatedAt.toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: process.env.CAMPAIGNS_TABLE || process.env.SCHEDULES_TABLE!,
        Item: dynamoCampaign,
      })
    );

    logger.info('Synced campaign to DynamoDB', {
      campaignId: pgCampaign.id,
      status: dynamoCampaign.status,
    });
  }

  /**
   * Get campaign from PostgreSQL
   */
  private async getCampaignFromPostgreSQL(campaignId: string): Promise<PrismaCampaign | null> {
    const prisma = await this.getPrismaClient();

    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
      });
      return campaign;
    } catch (error) {
      logger.error('Failed to get campaign from PostgreSQL', { error, campaignId });
      throw error;
    }
  }

  /**
   * Map Prisma campaign status to DynamoDB status
   */
  private mapPrismaStatusToDynamo(status: CampaignStatus): DynamoCampaign['status'] {
    const statusMap: Record<CampaignStatus, DynamoCampaign['status']> = {
      creating: 'paused', // Creating campaigns should not publish
      preview: 'paused', // Preview campaigns should not publish
      active: 'active',
      paused: 'paused',
      completed: 'completed',
      failed: 'failed',
      processing: 'paused', // Processing campaigns should not publish
    };

    return statusMap[status] || 'paused'; // Default to paused for safety
  }

  /**
   * Emit reconciliation event for audit and monitoring
   */
  private async emitReconciliationEvent(
    campaignId: string,
    conflict: NonNullable<ConsistencyCheckResult['conflict']>
  ): Promise<void> {
    try {
      await eventBridge.send(
        new PutEventsCommand({
          Entries: [
            {
              Source: 'postolio.consistency',
              DetailType: 'campaign.reconciled',
              Detail: JSON.stringify({
                campaignId,
                conflict,
                reconciledAt: new Date().toISOString(),
                resolvedBy: 'campaign-consistency-handler',
              }),
            },
          ],
        })
      );

      logger.info('Emitted campaign reconciliation event', { campaignId, conflict });
    } catch (error) {
      logger.warn('Failed to emit reconciliation event', { error, campaignId });
      // Don't fail the reconciliation if event emission fails
    }
  }

  /**
   * Batch consistency check for multiple campaigns
   */
  async batchCheckConsistency(campaignIds: string[]): Promise<Map<string, ConsistencyCheckResult>> {
    logger.info('Starting batch consistency check', { campaignCount: campaignIds.length });

    const results = new Map<string, ConsistencyCheckResult>();
    const batchSize = 10; // Process in batches to avoid overwhelming the database

    for (let i = 0; i < campaignIds.length; i += batchSize) {
      const batch = campaignIds.slice(i, i + batchSize);

      const batchPromises = batch.map(async (campaignId) => {
        try {
          const result = await this.checkConsistency(campaignId);
          return { campaignId, result };
        } catch (error) {
          logger.error('Failed to check consistency for campaign in batch', { error, campaignId });
          return {
            campaignId,
            result: {
              isConsistent: false,
              pgCampaign: null,
              dynamoCampaign: null,
            } as ConsistencyCheckResult,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(({ campaignId, result }) => {
        results.set(campaignId, result);
      });

      // Small delay between batches to avoid overwhelming the database
      if (i + batchSize < campaignIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    logger.info('Completed batch consistency check', {
      total: campaignIds.length,
      consistent: Array.from(results.values()).filter((r) => r.isConsistent).length,
      inconsistent: Array.from(results.values()).filter((r) => !r.isConsistent).length,
    });

    return results;
  }

  /**
   * Health check for consistency system
   */
  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Test database connections
      const prisma = await this.getPrismaClient();
      await prisma.$queryRaw`SELECT 1`;

      // Test DynamoDB connection
      await docClient.send(
        new GetCommand({
          TableName: process.env.CAMPAIGNS_TABLE || process.env.SCHEDULES_TABLE!,
          Key: { pk: 'HEALTH_CHECK', sk: 'TEST' },
        })
      );

      return {
        healthy: true,
        details: 'All consistency system components are healthy',
      };
    } catch (error) {
      logger.error('Consistency system health check failed', { error });
      return {
        healthy: false,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }
  }
}

// Export singleton instance for easy usage
export const campaignConsistency = new CampaignConsistencyHandler();
