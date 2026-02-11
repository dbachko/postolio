import fastify, { FastifyInstance } from 'fastify';
import type { EventBridgeScheduledEvent, LambdaResponse } from '../types/aws-events.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export class RetentionManager {
  constructor(private readonly app: FastifyInstance) {}

  async initialize() {
    this.app.log.info(
      'Retention Manager (assets unified) initialized. No background tasks required.'
    );
  }

  async handleEventBridgeTrigger(event: EventBridgeScheduledEvent): Promise<LambdaResponse> {
    this.app.log.info(
      { id: event.id, detailType: event['detail-type'] },
      'Retention trigger received'
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'No retention processing required under unified assets' }),
    };
  }

  async deleteUserData(userId: string): Promise<{ deletedBrands: number; deletedContent: number }> {
    const brands = await prisma.brand.findMany({ where: { userId }, select: { id: true } });
    let deletedContent = 0;
    for (const brand of brands) {
      const result = await this.deleteBrandData(brand.id);
      deletedContent += result.deletedContent || 0;
    }
    await prisma.brand.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    return { deletedBrands: brands.length, deletedContent };
  }

  async deleteBrandData(brandId: string): Promise<{ brandId: string; deletedContent: number }> {
    const contentDeleted = await prisma.content.deleteMany({ where: { brandId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    return { brandId, deletedContent: contentDeleted.count };
  }

  async getRetentionStats(): Promise<{
    totalContent: number;
    assetsLinked: number;
    assetsUnlinked: number;
  }> {
    const totalContent = await prisma.content.count();
    const assetsLinked = await prisma.contentMediaAsset.count();
    const contentWithNoAssets = await prisma.content.count({
      where: { mediaAssets: { none: {} } },
    });
    return {
      totalContent,
      assetsLinked,
      assetsUnlinked: contentWithNoAssets,
    };
  }

  async triggerRetentionProcessing() {
    this.app.log.info(
      'Retention processing requested - handled by assets platform, nothing to run locally.'
    );
  }
}

let retentionManager: RetentionManager | null = null;

export function getRetentionManager(app: FastifyInstance): RetentionManager {
  if (!retentionManager) {
    retentionManager = new RetentionManager(app);
  }
  return retentionManager;
}

export const lambdaHandler = async (event: EventBridgeScheduledEvent): Promise<LambdaResponse> => {
  const app = fastify({ logger: { level: process.env.LOG_LEVEL || 'info' } });
  try {
    const manager = getRetentionManager(app);
    return await manager.handleEventBridgeTrigger(event);
  } finally {
    await app.close();
  }
};
