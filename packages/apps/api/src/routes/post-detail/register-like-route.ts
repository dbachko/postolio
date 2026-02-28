import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import { likePlatformComment } from './comment-actions-service.js';
import {
  findPostPublication,
  loadAuthorizedPost,
  parsePublicationId,
  validatePostParams,
  type PostDetailParams,
} from './shared.js';

function createPostLikeCommentHandler() {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const { commentId } = request.params as { postId: string; commentId: string };

    try {
      const post = await loadAuthorizedPost({
        postId,
        userId: request.user!.id,
        reply,
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

      const result = await likePlatformComment({
        platform: publication.platform,
        socialAccountId: publication.socialAccountId,
        commentId,
      });

      return reply.send(successResponse(result));
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      if (/not support|unsupported|not allowed/i.test(messageText)) {
        return reply.code(400).send(ErrorResponses.badRequest(messageText));
      }
      return reply
        .code(500)
        .send(ErrorResponses.internalError(`Failed to like comment: ${messageText}`));
    }
  };
}

export function registerPostLikeCommentRoute(app: FastifyInstance) {
  app.post<{ Params: PostDetailParams & { commentId: string } }>(
    '/api/posts/:postId/comments/:commentId/like',
    createPostLikeCommentHandler()
  );
}
