import { beforeEach, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
const mocks = vi.hoisted(() => ({ storeToken: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock('./token-operations', () => ({
  ...mocks,
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  rotateToken: vi.fn(),
}));
vi.mock('./runtime', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));
import { handler } from './http-handler';
beforeEach(() => vi.clearAllMocks());
it.each(['/tokens/owner/instagram/brand', '/tokens/owner/instagram/brand/social-accounts/account'])(
  'binds token storage to URL scope for %s',
  async (path) => {
    const event = {
      headers: {},
      requestContext: { requestId: 'test', http: { method: 'PUT', path, sourceIp: '127.0.0.1' } },
      body: JSON.stringify({
        userId: 'victim',
        brandId: 'victim-brand',
        platform: 'facebook',
        socialAccountId: 'victim-account',
        accessToken: 'test-only-token',
      }),
    } as unknown as APIGatewayProxyEventV2;
    const response = await handler(event);
    expect(response.statusCode).toBe(200);
    expect(mocks.storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'owner',
        brandId: 'brand',
        platform: 'instagram',
        ...(path.includes('social-accounts') ? { socialAccountId: 'account' } : {}),
      }),
      expect.anything()
    );
  }
);
