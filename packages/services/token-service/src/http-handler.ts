import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
} from 'aws-lambda';
import crypto from 'crypto';
import { ServiceError } from '@postolio/errors';
import { getHttpStatusCodeForServiceError } from './errors';
import { checkRateLimit, deleteToken, getToken, rotateToken, storeToken } from './token-operations';
import { logger, metrics } from './runtime';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { PathParameters, RequestContext } from './types';

interface RequestDetails {
  method: string;
  path: string;
  requestContext: RequestContext;
  headers: Record<string, string>;
}

function getHeader(headers: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (headers[key] !== undefined) {
      return headers[key];
    }
  }

  return undefined;
}

function parseRequestDetails(event: APIGatewayProxyEvent | APIGatewayProxyEventV2): RequestDetails {
  const isV2Event =
    event.requestContext &&
    'http' in event.requestContext &&
    typeof event.requestContext.http === 'object';

  const method = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.method
    : (event as APIGatewayProxyEvent).httpMethod;
  const path = isV2Event
    ? (event as APIGatewayProxyEventV2).requestContext.http.path
    : (event as APIGatewayProxyEvent).path;

  const requestId = event.requestContext.requestId || crypto.randomUUID();
  const headers = event.headers || {};
  const correlationId =
    getHeader(headers, 'X-Correlation-ID', 'x-correlation-id') || crypto.randomUUID();
  const ipAddress = isV2Event
    ? ((event as APIGatewayProxyEventV2).requestContext.http?.sourceIp ?? '')
    : ((event as APIGatewayProxyEvent).requestContext.identity?.sourceIp ?? '');

  return {
    method,
    path,
    headers,
    requestContext: {
      requestId,
      correlationId,
      ipAddress,
      userAgent: getHeader(headers, 'User-Agent', 'user-agent'),
    },
  };
}

function parsePathParameters(path: string): PathParameters {
  const params: PathParameters = {};
  const parts = path.split('/').filter(Boolean);

  if (parts[0] !== 'tokens' || !parts[1] || ['batch', 'health', 'metrics'].includes(parts[1])) {
    return params;
  }

  params.userId = parts[1];
  if (parts[2]) {
    params.platform = parts[2];
  }

  if (parts[3]) {
    params.brandId = parts[3];
  }

  if (parts[4] === 'social-accounts') {
    if (parts[5]) {
      params.socialAccountId = parts[5];
    }
    if (parts[6]) {
      params.action = parts[6];
    }
    return params;
  }

  if (parts[4]) {
    params.action = parts[4];
  }

  return params;
}

function buildResponseHeaders(details: RequestDetails): {
  headers: Record<string, string>;
  origin: string;
  isOriginAllowed: boolean;
} {
  const origin = getHeader(details.headers, 'Origin', 'origin') || '';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  const defaultAllowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://postolio.example',
    'https://postolio.example',
  ];

  const originsToCheck = allowedOrigins.length > 0 ? allowedOrigins : defaultAllowedOrigins;
  const isOriginAllowed = origin.length > 0 && originsToCheck.includes(origin);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': details.requestContext.requestId,
    'X-Correlation-ID': details.requestContext.correlationId,
  };

  if (isOriginAllowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Correlation-ID';
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return { headers, origin, isOriginAllowed };
}

function jsonResponse(
  statusCode: number,
  headers: Record<string, string>,
  body: Record<string, unknown> | string
): APIGatewayProxyResult {
  return {
    statusCode,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function getEventBody(
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Record<string, unknown> {
  return JSON.parse(event.body || '{}') as Record<string, unknown>;
}

function buildHealthResponse(headers: Record<string, string>): APIGatewayProxyResult {
  return jsonResponse(200, headers, {
    status: 'healthy',
    service: 'token-service',
    version: '3.0.0',
    features: {
      encryption: true,
      rateLimit: true,
      auditLogging: true,
      tokenRotation: true,
    },
    timestamp: new Date().toISOString(),
  });
}

async function handleAccountScopedRoutes(
  method: string,
  pathParams: PathParameters,
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  requestContext: RequestContext,
  responseHeaders: Record<string, string>
): Promise<APIGatewayProxyResult | null> {
  const hasRequiredScope =
    pathParams.userId &&
    pathParams.platform &&
    pathParams.brandId &&
    pathParams.socialAccountId &&
    !pathParams.action;

  if (!hasRequiredScope) {
    return null;
  }

  const tokenScope = {
    userId: pathParams.userId,
    platform: pathParams.platform,
    brandId: pathParams.brandId,
    socialAccountId: pathParams.socialAccountId,
  };

  if (method === 'PUT') {
    await storeToken(
      { ...tokenScope, ...(getEventBody(event) as Record<string, unknown>) },
      requestContext
    );
    return jsonResponse(200, responseHeaders, { success: true });
  }

  if (method === 'GET') {
    const token = await getToken(tokenScope, requestContext);
    return token
      ? jsonResponse(200, responseHeaders, token)
      : jsonResponse(404, responseHeaders, { error: 'Token not found' });
  }

  if (method === 'DELETE') {
    const deleted = await deleteToken(tokenScope, requestContext);
    return deleted
      ? jsonResponse(200, responseHeaders, { success: true })
      : jsonResponse(404, responseHeaders, { error: 'Token not found' });
  }

  return null;
}

async function handleBrandScopedRoutes(
  method: string,
  pathParams: PathParameters,
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2,
  requestContext: RequestContext,
  responseHeaders: Record<string, string>
): Promise<APIGatewayProxyResult | null> {
  const hasRequiredScope =
    pathParams.userId && pathParams.platform && pathParams.brandId && !pathParams.action;

  if (!hasRequiredScope) {
    return null;
  }

  const tokenScope = {
    userId: pathParams.userId,
    platform: pathParams.platform,
    brandId: pathParams.brandId,
  };

  if (method === 'PUT') {
    await storeToken(
      { ...tokenScope, ...(getEventBody(event) as Record<string, unknown>) },
      requestContext
    );
    return jsonResponse(200, responseHeaders, { success: true });
  }

  if (method === 'GET') {
    const token = await getToken(tokenScope, requestContext);
    return token
      ? jsonResponse(200, responseHeaders, token)
      : jsonResponse(404, responseHeaders, { error: 'Token not found' });
  }

  if (method === 'DELETE') {
    const deleted = await deleteToken(tokenScope, requestContext);
    return deleted
      ? jsonResponse(200, responseHeaders, { success: true })
      : jsonResponse(404, responseHeaders, { error: 'Token not found' });
  }

  return null;
}

async function handleRotateRoute(
  method: string,
  pathParams: PathParameters,
  requestContext: RequestContext,
  responseHeaders: Record<string, string>
): Promise<APIGatewayProxyResult | null> {
  if (method !== 'POST' || pathParams.action !== 'rotate') {
    return null;
  }

  const hasScope = pathParams.userId && pathParams.brandId && pathParams.platform;
  if (!hasScope) {
    return jsonResponse(400, responseHeaders, {
      error: 'Missing required path parameters for token rotation',
      code: 'VALIDATION_FAILED',
    });
  }

  const rotatedToken = await rotateToken(
    {
      userId: pathParams.userId,
      brandId: pathParams.brandId,
      platform: pathParams.platform,
      socialAccountId: pathParams.socialAccountId,
    },
    requestContext
  );

  return jsonResponse(200, responseHeaders, rotatedToken);
}

function handleServiceError(
  error: unknown,
  responseHeaders: Record<string, string>,
  requestContext: RequestContext
): APIGatewayProxyResult {
  if (error instanceof ServiceError) {
    const headers = { ...responseHeaders };
    if (error.code === 'RATE_LIMITED' && error.details?.retryAfterSeconds) {
      headers['Retry-After'] = error.details.retryAfterSeconds.toString();
    }

    return jsonResponse(getHttpStatusCodeForServiceError(error), headers, {
      error: error.message,
      code: error.code,
      retryable: error.retryable ?? false,
      requestId: requestContext.requestId,
      correlationId: requestContext.correlationId,
    });
  }

  return jsonResponse(500, responseHeaders, {
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    retryable: true,
    requestId: requestContext.requestId,
    correlationId: requestContext.correlationId,
  });
}

export const handler = async (
  event: APIGatewayProxyEvent | APIGatewayProxyEventV2
): Promise<APIGatewayProxyResult> => {
  const requestDetails = parseRequestDetails(event);
  const {
    headers: responseHeaders,
    origin,
    isOriginAllowed,
  } = buildResponseHeaders(requestDetails);

  logger.info('Request received', {
    path: requestDetails.path,
    method: requestDetails.method,
    requestId: requestDetails.requestContext.requestId,
    correlationId: requestDetails.requestContext.correlationId,
    ipAddress: requestDetails.requestContext.ipAddress,
  });

  if (origin.length > 0 && !isOriginAllowed && requestDetails.path !== '/health') {
    logger.warn('Request from disallowed origin rejected', {
      origin,
      path: requestDetails.path,
    });
    return jsonResponse(403, responseHeaders, {
      error: 'Origin not allowed',
      code: 'CORS_ORIGIN_NOT_ALLOWED',
    });
  }

  try {
    if (requestDetails.method === 'OPTIONS') {
      return { statusCode: 200, headers: responseHeaders, body: '' };
    }

    if (requestDetails.path === '/health' && requestDetails.method === 'GET') {
      return buildHealthResponse(responseHeaders);
    }

    const pathParams = parsePathParameters(requestDetails.path);
    if (pathParams.userId) {
      await checkRateLimit(pathParams.userId, pathParams.platform);
    }

    const accountScopedResponse = await handleAccountScopedRoutes(
      requestDetails.method,
      pathParams,
      event,
      requestDetails.requestContext,
      responseHeaders
    );
    if (accountScopedResponse) {
      return accountScopedResponse;
    }

    const brandScopedResponse = await handleBrandScopedRoutes(
      requestDetails.method,
      pathParams,
      event,
      requestDetails.requestContext,
      responseHeaders
    );
    if (brandScopedResponse) {
      return brandScopedResponse;
    }

    const rotateResponse = await handleRotateRoute(
      requestDetails.method,
      pathParams,
      requestDetails.requestContext,
      responseHeaders
    );
    if (rotateResponse) {
      return rotateResponse;
    }

    return jsonResponse(404, responseHeaders, { error: 'Endpoint not found' });
  } catch (error) {
    logger.error('Request failed', {
      error,
      requestId: requestDetails.requestContext.requestId,
      correlationId: requestDetails.requestContext.correlationId,
    });

    metrics.addMetric('RequestErrors', MetricUnit.Count, 1);
    return handleServiceError(error, responseHeaders, requestDetails.requestContext);
  } finally {
    metrics.publishStoredMetrics();
  }
};
