import { DEFAULT_CAMPAIGN_NAME, DEFAULT_CAMPAIGN_STATUS } from '../constants/campaign.js';
import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

/**
 * Return the default campaign for a brand, creating it if it does not exist.
 * Enforces a single default campaign per brand at runtime. A partial unique
 * index (created via migration) also protects this at the DB level.
 */
export async function getOrCreateDefaultCampaign(brandId: string) {
  // Try fast path find
  const existing = await prisma.campaign.findFirst({
    where: { brandId, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing;

  // Create within a transaction to avoid races
  return prisma.$transaction(async (tx) => {
    const already = await tx.campaign.findFirst({
      where: { brandId, isDefault: true },
      select: { id: true },
    });
    if (already) return already;

    const created = await tx.campaign.create({
      data: {
        brandId,
        name: DEFAULT_CAMPAIGN_NAME,
        status: DEFAULT_CAMPAIGN_STATUS,
        isDefault: true,
        // Minimal config; downstream code tolerates missing fields
        config: {},
        priority: 10, // lowest priority by convention
      },
      select: { id: true },
    });
    return created;
  });
}

export async function isDefaultCampaign(campaignId: string): Promise<boolean> {
  const c = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { isDefault: true },
  });
  return Boolean(c?.isDefault);
}
