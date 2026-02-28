import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertBrandOwnership } from '../../../services/ownership.js';
import { supportsScheduling } from '../../../utils/platform.js';
import {
  buildForwardAuthHeaders,
  ensureMultiDestinationEnabled,
  isDisconnected,
  prisma,
  type AuthenticatedRequest,
} from './shared.js';

type GroupScheduleRoute = {
  Params: { contentGroupId: string };
  Body: { scheduledAt?: string | null };
};

type GroupForSchedule = NonNullable<Awaited<ReturnType<typeof loadGroupForSchedule>>>;

type ScheduleResult = {
  contentId: string;
  ok: boolean;
  statusCode: number;
  error?: unknown;
};

const GROUP_FOR_SCHEDULE_INCLUDE = {
  brand: { select: { id: true, userId: true } },
  contents: {
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      targetSocialAccountId: true,
      brandId: true,
    },
  },
} as const;

function parseScheduledAt(rawValue: unknown): string | null | undefined {
  if (rawValue === null) {
    return null;
  }
  if (typeof rawValue === 'string') {
    return rawValue.trim();
  }
  return undefined;
}

function parseScheduleRequest(
  request: FastifyRequest<GroupScheduleRoute>,
  reply: FastifyReply
): { contentGroupId: string; scheduledAt: string | null } | null {
  const { contentGroupId } = request.params;
  if (!contentGroupId || typeof contentGroupId !== 'string') {
    void reply.code(400).send({ error: 'invalid_content_group_id' });
    return null;
  }

  const scheduledAt = parseScheduledAt(request.body?.scheduledAt);
  if (scheduledAt === undefined) {
    void reply.code(400).send({ error: 'scheduledAt is required' });
    return null;
  }

  if (scheduledAt) {
    const timestamp = new Date(scheduledAt).getTime();
    if (Number.isNaN(timestamp)) {
      void reply.code(400).send({ error: 'invalid_scheduledAt' });
      return null;
    }
    if (timestamp <= Date.now()) {
      void reply.code(400).send({ error: 'scheduledAt must be in the future' });
      return null;
    }
  }

  return { contentGroupId, scheduledAt };
}

async function loadGroupForSchedule(contentGroupId: string) {
  return prisma.contentGroup.findUnique({
    where: { id: contentGroupId },
    include: GROUP_FOR_SCHEDULE_INCLUDE,
  });
}

async function validateGroupForSchedule(params: {
  request: FastifyRequest<GroupScheduleRoute>;
  reply: FastifyReply;
  group: GroupForSchedule | null;
}) {
  if (!params.group) {
    void params.reply.code(404).send({ error: 'content_group_not_found' });
    return null;
  }

  const userId = params.request.user!.id;
  if (params.group.brand.userId !== userId) {
    void params.reply.code(404).send({ error: 'content_group_not_found' });
    return null;
  }

  await assertBrandOwnership(userId, params.group.brandId);
  if (params.group.contents.some((entry) => entry.status === 'published')) {
    void params.reply.code(400).send({
      error: 'content_group_immutable',
      message: 'This content group contains published posts and cannot be rescheduled',
    });
    return null;
  }

  return params.group;
}

async function validateSchedulingPlatforms(params: {
  reply: FastifyReply;
  group: GroupForSchedule;
  scheduledAt: string | null;
}) {
  if (!params.scheduledAt) {
    return true;
  }

  const destinationIds = params.group.contents
    .map((entry) => entry.targetSocialAccountId)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
  if (destinationIds.length !== params.group.contents.length) {
    void params.reply.code(400).send({
      error: 'invalid_target_social_account',
      message: 'One or more destination social accounts are missing from this group',
    });
    return false;
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { brandId: params.group.brandId, id: { in: Array.from(new Set(destinationIds)) } },
    select: { id: true, platform: true, metadata: true },
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const invalid: string[] = [];
  const unsupportedPlatforms = new Set<string>();
  for (const destinationId of destinationIds) {
    const account = accountById.get(destinationId);
    if (!account || isDisconnected(account.metadata)) {
      invalid.push(destinationId);
      continue;
    }
    if (!supportsScheduling(String(account.platform))) {
      unsupportedPlatforms.add(String(account.platform));
    }
  }

  if (unsupportedPlatforms.size > 0) {
    void params.reply.code(400).send({
      error: 'scheduling_not_supported',
      message: 'Scheduling is not yet supported for one or more selected destinations',
      details: Array.from(unsupportedPlatforms),
    });
    return false;
  }

  if (invalid.length > 0) {
    void params.reply.code(400).send({
      error: 'invalid_target_social_account',
      message: 'One or more destination social accounts are not connected to this brand',
      details: invalid,
    });
    return false;
  }

  return true;
}

async function applyScheduleToContents(params: {
  fastify: FastifyInstance;
  contentIds: string[];
  headers: Record<string, string>;
  scheduledAt: string | null;
}) {
  const results: ScheduleResult[] = [];
  for (const contentId of params.contentIds) {
    const response = await params.fastify.inject({
      method: 'PUT',
      url: `/api/content/${encodeURIComponent(contentId)}`,
      headers: params.headers,
      payload: { scheduledAt: params.scheduledAt || null },
    });

    if (response.statusCode >= 200 && response.statusCode < 300) {
      results.push({ contentId, ok: true, statusCode: response.statusCode });
      continue;
    }

    let errorPayload: unknown = null;
    try {
      errorPayload = response.json();
    } catch {
      errorPayload = response.payload || null;
    }
    results.push({
      contentId,
      ok: false,
      statusCode: response.statusCode,
      error: errorPayload,
    });
  }

  return results;
}

async function handleGroupSchedule(
  fastify: FastifyInstance,
  request: FastifyRequest<GroupScheduleRoute>,
  reply: FastifyReply
) {
  if (!ensureMultiDestinationEnabled(request as AuthenticatedRequest, reply)) {
    return;
  }

  const parsed = parseScheduleRequest(request, reply);
  if (!parsed) {
    return;
  }

  const group = await validateGroupForSchedule({
    request,
    reply,
    group: await loadGroupForSchedule(parsed.contentGroupId),
  });
  if (!group) {
    return;
  }

  const isPlatformValid = await validateSchedulingPlatforms({
    reply,
    group,
    scheduledAt: parsed.scheduledAt,
  });
  if (!isPlatformValid) {
    return;
  }

  const results = await applyScheduleToContents({
    fastify,
    contentIds: group.contents.map((entry) => entry.id),
    headers: buildForwardAuthHeaders(request.headers),
    scheduledAt: parsed.scheduledAt,
  });

  const failed = results.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    return reply.code(502).send({
      success: false,
      error: 'Failed to update one or more destination posts',
      results,
    });
  }

  return reply.send({ success: true, results });
}

export function registerGroupScheduleRoute(fastify: FastifyInstance) {
  fastify.post<GroupScheduleRoute>(
    '/groups/:contentGroupId/schedule',
    { preHandler: fastify.authenticate },
    async (request, reply) => handleGroupSchedule(fastify, request, reply)
  );
}
