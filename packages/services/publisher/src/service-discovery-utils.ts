export function isCloudMapConfigured(): boolean {
  return !!process.env.SERVICE_DISCOVERY_NAMESPACE;
}

export function isLocalUrl(url: string): boolean {
  return url.includes("localhost") || url.includes("127.0.0.1");
}

export function shouldUseServiceDiscovery(
  url: string,
  envVar?: string,
): boolean {
  return !envVar && isCloudMapConfigured() && isLocalUrl(url);
}
