import type { FastifyInstance } from 'fastify';

import { ErrorResponses, successResponse } from '../../utils/api-response.js';

import { fetchPostDetailForUser } from './post-detail-response.js';
import { validatePostParams, type PostDetailParams } from './shared.js';

function createPostDetailHandler(app: FastifyInstance) {
  return async (request: any, reply: any) => {
    const paramsValidation = validatePostParams(request.params);
    if (!paramsValidation.success) {
      return reply
        .code(400)
        .send(ErrorResponses.badRequest('Invalid request parameters', paramsValidation.errors));
    }

    const { postId } = paramsValidation.data as PostDetailParams;
    const userId = request.user!.id;

    try {
      const post = await fetchPostDetailForUser({ postId, userId });
      if (!post) {
        return reply.code(404).send(ErrorResponses.notFound('Post'));
      }
      return reply.send(successResponse(post));
    } catch (error: unknown) {
      app.log.error({ err: error, postId }, 'Error fetching post detail');
      throw error;
    }
  };
}

export function registerPostDetailRoute(app: FastifyInstance) {
  app.get<{ Params: PostDetailParams }>('/api/posts/:postId', createPostDetailHandler(app));
}
