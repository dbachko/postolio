import type { FastifyInstance } from 'fastify';

import { registerCopySlotsFromRoute } from './publishing-queues/register-copy-slots-from-route.js';
import { registerCreateQueueItemRoute } from './publishing-queues/register-create-queue-item-route.js';
import { registerCreateQueueRoute } from './publishing-queues/register-create-queue-route.js';
import { registerDeleteQueueItemRoute } from './publishing-queues/register-delete-queue-item-route.js';
import { registerDeleteQueueRoute } from './publishing-queues/register-delete-queue-route.js';
import { registerListQueueItemsRoute } from './publishing-queues/register-list-queue-items-route.js';
import { registerListQueuesRoute } from './publishing-queues/register-list-queues-route.js';
import { registerListQueueSlotsRoute } from './publishing-queues/register-list-queue-slots-route.js';
import { registerPostingGoalRoute } from './publishing-queues/register-posting-goal-route.js';
import { registerReplaceQueueSlotsRoute } from './publishing-queues/register-replace-queue-slots-route.js';
import { registerSlotInstancesRoute } from './publishing-queues/register-slot-instances-route.js';
import { registerUpdateQueueRoute } from './publishing-queues/register-update-queue-route.js';

export default async function publishingQueuesRoutes(fastify: FastifyInstance) {
  registerListQueuesRoute(fastify);
  registerCreateQueueRoute(fastify);
  registerUpdateQueueRoute(fastify);
  registerDeleteQueueRoute(fastify);
  registerListQueueSlotsRoute(fastify);
  registerReplaceQueueSlotsRoute(fastify);
  registerPostingGoalRoute(fastify);
  registerCopySlotsFromRoute(fastify);
  registerSlotInstancesRoute(fastify);
  registerCreateQueueItemRoute(fastify);
  registerListQueueItemsRoute(fastify);
  registerDeleteQueueItemRoute(fastify);
}
