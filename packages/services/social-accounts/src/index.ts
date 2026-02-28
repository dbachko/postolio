/**
 * Social Accounts Service (Lambda handler scaffold)
 *
 * Greenfield: intended to become the single source of truth for social account connections,
 * candidates, and lifecycle events.
 */

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
} from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics } from '@aws-lambda-powertools/metrics';
import { initSentry } from '@postolio/observability';
import { handleHttpRequest } from './handlers/http-handler';

const logger = new Logger({ serviceName: 'social-accounts' });
const metrics = new Metrics({
  namespace: 'Postolio/SocialAccounts',
  serviceName: 'social-accounts',
});

initSentry({
  serviceName: 'social-accounts',
});

export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  return handleHttpRequest(event, logger, metrics);
};
