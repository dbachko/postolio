/**
 * Content Authorization Service
 * Handles ownership verification and access control for content operations
 */

import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../ownership.js';

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
    },
  });

  if (content?.brand?.userId !== userId) {
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
  try {
    const brand = await assertBrandOwnership(userId, brandId);

    return {
      authorized: true,
      data: {
        brandId: brand.id,
        name: brand.name ?? '',
      },
    };
  } catch (error: any) {
    // Normalize "brand not found" into the existing AuthorizationResult shape;
    // let other errors bubble up to the global error handler.
    if (error && typeof error === 'object' && (error as any).code === 'BRAND_NOT_FOUND') {
      return {
        authorized: false,
        error: 'Brand not found',
      };
    }

    throw error;
  }
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
