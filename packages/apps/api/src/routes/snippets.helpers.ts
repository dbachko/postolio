import type { FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';

export interface SnippetQueryParams {
  search?: string;
  tags?: string;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateSnippetBody {
  title?: string;
  content?: string;
  tags?: string[];
  category?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
}

type SnippetWhereFilter = {
  brandId: string;
  isArchived: boolean;
  OR?: Array<{
    title?: { contains: string; mode: 'insensitive' };
    content?: { contains: string; mode: 'insensitive' };
  }>;
  tags?: { hasEvery: string[] };
  category?: string;
};

export function normalizeTags(tags: string[]): string[] {
  return tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean);
}

export function trimNullableCategory(category: string | undefined): string | null {
  return category?.trim() || null;
}

export function buildSnippetWhereFilter(
  brandId: string,
  query: SnippetQueryParams
): SnippetWhereFilter {
  const { search, tags, category } = query;
  const where: SnippetWhereFilter = {
    brandId,
    isArchived: false,
  };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (tags) {
    const tagArray = tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tagArray.length > 0) {
      where.tags = { hasEvery: tagArray };
    }
  }

  if (category) {
    where.category = category;
  }

  return where;
}

export async function verifyBrandOwnership(
  brandId: string,
  userId: string,
  reply: FastifyReply
): Promise<boolean> {
  const brand = await prisma.brand.findFirst({
    where: { id: brandId, userId },
  });

  if (!brand) {
    reply.code(404).send({ error: 'Brand not found' });
    return false;
  }

  return true;
}

async function findOwnedSnippet(brandId: string, snippetId: string, userId: string) {
  return prisma.snippet.findFirst({
    where: {
      id: snippetId,
      brandId,
      brand: { userId },
    },
  });
}

export async function verifySnippetOwnership(
  brandId: string,
  snippetId: string,
  userId: string,
  reply: FastifyReply
) {
  const snippet = await findOwnedSnippet(brandId, snippetId, userId);
  if (!snippet) {
    reply.code(404).send({ error: 'Snippet not found' });
    return null;
  }
  return snippet;
}

export function validateSnippetUpdateContent(
  content: string | undefined,
  reply: FastifyReply
): boolean {
  if (!content || content.length <= 2000) {
    return true;
  }
  reply.code(400).send({ error: 'Content must be 2000 characters or less' });
  return false;
}

export async function ensureSnippetTitleIsUniqueForUpdate(params: {
  brandId: string;
  snippetId: string;
  currentTitle: string;
  incomingTitle: string | undefined;
  reply: FastifyReply;
}): Promise<boolean> {
  const title = params.incomingTitle?.trim();
  if (!title || title === params.currentTitle) {
    return true;
  }

  const existing = await prisma.snippet.findFirst({
    where: {
      brandId: params.brandId,
      title,
      isArchived: false,
      id: { not: params.snippetId },
    },
  });
  if (!existing) {
    return true;
  }

  params.reply.code(409).send({ error: 'A snippet with this title already exists' });
  return false;
}

export function buildSnippetUpdateData(body: UpdateSnippetBody): Record<string, unknown> {
  const normalizedTags = body.tags ? normalizeTags(body.tags) : undefined;
  return {
    ...(body.title && { title: body.title.trim() }),
    ...(body.content && { content: body.content.trim() }),
    ...(normalizedTags !== undefined && { tags: normalizedTags }),
    ...(body.category !== undefined && { category: trimNullableCategory(body.category) }),
    ...(body.isFavorite !== undefined && { isFavorite: body.isFavorite }),
    ...(body.isArchived !== undefined && { isArchived: body.isArchived }),
  };
}
