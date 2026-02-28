import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import {
  acquireReplyIdempotencyLock,
  releaseReplyIdempotencyLock,
  sendPlatformCommentReply,
} from './comment-actions-service.js';
import {
  extractTrimmedMessage,
  findPostPublication,
  loadAuthorizedPost,
  parsePublicationId,
  validatePostParams,
  type PostDetailParams,
} from './shared.js';

function createPostReplyHandler() {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const { commentId } = request.params as { postId: string; commentId: string };
    const message = extractTrimmedMessage(request.body);
    if (!message) {
      return reply.code(400).send(ErrorResponses.badRequest('Message must not be empty'));
    }

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
      if (!publication?.externalPostId) {
        return reply.code(400).send(ErrorResponses.badRequest('Publication not found'));
      }

      const lock = await acquireReplyIdempotencyLock({
        externalPostId: String(publication.externalPostId),
        commentId,
        message,
      });
      if (lock.deduped) {
        return reply.send(successResponse({ deduped: true }));
      }

      try {
        const result = await sendPlatformCommentReply({
          platform: publication.platform,
          socialAccountId: publication.socialAccountId,
          externalPostId: String(publication.externalPostId),
          commentId,
          message,
        });
        return reply.send(successResponse(result));
      } catch (error: unknown) {
        await releaseReplyIdempotencyLock(lock);
        throw error;
      }
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      return reply.code(500).send(ErrorResponses.internalError(`Failed to reply: ${messageText}`));
    }
  };
}

export function registerPostReplyRoute(app: FastifyInstance) {
  app.post<{ Params: PostDetailParams & { commentId: string }; Body: { message: string } }>(
    '/api/posts/:postId/comments/:commentId/reply',
    createPostReplyHandler()
  );
}
