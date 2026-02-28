import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import { upsertCommentWorkflowStatus } from './comment-actions-service.js';
import {
  type CommentWorkflowStatus,
  findPostPublication,
  loadAuthorizedPost,
  parsePublicationId,
  validatePostParams,
  type PostDetailParams,
} from './shared.js';

function createPostWorkflowHandler() {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const { commentId } = request.params as { postId: string; commentId: string };
    const status = (request.body as { status?: CommentWorkflowStatus } | undefined)?.status;

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

      const result = await upsertCommentWorkflowStatus({
        publicationId: publication.id,
        platform: publication.platform,
        commentId,
        status,
      });

      return reply.send(successResponse(result));
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : 'Unknown error';
      return reply
        .code(500)
        .send(ErrorResponses.internalError(`Failed to update workflow: ${messageText}`));
    }
  };
}

export function registerPostWorkflowRoute(app: FastifyInstance) {
  app.post<{
    Params: PostDetailParams & { commentId: string };
    Body: { status?: CommentWorkflowStatus };
  }>('/api/posts/:postId/comments/:commentId/workflow', createPostWorkflowHandler());
}
