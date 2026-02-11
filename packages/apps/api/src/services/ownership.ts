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

type SocialAccountAccessPayload = Prisma.SocialAccountGetPayload<{
  select: {
    id: true;
    brandId: true;
    platform: true;
  };
}>;

type PublishingQueueAccessPayload = Prisma.PublishingQueueGetPayload<{
  select: {
    id: true;
    socialAccountId: true;
    name: true;
    paused: true;
    isDefault: true;
    socialAccount: {
      select: {
        brandId: true;
        brand: {
          select: {
            id: true;
          };
        };
      };
    };
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

export async function assertSocialAccountAccess(
  userId: string,
  socialAccountId: string
): Promise<SocialAccountAccessPayload> {
  const account = await prisma.socialAccount.findFirst({
    where: {
      id: socialAccountId,
      brand: { userId },
    },
    select: {
      id: true,
      brandId: true,
      platform: true,
    },
  });

  if (!account) {
    throw new APIError(
      'Social account not found or access denied',
      'SOCIAL_ACCOUNT_NOT_FOUND',
      404,
      { socialAccountId }
    );
  }

  return account;
}

export async function assertPublishingQueueAccess(
  userId: string,
  queueId: string
): Promise<PublishingQueueAccessPayload> {
  const queue = await prisma.publishingQueue.findFirst({
    where: {
      id: queueId,
      socialAccount: {
        brand: { userId },
      },
    },
    select: {
      id: true,
      socialAccountId: true,
      name: true,
      paused: true,
      isDefault: true,
      socialAccount: {
        select: {
          brandId: true,
          brand: { select: { id: true } },
        },
      },
    },
  });

  if (!queue) {
    throw new APIError(
      'Publishing queue not found or access denied',
      'PUBLISHING_QUEUE_NOT_FOUND',
      404,
      { queueId }
    );
  }

  return queue;
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
