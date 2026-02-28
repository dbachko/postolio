import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
} from 'aws-lambda';
import type { Logger } from '@aws-lambda-powertools/logger';
import type { Metrics } from '@aws-lambda-powertools/metrics';

interface RequestContext {
  method: string;
  path: string;
}

interface RouteStub {
  method: string;
  pattern: RegExp;
  message: string;
}

const ROUTE_STUBS: RouteStub[] = [
  {
    method: 'GET',
    pattern: /^\/brands\/([^/]+)\/social-accounts$/,
    message: 'List social accounts not implemented yet.',
  },
  {
    method: 'POST',
    pattern: /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/start$/,
    message: 'Meta connect start not implemented yet.',
  },
  {
    method: 'GET',
    pattern: /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/callback$/,
    message: 'Meta OAuth callback not implemented yet.',
  },
  {
    method: 'GET',
    pattern: /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/candidates$/,
    message: 'Meta connect candidates not implemented yet.',
  },
  {
    method: 'POST',
    pattern: /^\/brands\/([^/]+)\/social-accounts\/connect\/meta\/finalize$/,
    message: 'Meta connect finalize not implemented yet.',
  },
];

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

function getRequestContext(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): RequestContext {
  const isV2Event =
    event.requestContext &&
    'http' in event.requestContext &&
    typeof event.requestContext.http === 'object';

  if (isV2Event) {
    const v2Event = event as APIGatewayProxyEventV2;
    return {
      method: v2Event.requestContext.http.method,
      path: v2Event.requestContext.http.path,
    };
  }

  const v1Event = event as APIGatewayProxyEvent;
  return {
    method: v1Event.httpMethod,
    path: v1Event.path,
  };
}

function matchStubRoute(method: string, path: string): { brandId: string; message: string } | null {
  for (const route of ROUTE_STUBS) {
    if (route.method !== method) {
      continue;
    }

    const match = path.match(route.pattern);
    if (!match) {
      continue;
    }

    return {
      brandId: match[1],
      message: route.message,
    };
  }

  return null;
}

function buildHealthResponse(): APIGatewayProxyResult {
  return json(200, {
    status: 'healthy',
    service: 'social-accounts',
    version: '0.0.0',
    timestamp: new Date().toISOString(),
  });
}

function buildFallbackResponse(method: string, path: string): APIGatewayProxyResult {
  return json(501, {
    error: 'not_implemented',
    message: 'Social Accounts Service scaffold: endpoints not implemented yet.',
    path,
    method,
  });
}

export async function handleHttpRequest(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  logger: Logger,
  metrics: Metrics
): Promise<APIGatewayProxyResult> {
  const { method, path } = getRequestContext(event);

  logger.info('Request received', { method, path });
  metrics.addMetadata('path', path);
  metrics.addMetadata('method', method);

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: {}, body: '' };
  }

  if (path === '/health' && method === 'GET') {
    return buildHealthResponse();
  }

  const stubMatch = matchStubRoute(method, path);
  if (stubMatch) {
    return json(501, {
      error: 'not_implemented',
      message: stubMatch.message,
      brandId: stubMatch.brandId,
    });
  }

  return buildFallbackResponse(method, path);
}
