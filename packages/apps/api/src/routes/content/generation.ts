/**
 * Content Generation Routes
 * Handles AI-powered content generation for brands
 */

import type { FastifyPluginAsync } from 'fastify';

import {
  generateInstagramContent,
  type ContentGenerationRequest,
} from '../../services/content-generator.js';
import { buildSimpleContentListResponse } from '../../services/content-response-builder.js';
import { resolveGeneratedImageAsset, attachAssetToContent } from '../../services/assets-media.js';
import { verifyBrandOwnership } from '../../services/content-operations/authorization.js';
import { getDatabaseClient } from '../../config/database.js';
import { assertBrandOwnership } from '../../services/ownership.js';

const prisma = getDatabaseClient();

type GenerateContentBody = ContentGenerationRequest;

function getOpenAiErrorReply(error: Error, reply: any) {
  if (error.message.includes('OpenAI API key configuration error')) {
    return reply.code(503).send({
      error: 'AI service configuration error. Please contact support.',
    });
  }
  if (error.message.includes('OpenAI API quota exceeded')) {
    return reply.code(503).send({
      error: 'AI service quota exceeded. Please try again later.',
    });
  }
  if (error.message.includes('OpenAI API rate limit exceeded')) {
    return reply.code(429).send({
      error: 'AI service rate limit exceeded. Please try again in a moment.',
    });
  }
  return null;
}

async function importGeneratedAssetForContent(params: {
  request: any;
  contentId: string;
  brandId: string;
  imageUrl?: string | null;
  imageMetadata?: unknown;
}) {
  if (!params.imageUrl || !params.imageMetadata) {
    return;
  }

  try {
    const asset = await resolveGeneratedImageAsset(
      params.imageUrl,
      params.imageMetadata as
        { source: string; originalPrompt: string; assetId?: string } | undefined,
      {
        contentId: params.contentId,
        brandId: params.brandId,
      }
    );
    await attachAssetToContent({ contentId: params.contentId, asset });
    params.request.log.info(
      { brandId: params.brandId, contentId: params.contentId, assetId: asset.id },
      'Asset imported for content'
    );
  } catch (error: unknown) {
    params.request.log.error(
      { err: error, brandId: params.brandId, contentId: params.contentId },
      'Failed to import asset for content; leaving post without media'
    );
  }
}

async function createGeneratedContentRecord(params: {
  request: any;
  brandId: string;
  theme?: string;
  style?: string;
  generatedContent: {
    caption: string;
    imagePrompt?: string;
    imageUrl?: string;
    imageMetadata?: unknown;
  };
}) {
  if (!params.generatedContent.caption || params.generatedContent.caption.trim().length === 0) {
    throw new Error('Generated content has empty caption');
  }

  const created = await prisma.content.create({
    data: {
      caption: params.generatedContent.caption,
      status: 'draft',
      brandId: params.brandId,
      generationParams: JSON.parse(
        JSON.stringify({
          theme: params.theme,
          style: params.style,
          imagePrompt: params.generatedContent.imagePrompt,
          generatedAt: new Date().toISOString(),
        })
      ),
    },
    select: {
      id: true,
      caption: true,
      status: true,
      createdAt: true,
    },
  });

  await importGeneratedAssetForContent({
    request: params.request,
    contentId: created.id,
    brandId: params.brandId,
    imageUrl: params.generatedContent.imageUrl,
    imageMetadata: params.generatedContent.imageMetadata,
  });

  return {
    id: created.id,
    caption: created.caption,
    status: created.status,
    createdAt: created.createdAt,
  };
}

async function saveGeneratedContentRecords(params: {
  request: any;
  generatedContent: Array<{
    caption: string;
    imagePrompt?: string;
    imageUrl?: string;
    imageMetadata?: unknown;
  }>;
  brandId: string;
  theme?: string;
  style?: string;
}) {
  return Promise.all(
    params.generatedContent.map((content) =>
      createGeneratedContentRecord({
        request: params.request,
        brandId: params.brandId,
        theme: params.theme,
        style: params.style,
        generatedContent: content,
      })
    )
  );
}

function createGenerateContentHandler() {
  return async (request: any, reply: any) => {
    try {
      const userId = request.user!.id;
      const { brandId, count, theme, style } = request.body as GenerateContentBody;
      const authResult = await verifyBrandOwnership(userId, brandId);
      if (!authResult.authorized) {
        return reply.code(404).send({ error: authResult.error });
      }
      const brand = await assertBrandOwnership(userId, brandId);
      const generated = await generateInstagramContent(brand.name, {
        brandId,
        count,
        theme: theme || undefined,
        style: style || undefined,
      });
      const contentRecords = await saveGeneratedContentRecords({
        request,
        generatedContent: generated,
        brandId,
        theme,
        style,
      });
      const contentWithUrls = buildSimpleContentListResponse(contentRecords);
      return reply.code(201).send({
        content: contentWithUrls,
        metadata: { brandId, count: contentRecords.length, theme, style },
      });
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Content generation error');
      if (error instanceof Error) {
        const handled = getOpenAiErrorReply(error, reply);
        if (handled) {
          return handled;
        }
      }
      return reply.code(500).send({ error: 'Failed to generate content. Please try again.' });
    }
  };
}

const generationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: GenerateContentBody }>(
    '/generate',
    { preHandler: fastify.authenticate },
    createGenerateContentHandler()
  );
};

export default generationRoutes;
