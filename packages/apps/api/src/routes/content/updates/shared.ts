import { getDatabaseClient } from '../../../config/database.js';
import type { Prisma } from '@postolio/database';
import type { ValidationErrorItem } from '@postolio/content-validation';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();

export interface UpdateContentBody {
  contentId: string;
  caption?: string;
  contentType?: 'post' | 'reel' | 'story';
  scheduledAt?: string;
  shareToFeed?: boolean;
  firstComment?: string;
  targetSocialAccountId?: string | null;
}

export interface MutableContentUpdate {
  caption?: string;
  hashtags?: string[];
  contentType?: 'post' | 'reel' | 'story';
  scheduledAt?: Date | null;
  status?: 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';
  shareToFeed?: boolean | null;
  firstComment?: string | null;
  targetSocialAccountId?: string | null;
}

export type RouteError = {
  statusCode: number;
  body: Record<string, unknown>;
};

export type TargetResolution = {
  normalizedTargetSocialAccountId: string | null | undefined;
  effectiveTargetSocialAccountId: string | null;
  resolvedTargetSocialAccount: { id: string; platform: string } | null;
  resolvedTargetSocialAccountDisconnected: boolean;
  destinationPlatform: string;
  schedulingSupported: boolean;
  schedulingEligible: boolean;
  updateTargetSocialAccountId: string | null | undefined;
};

export type PublishableValidationInput = {
  content: any;
  contentId: string;
  effectiveContentType: 'post' | 'reel' | 'story';
  effectiveCaption: string;
  destinationPlatform: string;
  scheduledAt?: string;
};

export type ValidationPayloadError = {
  message: string;
  details: ValidationErrorItem[];
};

export function isDisconnected(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  return Boolean((metadata as { disconnected?: boolean }).disconnected);
}

export const UPDATED_CONTENT_SELECT = {
  id: true,
  caption: true,
  hashtags: true,
  status: true,
  scheduledAt: true,
  postedAt: true,
  createdAt: true,
  updatedAt: true,
  brandId: true,
  contentType: true,
  contentGroupId: true,
  contentSeriesId: true,
  targetSocialAccountId: true,
  recipeRunId: true,
  recipeRun: {
    select: {
      recipeTemplate: { select: { id: true, slug: true, name: true } },
    },
  },
  schedulingError: true,
  generationParams: true,
  shareToFeed: true,
  firstComment: true,
  firstCommentStatus: true,
  firstCommentPostedAt: true,
  firstCommentError: true,
  mediaAssets: {
    select: { assetId: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' as const },
  },
} satisfies Prisma.ContentSelect;

export const CONTENT_WITH_RELATIONS_INCLUDE = {
  brand: {
    select: { userId: true, id: true },
  },
  publishingQueueItem: {
    select: { id: true, queueId: true, laneKey: true },
  },
  mediaAssets: {
    select: { assetId: true, displayOrder: true },
    orderBy: { displayOrder: 'asc' as const },
  },
} satisfies Prisma.ContentInclude;
