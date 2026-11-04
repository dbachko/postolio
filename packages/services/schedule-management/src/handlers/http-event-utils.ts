import type {
  APIGatewayProxyEvent,
  APIGatewayProxyEventV2,
  APIGatewayProxyResult,
} from 'aws-lambda';

type ApiEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;

export function getMethod(event: ApiEvent): string {
  if ('httpMethod' in event) {
    return event.httpMethod;
  }

  return event.requestContext.http.method;
}

export function getPath(event: ApiEvent): string {
  if ('path' in event) {
    return event.path;
  }

  return event.requestContext.http.path;
}

export function getBody(event: ApiEvent): string {
  return event.body || '{}';
}

export function getQueryParams(event: ApiEvent): Record<string, string> {
  const rawParams =
    'queryStringParameters' in event
      ? event.queryStringParameters
      : (event.queryStringParameters ?? null);

  if (!rawParams) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawParams).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}
