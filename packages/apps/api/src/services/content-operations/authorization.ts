/**
 * Content Authorization Service
 * Handles ownership verification and access control for content operations
 */

import { getDatabaseClient } from '../../config/database.js';

const prisma = getDatabaseClient();

export interface AuthorizationResult {
  authorized: boolean;
  error?: string;
  data?: unknown;
}

export interface ContentAuthResult extends AuthorizationResult {
  data?: {
    contentId: string;
    brandId: string;
    status: string;
    campaignId: string | null;
    campaignStatus?: string;
  };
}

export interface BrandAuthResult extends AuthorizationResult {
  data?: {
    brandId: string;
    name: string;
  };
}

/**
 * Verify that a user owns a specific content item through brand ownership
 */
export async function verifyContentOwnership(
  userId: string,
  contentId: string
): Promise<ContentAuthResult> {
  const content = await prisma.content.findFirst({
    where: { id: contentId },
    include: {
      brand: {
        select: { userId: true, id: true },
      },
      campaign: {
        select: { id: true, status: true },
      },
    },
  });

  if (!content || !content.brand || content.brand.userId !== userId) {
    return {
      authorized: false,
      error: 'Content not found',
    };
  }

  return {
    authorized: true,
    data: {
      contentId: content.id,
      brandId: content.brand.id,
      status: content.status,
      campaignId: content.campaignId,
      campaignStatus: content.campaign?.status,
    },
  };
}

/**
 * Verify that a user owns a specific brand
 */
export async function verifyBrandOwnership(
  userId: string,
  brandId: string
): Promise<BrandAuthResult> {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!brand) {
    return {
      authorized: false,
      error: 'Brand not found',
    };
  }

  return {
    authorized: true,
    data: {
      brandId: brand.id,
      name: brand.name,
    },
  };
}

/**
 * Verify that a user has access to a specific campaign through brand ownership
 */
export async function verifyCampaignAccess(
  userId: string,
  campaignId: string
): Promise<AuthorizationResult> {
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
    },
  });

  if (!campaign) {
    return {
      authorized: false,
      error: 'Campaign not found or does not belong to this brand',
    };
  }

  return {
    authorized: true,
    data: {
      campaignId: campaign.id,
      brandId: campaign.brandId,
      status: campaign.status,
    },
  };
}

/**
 * Verify content ownership and check if it's editable (not published)
 */
export async function verifyContentEditable(
  userId: string,
  contentId: string
): Promise<ContentAuthResult> {
  const authResult = await verifyContentOwnership(userId, contentId);

  if (!authResult.authorized) {
    return authResult;
  }

  if (authResult.data?.status === 'published') {
    return {
      authorized: false,
      error: 'Cannot edit published content. Published posts are immutable.',
    };
  }

  return authResult;
}

/**
 * Verify content ownership and check if it can be deleted (not published)
 */
export async function verifyContentDeletable(
  userId: string,
  contentId: string
): Promise<ContentAuthResult> {
  const authResult = await verifyContentOwnership(userId, contentId);

  if (!authResult.authorized) {
    return authResult;
  }

  if (authResult.data?.status === 'published') {
    return {
      authorized: false,
      error: 'Cannot delete published content',
    };
  }

  return authResult;
}
