import { prisma } from '../config/database.js';
import type { Prisma } from '@postolio/database';
import type { InstagramPost } from './instagram.js';

function normalizeCaption(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildDraftCandidateFilters(
  postedAt: Date | null,
  captionPrefix: string,
  windowMs: number
): Prisma.ContentWhereInput[] {
  const filters: Prisma.ContentWhereInput[] = [];
  if (postedAt) {
    filters.push({
      scheduledAt: {
        gte: new Date(postedAt.getTime() - windowMs),
        lte: new Date(postedAt.getTime() + windowMs),
      },
    });
  }
  if (captionPrefix) {
    filters.push({ caption: { contains: captionPrefix, mode: 'insensitive' } });
  }
  return filters;
}

function scoreDraftCandidate(params: {
  candidate: { scheduledAt: Date | null; caption: string | null };
  postedAt: Date | null;
  targetCaption: string;
  windowMs: number;
}): number {
  let score = 0;

  if (params.postedAt && params.candidate.scheduledAt) {
    const diff = Math.abs(params.candidate.scheduledAt.getTime() - params.postedAt.getTime());
    const timeScore = Math.max(0, (params.windowMs - diff) / params.windowMs);
    score += timeScore * 0.7;
  }

  if (!params.candidate.caption) {
    return score;
  }

  const normalizedCandidateCaption = normalizeCaption(params.candidate.caption);
  if (
    normalizedCandidateCaption &&
    normalizedCandidateCaption === params.targetCaption &&
    normalizedCandidateCaption.length > 0
  ) {
    return score + 0.5;
  }

  if (!normalizedCandidateCaption || !params.targetCaption) {
    return score;
  }

  const targetPrefix = params.targetCaption.slice(0, Math.min(32, params.targetCaption.length));
  if (normalizedCandidateCaption.includes(targetPrefix)) {
    return score + 0.2;
  }

  return score;
}

export async function findMatchingDraftCandidate(brandId: string, post: InstagramPost) {
  const postedAt = post.timestamp ? new Date(post.timestamp) : null;
  const twoHoursMs = 2 * 60 * 60 * 1000;
  const caption = (post.caption || '').trim();
  const captionPrefix = caption.slice(0, 64);
  const orFilters = buildDraftCandidateFilters(postedAt, captionPrefix, twoHoursMs);
  const candidates = await prisma.content.findMany({
    where: {
      brandId,
      status: { in: ['draft', 'scheduled', 'failed', 'skipped'] },
      ...(orFilters.length ? { OR: orFilters } : {}),
    },
    orderBy: [{ scheduledAt: 'desc' }, { updatedAt: 'desc' }],
    take: 25,
  });
  if (!candidates.length) {
    return null;
  }

  const normTarget = normalizeCaption(caption);
  let best: { id: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = scoreDraftCandidate({
      candidate,
      postedAt,
      targetCaption: normTarget,
      windowMs: twoHoursMs,
    });
    if (!best || score > best.score) {
      best = { id: candidate.id, score };
    }
  }
  if (best && best.score >= 0.3) {
    return candidates.find((candidate) => candidate.id === best.id) || null;
  }
  return null;
}
