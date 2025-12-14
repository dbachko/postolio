import { logger as baseLogger } from '@postolio/logger';
import { APIError } from '@postolio/errors';

const logger = baseLogger.child({ module: 'campaign-error-handler' });

export class CampaignErrorHandler {
  static async wrapOperation<T>(
    operation: () => Promise<T>,
    errorContext: { operation: string; campaignId?: string; userId?: string }
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.error(`Campaign ${errorContext.operation} failed`, {
        campaignId: errorContext.campaignId,
        userId: errorContext.userId,
        error,
      });

      if (error instanceof APIError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new APIError(
        `Campaign ${errorContext.operation} failed. Please try again.`,
        'CAMPAIGN_OPERATION_ERROR',
        500,
        {
          campaignId: errorContext.campaignId,
          userId: errorContext.userId,
          originalError: message,
        }
      );
    }
  }
}
