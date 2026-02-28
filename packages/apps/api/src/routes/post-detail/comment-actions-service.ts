import {
  getRedis,
  hashReplyMessage,
  prisma,
  socialCommentServices,
  type CommentWorkflowStatus,
} from './shared.js';

export async function acquireReplyIdempotencyLock(params: {
  externalPostId: string;
  commentId: string;
  message: string;
}) {
  const redis = getRedis();
  if (!redis) {
    return { deduped: false, lockKey: null as string | null, hasLock: false, redis: null };
  }

  const messageHash = hashReplyMessage(params.message);
  const lockKey = `idem:comment-reply:${params.externalPostId}:${params.commentId}:${messageHash}`;
  const ok = await redis.set(lockKey, '1', 'EX', 30, 'NX');
  if (!ok) {
    return { deduped: true, lockKey, hasLock: false, redis };
  }

  return { deduped: false, lockKey, hasLock: true, redis };
}

export async function releaseReplyIdempotencyLock(params: {
  redis: { del: (key: string) => Promise<unknown> } | null;
  lockKey: string | null;
  hasLock: boolean;
}) {
  if (!params.redis || !params.lockKey || !params.hasLock) {
    return;
  }
  try {
    await params.redis.del(params.lockKey);
  } catch {
    // best effort
  }
}

export async function sendPlatformCommentReply(params: {
  platform: string;
  socialAccountId: string;
  externalPostId: string;
  commentId: string;
  message: string;
}) {
  if (params.platform === 'instagram') {
    return socialCommentServices.instagram.replyToCommentForSocialAccount(
      params.socialAccountId,
      params.externalPostId,
      params.commentId,
      params.message
    );
  }
  return socialCommentServices.facebook.replyToCommentForSocialAccount(
    params.socialAccountId,
    params.commentId,
    params.message
  );
}

export async function likePlatformComment(params: {
  platform: string;
  socialAccountId: string;
  commentId: string;
}) {
  if (params.platform === 'instagram') {
    if (!socialCommentServices.instagram.likeCommentForSocialAccount) {
      throw new Error('Instagram comment-like operation is not supported');
    }
    return socialCommentServices.instagram.likeCommentForSocialAccount(
      params.socialAccountId,
      params.commentId
    );
  }
  if (!socialCommentServices.facebook.likeCommentForSocialAccount) {
    throw new Error('Facebook comment-like operation is not supported');
  }
  return socialCommentServices.facebook.likeCommentForSocialAccount(
    params.socialAccountId,
    params.commentId
  );
}

export async function upsertCommentWorkflowStatus(params: {
  publicationId: string;
  platform: string;
  commentId: string;
  status?: CommentWorkflowStatus;
}) {
  const row = await prisma.publicationComment.upsert({
    where: {
      publicationId_externalCommentId: {
        publicationId: params.publicationId,
        externalCommentId: params.commentId,
      },
    } as any,
    update: params.status ? { status: params.status } : {},
    create: {
      publicationId: params.publicationId,
      platform: params.platform as any,
      externalCommentId: params.commentId,
      text: null,
      status: params.status || 'open',
    },
  });

  return {
    externalCommentId: row.externalCommentId,
    status: row.status,
  };
}

async function resolveCommentIds(params: { publicationId: string; inputCommentIds: string[] }) {
  if (params.inputCommentIds.length === 0) {
    return {
      idsToResolve: [] as string[],
      idsToCreate: [] as string[],
      resolveAllOpen: true,
    };
  }

  const existing = await prisma.publicationComment.findMany({
    where: {
      publicationId: params.publicationId,
      externalCommentId: { in: params.inputCommentIds },
    },
    select: { externalCommentId: true, status: true },
  });

  const existingIds = new Set(existing.map((row) => row.externalCommentId));
  const idsToResolve = existing
    .filter((row) => row.status === 'open')
    .map((row) => row.externalCommentId);
  const idsToCreate = params.inputCommentIds.filter((id) => !existingIds.has(id));

  return { idsToResolve, idsToCreate, resolveAllOpen: false };
}

export async function markCommentsResolved(params: {
  publicationId: string;
  platform: string;
  commentIds: string[];
}) {
  let marked = 0;
  const resolvedIds = await resolveCommentIds({
    publicationId: params.publicationId,
    inputCommentIds: params.commentIds,
  });

  if (resolvedIds.resolveAllOpen) {
    const updated = await prisma.publicationComment.updateMany({
      where: { publicationId: params.publicationId, status: 'open' },
      data: { status: 'resolved' },
    });
    return updated.count;
  }

  if (resolvedIds.idsToResolve.length > 0) {
    const updated = await prisma.publicationComment.updateMany({
      where: {
        publicationId: params.publicationId,
        externalCommentId: { in: resolvedIds.idsToResolve },
        status: 'open',
      },
      data: { status: 'resolved' },
    });
    marked += updated.count;
  }

  if (resolvedIds.idsToCreate.length > 0) {
    const created = await prisma.publicationComment.createMany({
      data: resolvedIds.idsToCreate.map((id) => ({
        publicationId: params.publicationId,
        platform: params.platform as any,
        externalCommentId: id,
        status: 'resolved',
      })),
      skipDuplicates: true,
    });
    marked += created.count;
  }

  return marked;
}
