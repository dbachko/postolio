import { APIError } from '@postolio/errors';
import { getDatabaseClient } from '../config/database.js';
import type { Prisma } from '@postolio/database';

const prisma = getDatabaseClient();

type BrandOwnershipPayload = Prisma.BrandGetPayload<{
  select: {
    id: true;
    name: true;
    preferences: true;
    postingTimezone: true;
  };
}>;

type CampaignAccessPayload = Prisma.CampaignGetPayload<{
  select: {
    id: true;
    brandId: true;
    status: true;
    name: true;
  };
}>;

export async function assertBrandOwnership(
  userId: string,
  brandId: string
): Promise<BrandOwnershipPayload> {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      userId,
    },
    select: {
      id: true,
      name: true,
      preferences: true,
      postingTimezone: true,
    },
  });

  if (!brand) {
    throw new APIError('Brand not found or access denied', 'BRAND_NOT_FOUND', 404, { brandId });
  }

  return brand;
}

export async function assertCampaignAccess(
  userId: string,
  campaignId: string
): Promise<CampaignAccessPayload> {
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: campaignId,
      brand: {
        userId,
      },
    },
    select: {
      id: true,
      brandId: true,
      status: true,
      name: true,
    },
  });

  if (!campaign) {
    throw new APIError('Campaign not found or access denied', 'CAMPAIGN_NOT_FOUND', 404, {
      campaignId,
    });
  }

  return campaign;
}

export async function assertInstagramConnected(brandId: string): Promise<{
  id: string;
  metadata: unknown;
  externalAccountId: string | null;
  externalPageId: string | null;
}> {
  const account = await prisma.socialAccount.findFirst({
    where: {
      brandId,
      platform: 'instagram',
    },
    select: {
      id: true,
      metadata: true,
      externalAccountId: true,
      externalPageId: true,
    },
  });

  if (!account) {
    throw new APIError('Instagram not connected for this brand', 'INSTAGRAM_NOT_CONNECTED', 400, {
      brandId,
    });
  }

  const isDisconnected = (account.metadata as any)?.disconnected === true;
  if (isDisconnected) {
    throw new APIError(
      'Instagram account disconnected for this brand',
      'INSTAGRAM_DISCONNECTED',
      400,
      {
        brandId,
      }
    );
  }

  return account;
}
