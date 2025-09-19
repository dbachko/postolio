export type AwsSignerService = 'lambda' | 'execute-api';

export interface AwsSignerTarget {
  service: AwsSignerService;
  region: string;
}

const DEFAULT_REGION = 'us-east-1';

function resolveFallbackRegion(): string {
  const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_REGION;
  return envRegion || DEFAULT_REGION;
}

function parseHostname(input: string | URL): string | null {
  try {
    if (input instanceof URL) {
      return input.hostname;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return null;
    }

    if (/^[a-z]+:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname;
    }

    return trimmed.split('/')[0];
  } catch {
    return null;
  }
}

export function resolveAwsServiceTarget(
  input: string | URL,
  fallbackRegion: string = resolveFallbackRegion()
): AwsSignerTarget {
  const hostname = parseHostname(input)?.toLowerCase();
  const safeFallback = fallbackRegion || DEFAULT_REGION;

  if (!hostname) {
    return { service: 'execute-api', region: safeFallback };
  }

  const lambdaMatch = hostname.match(/^[a-z0-9-]+\.lambda-url(?:-fips)?\.([a-z0-9-]+)\.on\.aws$/);
  if (lambdaMatch && lambdaMatch[1]) {
    return { service: 'lambda', region: lambdaMatch[1] };
  }

  const apiGatewayMatch = hostname.match(
    /^[a-z0-9-]+\.execute-api\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$/
  );
  if (apiGatewayMatch && apiGatewayMatch[1]) {
    return { service: 'execute-api', region: apiGatewayMatch[1] };
  }

  return { service: 'execute-api', region: safeFallback };
}
