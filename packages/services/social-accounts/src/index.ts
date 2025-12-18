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

const logger = new Logger({ serviceName: 'social-accounts' });
const metrics = new Metrics({
  namespace: 'Postolio/SocialAccounts',
  serviceName: 'social-accounts',
});

initSentry({
  serviceName: 'social-accounts',
});

function json(
  statusCode: number,
  body: unknown,
  headers?: Record<string, string>
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...(headers || {}),
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  const isV2Event = !!(
    event.requestContext &&
    'http' in event.requestContext &&
    typeof event.requestContext.http === 'object'
  );

  const method = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.method
    : (event as APIGatewayProxyEvent).httpMethod;

  const path = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.path
    : (event as APIGatewayProxyEvent).path;

  logger.info('Request received', { method, path });
  metrics.addMetadata('path', path);
  metrics.addMetadata('method', method);

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: {}, body: '' };
  }

  if (path === '/health' && method === 'GET') {
    return json(200, {
      status: 'healthy',
      service: 'social-accounts',
      version: '0.0.0',
      timestamp: new Date().toISOString(),
    });
  }

  const matchBrandSocialAccounts = path.match(/^\/brands\/([^/]+)\/social-accounts$/);
  if (matchBrandSocialAccounts && method === 'GET') {
    const brandId = matchBrandSocialAccounts[1];
    return json(501, {
      error: 'not_implemented',
      message: 'List social accounts not implemented yet.',
      brandId,
    });
  }

  const matchMetaStart = path.match(/^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/start$/);
  if (matchMetaStart && method === 'POST') {
    const brandId = matchMetaStart[1];
    return json(501, {
      error: 'not_implemented',
      message: 'Meta connect start not implemented yet.',
      brandId,
    });
  }

  const matchMetaCallback = path.match(
    /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/callback$/
  );
  if (matchMetaCallback && method === 'GET') {
    const brandId = matchMetaCallback[1];
    return json(501, {
      error: 'not_implemented',
      message: 'Meta OAuth callback not implemented yet.',
      brandId,
    });
  }

  const matchMetaCandidates = path.match(
    /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/candidates$/
  );
  if (matchMetaCandidates && method === 'GET') {
    const brandId = matchMetaCandidates[1];
    return json(501, {
      error: 'not_implemented',
      message: 'Meta connect candidates not implemented yet.',
      brandId,
    });
  }

  const matchMetaFinalize = path.match(
    /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/finalize$/
  );
  if (matchMetaFinalize && method === 'POST') {
    const brandId = matchMetaFinalize[1];
    return json(501, {
      error: 'not_implemented',
      message: 'Meta connect finalize not implemented yet.',
      brandId,
    });
  }

  return json(501, {
    error: 'not_implemented',
    message: 'Social Accounts Service scaffold: endpoints not implemented yet.',
    path,
    method,
  });
};
