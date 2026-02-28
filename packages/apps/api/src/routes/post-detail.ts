import type { FastifyPluginAsync } from 'fastify';

import { registerPostCommentsRoute } from './post-detail/register-comments-route.js';
import { registerPostInsightsRoute } from './post-detail/register-insights-route.js';
import { registerPostLikeCommentRoute } from './post-detail/register-like-route.js';
import { registerPostMarkAllReadRoute } from './post-detail/register-mark-all-read-route.js';
import { registerPostReplyRoute } from './post-detail/register-reply-route.js';
import { registerPostDetailRoute } from './post-detail/register-post-route.js';
import { registerPostWorkflowRoute } from './post-detail/register-workflow-route.js';

const postDetailRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  registerPostDetailRoute(app);
  registerPostInsightsRoute(app);
  registerPostCommentsRoute(app);
  registerPostReplyRoute(app);
  registerPostWorkflowRoute(app);
  registerPostLikeCommentRoute(app);
  registerPostMarkAllReadRoute(app);
};

export default postDetailRoutes;
