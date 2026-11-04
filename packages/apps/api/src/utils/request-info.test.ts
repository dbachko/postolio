import { describe, expect, it } from 'vitest';
import fastify from 'fastify';
import { createTrustProxy, getClientIp } from './request-info.js';

async function clientIpSeenBehind(hops: string, xForwardedFor: string) {
  const app = fastify({ trustProxy: createTrustProxy(hops) });
  app.get('/', async (request) => ({ ip: getClientIp(request) }));
  const response = await app.inject({
    url: '/',
    headers: { 'x-forwarded-for': xForwardedFor, 'x-real-ip': '198.51.100.9' },
    remoteAddress: '10.0.0.1',
  });
  await app.close();
  return response.json().ip;
}

describe('getClientIp', () => {
  it('ignores a forged entry behind nginx', async () => {
    expect(await clientIpSeenBehind('1', '203.0.113.66, 192.0.2.10')).toBe('192.0.2.10');
  });

  it('ignores a forged entry behind CloudFront and the ALB', async () => {
    expect(await clientIpSeenBehind('2', '203.0.113.66, 192.0.2.10, 130.176.0.1')).toBe(
      '192.0.2.10'
    );
  });
});

describe('createTrustProxy', () => {
  it.each([undefined, '', 'nonsense', '-1'])('trusts one proxy when configured as %j', (env) => {
    const trust = createTrustProxy(env);
    expect(trust('10.0.0.1', 0)).toBe(true);
    expect(trust('10.0.0.1', 1)).toBe(false);
  });
});
