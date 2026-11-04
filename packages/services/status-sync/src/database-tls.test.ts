import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProxyPoolConfig } from '@postolio/database/lambda';

const credentials = { username: 'u', password: 'p' };

describe('buildProxyPoolConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('verifies the proxy TLS certificate by default', () => {
    const config = buildProxyPoolConfig('proxy.example:6432', 'postolio', credentials);

    expect(config).toMatchObject({ host: 'proxy.example', port: 6432, database: 'postolio' });
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('only skips verification through the explicit rollback flag', () => {
    vi.stubEnv('DB_TLS_REJECT_UNAUTHORIZED', 'false');

    expect(buildProxyPoolConfig('proxy.example', 'postolio', credentials).ssl).toEqual({
      rejectUnauthorized: false,
    });
  });
});
