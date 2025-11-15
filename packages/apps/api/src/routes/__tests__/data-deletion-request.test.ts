import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildFastify } from '../../server.js';

const TEST_EMAIL = 'deletion-test@example.com';

describe('Public data deletion request flow', () => {
  const app = buildFastify();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 for missing email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/legal/data-deletion-request',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
