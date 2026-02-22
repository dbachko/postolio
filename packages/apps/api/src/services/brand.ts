import { EventBridge, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { logger as baseLogger } from '@postolio/logger';
import { getDatabaseClient } from '../config/database.js';
import { instagramService } from './instagram.js';
import { buildAnalysisAssetMetadata } from './brand-analysis-assets.js';
import { importImageFromExternalUrl } from './assets-media.js';
import { ensureAiCreditsWalletInitialized } from './ai-credits.js';

const prisma = getDatabaseClient();
const eventBridge = new EventBridge({});
const logger = baseLogger.child({ module: 'brand-service' });

export interface CreateBrandBody {
  name: string;
  description?: string;
  countryCode?: string | null;
}

export interface UpdateBrandBody {
  name?: string;
  description?: string;
  countryCode?: string | null;
}

export class BrandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrandValidationError';
  }
}

export class BrandNotFoundError extends Error {
  constructor(message = 'Brand not found') {
    super(message);
    this.name = 'BrandNotFoundError';
  }
}

export async function createBrand(userId: string, body: CreateBrandBody) {
  const { name, description, countryCode } = body;

  if (!name || name.trim().length === 0) {
    throw new BrandValidationError('Brand name is required');
  }

  if (name.length > 100) {
    throw new BrandValidationError('Brand name must be less than 100 characters');
  }

  const brand = await prisma.$transaction(async (tx) => {
    const created = await tx.brand.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        userId,
        ...(countryCode
          ? {
              countryCode:
                typeof countryCode === 'string' && countryCode.length === 2
                  ? countryCode.toUpperCase()
                  : null,
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        createdAt: true,
        countryCode: true,
      },
    });

    // Temporary policy: each newly created brand starts with default credits.
    await ensureAiCreditsWalletInitialized({ brandId: created.id, tx });

    return created;
  });

  return brand;
}

export async function listUserBrands(userId: string): Promise<unknown[]> {
  const brands = await prisma.brand.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      description: true,
      styleProfile: true,
      createdAt: true,
      countryCode: true,
      postingTimezone: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Strip preferences from the returned shape to keep the response
  // compatible with existing Brand client types.
  return brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    description: brand.description,
    styleProfile: brand.styleProfile,
    createdAt: brand.createdAt,
    countryCode: brand.countryCode,
    postingTimezone: brand.postingTimezone,
  }));
}

export async function getBrandDetails(userId: string, brandId: string): Promise<unknown> {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      userId,
    },
    select: {
      id: true,
      name: true,
      description: true,
      styleProfile: true,
      preferences: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!brand) {
    throw new BrandNotFoundError();
  }

  return brand;
}

export async function updateBrand(
  userId: string,
  brandId: string,
  updates: UpdateBrandBody
): Promise<unknown> {
  const { name, description, countryCode } = updates;

  // Validate at least one field is provided
  if (!name && description === undefined && countryCode === undefined) {
    throw new BrandValidationError('At least one field must be provided for update');
  }

  // Validate name if provided
  if (name !== undefined) {
    if (!name || name.trim().length === 0) {
      throw new BrandValidationError('Brand name cannot be empty');
    }
    if (name.length > 100) {
      throw new BrandValidationError('Brand name must be less than 100 characters');
    }
  }

  // Basic validation for countryCode if provided
  if (countryCode !== undefined && countryCode !== null) {
    if (typeof countryCode !== 'string' || countryCode.length !== 2) {
      throw new BrandValidationError('countryCode must be a 2-letter ISO code');
    }
  }

  // Check if brand exists and user owns it
  const existingBrand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      userId,
    },
  });

  if (!existingBrand) {
    throw new BrandNotFoundError();
  }

  interface BrandUpdateData {
    name?: string;
    description?: string | null;
    countryCode?: string | null;
  }
  const updateData: BrandUpdateData = {};
  if (name !== undefined) {
    updateData.name = name.trim();
  }
  if (description !== undefined) {
    updateData.description = description?.trim() || null;
  }
  if (countryCode !== undefined) {
    updateData.countryCode = countryCode ? countryCode.toUpperCase() : null;
  }

  const updatedBrand = await prisma.brand.update({
    where: { id: brandId },
    data: updateData,
    select: {
      id: true,
      name: true,
      description: true,
      styleProfile: true,
      createdAt: true,
      updatedAt: true,
      countryCode: true,
    },
  });

  // If brand name or description changed, trigger a new brand analysis (fire-and-forget)
  const nameChanged = typeof name === 'string' && name.trim() !== (existingBrand.name || '').trim();
  const descChanged =
    typeof description === 'string' &&
    (existingBrand.description || '') !== (description?.trim() || '');

  if (nameChanged || descChanged) {
    void triggerBrandAnalysisIfNeeded(updatedBrand.id, userId);
  }

  return updatedBrand;
}

export async function deleteBrand(
  userId: string,
  brandId: string
): Promise<{ id: string; name: string; _count: { content: number } }> {
  const brand = await prisma.brand.findFirst({
    where: {
      id: brandId,
      userId,
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          content: true,
        },
      },
    },
  });

  if (!brand) {
    throw new BrandNotFoundError();
  }

  await prisma.brand.delete({
    where: { id: brandId },
  });

  return brand;
}

async function triggerBrandAnalysisIfNeeded(brandId: string, userId: string): Promise<void> {
  try {
    // Check if Instagram is connected via SocialAccount (and not soft-disconnected)
    const instagramAccount = await prisma.socialAccount.findFirst({
      where: {
        brandId,
        platform: 'instagram',
      },
      select: { id: true, metadata: true },
    });

    const isDisconnected =
      instagramAccount && (instagramAccount.metadata as any)?.disconnected === true;

    if (!instagramAccount || isDisconnected) {
      return;
    }

    // Fire-and-forget background job to include a small recent-post sample (with CDN URLs)
    const postsRaw = await instagramService.getRecentPosts({ id: brandId }, 20);
    const posts = await Promise.all(
      postsRaw.map(async (p) => {
        let mediaUrl = p.media_url;
        if (
          p.media_type?.toUpperCase() !== 'VIDEO' &&
          typeof p.media_url === 'string' &&
          p.media_url
        ) {
          try {
            const metadata = await buildAnalysisAssetMetadata({
              brandId,
              contentId: p.id,
              generatedAt: p.timestamp ? new Date(p.timestamp) : new Date(),
            });
            const asset = await importImageFromExternalUrl(p.media_url, metadata);
            mediaUrl = asset.url;
          } catch (e) {
            logger.warn(
              'Failed to cache image via assets service for analysis; using original URL',
              { err: e, postId: p.id }
            );
          }
        }
        return {
          id: p.id,
          caption: p.caption,
          hashtags: p.hashtags,
          timestamp: p.timestamp,
          like_count: p.like_count,
          comments_count: p.comments_count,
          media_type: p.media_type,
          media_url: mediaUrl,
        };
      })
    );

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            DetailType: 'brand.analysis.requested',
            Source: 'postolio.brand',
            EventBusName: process.env.EVENT_BUS_NAME || 'default',
            Detail: JSON.stringify({
              brandId,
              requestedBy: userId,
              options: { reason: 'brand-updated', maxPosts: 20 },
              posts,
            }),
          },
        ],
      })
    );
  } catch (e) {
    logger.warn('Failed to emit brand.analysis.requested on update', { err: e, brandId });
  }
}
