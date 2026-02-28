import type { FastifyInstance } from 'fastify';

import { ErrorResponses, paginatedResponse } from '../../utils/api-response.js';

import { loadCommentsForPublication } from './comments-service.js';
import {
  commentsFreshnessTtlMs,
  findPostPublication,
  loadAuthorizedPost,
  parsePaginationQuery,
  parsePublicationId,
  parseRefreshFlag,
  validatePostParams,
  type PostDetailParams,
} from './shared.js';

function createPostCommentsHandler(app: FastifyInstance) {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const pagination = parsePaginationQuery(request.query);
    if (!pagination.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid pagination parameters', pagination.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const { pageNum, limitNum } = pagination.data;
    const userId = request.user!.id;

    try {
      const post = await loadAuthorizedPost({ postId, userId, reply });
      if (!post) {
        return;
      }
      if (post.status !== 'published') {
        return reply.send(paginatedResponse([], pageNum, limitNum, 0));
      }

      const publicationId = parsePublicationId(request.query);
      const publication = await findPostPublication({
        postId,
        publicationId,
        targetSocialAccountId: post.targetSocialAccountId,
      });
      if (!publication?.externalPostId) {
        if (publicationId) {
          return reply.code(404).send(ErrorResponses.notFound('Publication'));
        }
        return reply.send(paginatedResponse([], pageNum, limitNum, 0));
      }

      const result = await loadCommentsForPublication({
        publicationId: publication.id,
        platform: publication.platform,
        socialAccountId: publication.socialAccountId,
        externalPostId: String(publication.externalPostId),
        page: pageNum,
        limit: limitNum,
        refresh: parseRefreshFlag(request.query),
        freshnessTtlMs: commentsFreshnessTtlMs,
        log: request.log,
      });

      return reply.send(paginatedResponse(result.comments, pageNum, limitNum, result.total));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An unknown error occurred';
      app.log.error({ message }, 'Error fetching post comments');
      return reply.code(500).send(ErrorResponses.internalError('Failed to fetch post comments'));
    }
  };
}

export function registerPostCommentsRoute(app: FastifyInstance) {
  app.get<{ Params: PostDetailParams }>(
    '/api/posts/:postId/comments',
    createPostCommentsHandler(app)
  );
}
