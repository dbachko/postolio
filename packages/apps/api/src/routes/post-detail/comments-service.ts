import { prisma, socialCommentServices, type PlatformComment } from './shared.js';

type LocalCommentRow = {
  externalCommentId: string;
  text: string | null;
  authorUsername: string | null;
  likeCount: number | null;
  createdAt: Date | null;
  status: string;
};

type RemoteComment = {
  id?: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
};

type RemoteCommentResult = {
  data: RemoteComment[];
  total: number;
};

function mapLocalRows(rows: LocalCommentRow[]): PlatformComment[] {
  return rows.map((row) => ({
    id: row.externalCommentId,
    text: row.text || undefined,
    username: row.authorUsername || undefined,
    timestamp: row.createdAt?.toISOString(),
    like_count: typeof row.likeCount === 'number' ? row.likeCount : undefined,
    workflow: { status: String(row.status) },
  }));
}

function isFreshFetch(fetchedAt: Date | null | undefined, freshnessTtlMs: number) {
  if (!fetchedAt) {
    return false;
  }
  return Date.now() - fetchedAt.getTime() < freshnessTtlMs;
}

async function readLocalComments(params: { publicationId: string; skip: number; take: number }) {
  const [latestFetch, total, rows] = await Promise.all([
    prisma.publicationComment.findFirst({
      where: { publicationId: params.publicationId },
      orderBy: { fetchedAt: 'desc' },
      select: { fetchedAt: true },
    }),
    prisma.publicationComment.count({ where: { publicationId: params.publicationId } }),
    prisma.publicationComment.findMany({
      where: { publicationId: params.publicationId },
      orderBy: { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
      select: {
        externalCommentId: true,
        text: true,
        authorUsername: true,
        likeCount: true,
        createdAt: true,
        status: true,
      },
    }),
  ]);

  return { latestFetch, total, rows: rows as LocalCommentRow[] };
}

async function fetchRemoteComments(params: {
  platform: string;
  socialAccountId: string;
  externalPostId: string;
  limit: number;
}) {
  if (params.platform === 'instagram') {
    return socialCommentServices.instagram.getPostCommentsForSocialAccount(
      params.socialAccountId,
      params.externalPostId,
      params.limit
    ) as Promise<RemoteCommentResult>;
  }
  return socialCommentServices.facebook.getPostCommentsForSocialAccount(
    params.socialAccountId,
    params.externalPostId,
    params.limit
  ) as Promise<RemoteCommentResult>;
}

async function upsertRemoteComments(params: {
  publicationId: string;
  platform: string;
  remoteComments: RemoteComment[];
  log: any;
}) {
  const fetchedAt = new Date();
  for (const comment of params.remoteComments) {
    const externalCommentId = String(comment.id || '');
    if (!externalCommentId) {
      continue;
    }

    try {
      await prisma.publicationComment.upsert({
        where: {
          publicationId_externalCommentId: {
            publicationId: params.publicationId,
            externalCommentId,
          },
        } as any,
        update: {
          text: comment.text || null,
          authorUsername: comment.username || null,
          likeCount: typeof comment.like_count === 'number' ? comment.like_count : 0,
          fetchedAt,
        },
        create: {
          publicationId: params.publicationId,
          platform: params.platform as any,
          externalCommentId,
          text: comment.text || null,
          authorUsername: comment.username || null,
          likeCount: typeof comment.like_count === 'number' ? comment.like_count : 0,
          status: 'open',
          createdAt: comment.timestamp ? new Date(comment.timestamp) : undefined,
          fetchedAt,
        },
      });
    } catch (error: unknown) {
      params.log.debug({ err: error }, 'Failed to upsert publication comment');
    }
  }
}

async function loadWorkflowByCommentId(params: {
  publicationId: string;
  commentIds: string[];
  log: any;
}) {
  if (params.commentIds.length === 0) {
    return new Map<string, { status: string }>();
  }

  try {
    const rows = await prisma.publicationComment.findMany({
      where: {
        publicationId: params.publicationId,
        externalCommentId: { in: params.commentIds },
      },
      select: { externalCommentId: true, status: true },
    });
    return new Map(rows.map((row) => [row.externalCommentId, { status: String(row.status) }]));
  } catch (error: unknown) {
    params.log.warn({ err: error }, 'Failed to merge comment workflows');
    return new Map<string, { status: string }>();
  }
}

function mapRemoteComments(
  comments: RemoteComment[],
  workflowByCommentId: Map<string, { status: string }>
): PlatformComment[] {
  return comments.map((comment) => ({
    id: comment.id,
    text: comment.text,
    username: comment.username,
    timestamp: comment.timestamp,
    like_count: comment.like_count,
    workflow: workflowByCommentId.get(String(comment.id || '')) || null,
  }));
}

export async function loadCommentsForPublication(params: {
  publicationId: string;
  platform: string;
  socialAccountId: string;
  externalPostId: string;
  page: number;
  limit: number;
  refresh: boolean;
  freshnessTtlMs: number;
  log: any;
}) {
  const skip = Math.max(0, (params.page - 1) * params.limit);
  const local = await readLocalComments({
    publicationId: params.publicationId,
    skip,
    take: params.limit,
  });
  const fresh = isFreshFetch(local.latestFetch?.fetchedAt, params.freshnessTtlMs);
  if (!params.refresh && fresh && local.rows.length > 0) {
    return { comments: mapLocalRows(local.rows), total: local.total };
  }

  try {
    const remote = await fetchRemoteComments({
      platform: params.platform,
      socialAccountId: params.socialAccountId,
      externalPostId: params.externalPostId,
      limit: params.limit,
    });
    await upsertRemoteComments({
      publicationId: params.publicationId,
      platform: params.platform,
      remoteComments: remote.data,
      log: params.log,
    });
    const ids = remote.data.map((comment) => String(comment.id || '')).filter(Boolean);
    const workflowByCommentId = await loadWorkflowByCommentId({
      publicationId: params.publicationId,
      commentIds: ids,
      log: params.log,
    });
    return {
      comments: mapRemoteComments(remote.data, workflowByCommentId),
      total: remote.total,
    };
  } catch (error: unknown) {
    params.log.warn({ err: error }, 'Failed to fetch comments via Graph');
    return { comments: mapLocalRows(local.rows), total: local.total };
  }
}
