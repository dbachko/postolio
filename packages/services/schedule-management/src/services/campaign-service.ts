/**
 * Campaign Service
 *
 * Core business logic for campaign management operations in DynamoDB
 * Handles campaign CRUD operations and status synchronization
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import {
  createCampaign,
  updateCampaignStatus,
  getCampaignById,
  type DynamoCampaign,
} from '@postolio/aws';

const logger = new Logger({ serviceName: 'campaign-service' });
const metrics = new Metrics({
  namespace: 'ContentScheduler',
  serviceName: 'campaign-service',
});

export interface CampaignRequest {
  campaignId: string;
  brandId: string;
  status: DynamoCampaign['status'];
}

export interface CampaignResult {
  success: boolean;
  campaign?: DynamoCampaign;
  error?: string;
}

export interface ListCampaignsResult {
  success: boolean;
  campaigns?: DynamoCampaign[];
  pagination?: {
    nextToken?: string;
    hasMore: boolean;
  };
  error?: string;
}

export class CampaignService {
  /**
   * Create a new campaign record in DynamoDB
   */
  async createCampaign(request: CampaignRequest): Promise<CampaignResult> {
    logger.info('Creating campaign record', {
      campaignId: request.campaignId,
      brandId: request.brandId,
      status: request.status,
    });

    try {
      const campaign = await createCampaign(request.campaignId, request.brandId, request.status);

      logger.info('Campaign record created successfully', {
        campaignId: request.campaignId,
        status: request.status,
      });

      metrics.addMetric('CampaignRecordCreated', MetricUnit.Count, 1);

      return {
        success: true,
        campaign,
      };
    } catch (error) {
      logger.error('Failed to create campaign record', {
        error,
        campaignId: request.campaignId,
      });

      metrics.addMetric('CampaignRecordCreateFailed', MetricUnit.Count, 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a campaign record (used by event handlers)
   */
  async createCampaignRecord(request: CampaignRequest): Promise<CampaignResult> {
    return this.createCampaign(request);
  }

  /**
   * Get a campaign by ID
   */
  async getCampaign(campaignId: string): Promise<CampaignResult> {
    try {
      const campaign = await getCampaignById(campaignId);

      if (!campaign) {
        return {
          success: true,
          campaign: undefined,
        };
      }

      return {
        success: true,
        campaign,
      };
    } catch (error) {
      logger.error('Failed to get campaign', { error, campaignId });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * List campaigns (placeholder - would need proper DynamoDB query implementation)
   */
  async listCampaigns(queryParams: Record<string, string>): Promise<ListCampaignsResult> {
    // Note: This would require additional GSIs on the campaigns table
    // to support efficient querying by brandId, status, etc.
    // For now, return an error indicating this feature needs implementation

    logger.warn('listCampaigns called but not yet implemented', { queryParams });

    return {
      success: false,
      error: 'Campaign listing not yet implemented - requires additional GSIs',
    };
  }

  /**
   * Update a campaign
   */
  async updateCampaign(
    campaignId: string,
    updateRequest: Partial<CampaignRequest>
  ): Promise<CampaignResult> {
    try {
      // For now, only support status updates
      if (updateRequest.status) {
        await updateCampaignStatus(campaignId, updateRequest.status);

        // Get updated campaign
        const updatedCampaign = await getCampaignById(campaignId);

        if (!updatedCampaign) {
          throw new Error('Campaign not found after update');
        }

        logger.info('Campaign updated successfully', {
          campaignId,
          newStatus: updateRequest.status,
        });

        metrics.addMetric('CampaignUpdated', MetricUnit.Count, 1);

        return {
          success: true,
          campaign: updatedCampaign,
        };
      }

      return {
        success: false,
        error: 'No valid updates provided',
      };
    } catch (error) {
      logger.error('Failed to update campaign', { error, campaignId });

      metrics.addMetric('CampaignUpdateFailed', MetricUnit.Count, 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update campaign status (used by event handlers)
   */
  async updateCampaignStatus(request: {
    campaignId: string;
    status: DynamoCampaign['status'];
  }): Promise<CampaignResult> {
    logger.info('Updating campaign status', {
      campaignId: request.campaignId,
      status: request.status,
    });

    try {
      await updateCampaignStatus(request.campaignId, request.status);

      // Get updated campaign
      const updatedCampaign = await getCampaignById(request.campaignId);

      if (!updatedCampaign) {
        throw new Error('Campaign not found after status update');
      }

      logger.info('Campaign status updated successfully', {
        campaignId: request.campaignId,
        newStatus: request.status,
      });

      metrics.addMetric('CampaignStatusUpdated', MetricUnit.Count, 1);

      return {
        success: true,
        campaign: updatedCampaign,
      };
    } catch (error) {
      logger.error('Failed to update campaign status', {
        error,
        campaignId: request.campaignId,
        status: request.status,
      });

      metrics.addMetric('CampaignStatusUpdateFailed', MetricUnit.Count, 1);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a campaign
   */
  async deleteCampaign(campaignId: string): Promise<CampaignResult> {
    // Note: Campaign deletion is not implemented in the base campaign utilities
    // This would require additional implementation

    logger.warn('deleteCampaign called but not yet implemented', { campaignId });

    return {
      success: false,
      error: 'Campaign deletion not yet implemented',
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ healthy: boolean; details: string }> {
    try {
      // Test a simple campaign lookup (which tests DynamoDB connectivity)
      const testCampaignId = 'health-check-test';
      const result = await getCampaignById(testCampaignId);

      // We expect this to return null (campaign doesn't exist), but no error
      if (result === null) {
        return {
          healthy: true,
          details: 'Campaign service is healthy',
        };
      }

      return {
        healthy: true,
        details: 'Campaign service is healthy',
      };
    } catch (error) {
      logger.error('Campaign service health check failed', { error });
      return {
        healthy: false,
        details: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
