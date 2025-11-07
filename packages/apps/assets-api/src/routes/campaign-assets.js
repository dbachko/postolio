import { prismaAssets } from '@postolio/database-assets';
import { getAssetUrl } from '../utils/s3.js';
const campaignAssetsRoutes = async (fastify) => {
    // Get campaign asset pool
    fastify.get('/campaign-assets/:campaignId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { campaignId } = request.params;
        try {
            const campaignAssets = await prismaAssets.campaignAsset.findMany({
                where: { campaignId },
                include: {
                    asset: true,
                },
                orderBy: { timesUsed: 'asc' }, // Show least-used first
            });
            const assetsWithUrls = campaignAssets.map((ca) => ({
                ...ca,
                asset: {
                    ...ca.asset,
                    url: getAssetUrl(ca.asset.s3Key),
                    thumbnailUrl: ca.asset.thumbnailKey ? getAssetUrl(ca.asset.thumbnailKey) : null,
                },
            }));
            return {
                campaignAssets: assetsWithUrls,
                total: campaignAssets.length,
                used: campaignAssets.filter((ca) => ca.timesUsed > 0).length,
                available: campaignAssets.filter((ca) => ca.timesUsed === 0).length,
            };
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to fetch campaign assets',
            });
        }
    });
    // Add asset to campaign pool
    fastify.post('/campaign-assets', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const body = request.body;
        try {
            const { campaignId, assetId } = body;
            if (!campaignId || !assetId) {
                return reply.code(400).send({ error: 'campaignId and assetId are required' });
            }
            // Check if asset exists
            const asset = await prismaAssets.asset.findUnique({
                where: { id: assetId },
            });
            if (!asset) {
                return reply.code(404).send({ error: 'Asset not found' });
            }
            // Check if already in pool
            const existing = await prismaAssets.campaignAsset.findUnique({
                where: {
                    campaignId_assetId: {
                        campaignId,
                        assetId,
                    },
                },
            });
            if (existing) {
                return reply.code(400).send({ error: 'Asset already in campaign pool' });
            }
            const campaignAsset = await prismaAssets.campaignAsset.create({
                data: {
                    campaignId,
                    assetId,
                    aiDescription: asset.aiDescription,
                    aiTags: asset.aiTags,
                },
                include: {
                    asset: true,
                },
            });
            return {
                campaignAsset: {
                    ...campaignAsset,
                    asset: {
                        ...campaignAsset.asset,
                        url: getAssetUrl(campaignAsset.asset.s3Key),
                    },
                },
                message: 'Asset added to campaign pool successfully',
            };
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to add asset to campaign pool',
            });
        }
    });
    // Remove asset from campaign pool
    fastify.delete('/campaign-assets/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { id } = request.params;
        try {
            await prismaAssets.campaignAsset.delete({
                where: { id },
            });
            return {
                success: true,
                message: 'Asset removed from campaign pool successfully',
            };
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to remove asset from campaign pool',
            });
        }
    });
    // Get campaign pool statistics
    fastify.get('/campaign-assets/:campaignId/stats', { preHandler: [fastify.authenticate] }, async (request, reply) => {
        const { campaignId } = request.params;
        try {
            const campaignAssets = await prismaAssets.campaignAsset.findMany({
                where: { campaignId },
                select: {
                    timesUsed: true,
                    lastUsedAt: true,
                    selectionScore: true,
                },
            });
            const total = campaignAssets.length;
            const used = campaignAssets.filter((ca) => ca.timesUsed > 0).length;
            const available = total - used;
            const totalUsage = campaignAssets.reduce((sum, ca) => sum + ca.timesUsed, 0);
            const lastUsed = campaignAssets
                .filter((ca) => ca.lastUsedAt)
                .sort((a, b) => (b.lastUsedAt?.getTime() || 0) - (a.lastUsedAt?.getTime() || 0))[0]?.lastUsedAt;
            return {
                total,
                used,
                available,
                totalUsage,
                lastUsed: lastUsed?.toISOString() || null,
                avgUsagePerAsset: total > 0 ? totalUsage / total : 0,
            };
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({
                error: error instanceof Error ? error.message : 'Failed to fetch campaign stats',
            });
        }
    });
};
export default campaignAssetsRoutes;
