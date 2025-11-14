import type { TokenData } from '../types/token-service.js';
import { getTokenService } from '../services/service-clients.js';

/**
 * Backwards-compatible token fetch helper for routes.
 *
 * In production this delegates to the TokenServiceClient via service-clients.
 * In tests, this module is mocked in route tests to avoid real network calls.
 */
export async function fetchTokensFromService(
  userId: string,
  brandId: string,
  platform: string
): Promise<TokenData | null> {
  const client = await getTokenService();
  return client.getToken(userId, brandId, platform);
}
