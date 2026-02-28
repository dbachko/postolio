import crypto from 'crypto';

import { getDatabaseClient } from '../../config/database.js';
import { facebookService } from '../../services/facebook.js';
import { instagramService } from '../../services/instagram.js';
import { getRedisClient } from '../../services/redis.js';
import {
  PaginationSchema,
  PostDetailParamsSchema,
  validateRequest,
} from '../../schemas/api-validation.js';
import { ErrorResponses } from '../../utils/api-response.js';

export const prisma: ReturnType<typeof getDatabaseClient> = getDatabaseClient();
export const supportedCommentPlatforms = ['instagram', 'facebook'] as const;
export const commentsFreshnessTtlMs = 60_000;

export interface PostDetailParams {
  postId: string;
}

export type CommentWorkflowStatus = 'open' | 'resolved' | 'archived';

export type PlatformComment = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
  workflow?: { status?: string } | null;
};

type SocialCommentService = {
  getPostCommentsForSocialAccount: (...args: any[]) => Promise<any>;
  replyToCommentForSocialAccount: (...args: any[]) => Promise<any>;
  likeCommentForSocialAccount?: (...args: any[]) => Promise<any>;
};

export const socialCommentServices: Record<'instagram' | 'facebook', SocialCommentService> = {
  instagram: instagramService,
  facebook: facebookService,
};

export function validatePostParams(params: unknown) {
  return validateRequest(PostDetailParamsSchema, params);
}

export function parsePublicationId(query: unknown): string | null {
  const raw = (query as any)?.publicationId;
  return typeof raw === 'string' ? String(raw) : null;
}

export function parseRefreshFlag(query: unknown): boolean {
  const refreshRaw = String((query as any)?.refresh ?? '')
    .trim()
    .toLowerCase();
  return refreshRaw === 'true' || refreshRaw === '1';
}

export function parsePaginationQuery(query: unknown) {
  const parsed = PaginationSchema.safeParse(query);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    });
    return { success: false as const, errors };
  }

  return {
    success: true as const,
    data: {
      pageNum: Number(parsed.data.page),
      limitNum: Number(parsed.data.limit),
    },
  };
}

export function hashReplyMessage(message: string) {
  return crypto.createHash('sha256').update(message.trim()).digest('hex');
}

export function getRedis() {
  return getRedisClient();
}

export function extractTrimmedMessage(body: unknown) {
  const rawMessage = (body as { message?: unknown } | undefined)?.message;
  if (typeof rawMessage !== 'string') {
    return null;
  }
  const message = rawMessage.trim();
  return message.length > 0 ? message : null;
}

export function parseCommentIds(body: unknown) {
  const raw = (body as { commentIds?: unknown } | undefined)?.commentIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  const unique = new Set(raw.map((id) => String(id || '').trim()).filter(Boolean));
  return [...unique];
}

export async function loadAuthorizedPost(params: {
  postId: string;
  userId: string;
  reply: any;
  requirePublished?: boolean;
}): Promise<any | null> {
  const post = await prisma.content.findUnique({
    where: { id: params.postId },
    include: { brand: true },
  });

  if (!post) {
    params.reply.code(404).send(ErrorResponses.notFound('Post'));
    return null;
  }
  if (post.brand.userId !== params.userId) {
    params.reply.code(403).send(ErrorResponses.forbidden('Access denied to this post'));
    return null;
  }
  if (params.requirePublished && post.status !== 'published') {
    params.reply.code(400).send(ErrorResponses.badRequest('Post is not published'));
    return null;
  }

  return post;
}

export async function findPostPublication(params: {
  postId: string;
  publicationId: string | null;
  targetSocialAccountId: string | null;
}) {
  if (params.publicationId) {
    return prisma.contentPublication.findFirst({
      where: {
        id: params.publicationId,
        contentId: params.postId,
        platform: { in: supportedCommentPlatforms as any },
      },
      select: {
        id: true,
        platform: true,
        externalPostId: true,
        socialAccountId: true,
      },
    });
  }

  return prisma.contentPublication.findFirst({
    where: {
      contentId: params.postId,
      platform: { in: supportedCommentPlatforms as any },
      ...(params.targetSocialAccountId ? { socialAccountId: params.targetSocialAccountId } : {}),
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      platform: true,
      externalPostId: true,
      socialAccountId: true,
    },
  });
}
