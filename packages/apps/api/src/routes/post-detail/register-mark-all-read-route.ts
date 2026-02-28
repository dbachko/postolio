import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import { markCommentsResolved } from './comment-actions-service.js';
import {
  findPostPublication,
  loadAuthorizedPost,
  parseCommentIds,
  parsePublicationId,
  validatePostParams,
  type PostDetailParams,
} from './shared.js';

function createPostMarkAllReadHandler() {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const commentIds = parseCommentIds(request.body);

    try {
      const post = await loadAuthorizedPost({
        postId,
        userId: request.user!.id,
        reply,
        requirePublished: true,
      });
      if (!post) {
        return;
      }

      const publication = await findPostPublication({
        postId,
        publicationId: parsePublicationId(request.query),
        targetSocialAccountId: post.targetSocialAccountId,
      });
      if (!publication) {
        return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
      }

      const marked = await markCommentsResolved({
        publicationId: publication.id,
        platform: publication.platform,
        commentIds,
      });

      return reply.send(successResponse({ success: true, marked }));
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      return reply
        .code(500)
        .send(ErrorResponses.internalError(`Failed to mark all read: ${messageText}`));
    }
  };
}

export function registerPostMarkAllReadRoute(app: FastifyInstance) {
  app.post<{ Params: PostDetailParams; Body: { commentIds?: string[] } }>(
    '/api/posts/:postId/comments/mark-all-read',
    createPostMarkAllReadHandler()
  );
}
