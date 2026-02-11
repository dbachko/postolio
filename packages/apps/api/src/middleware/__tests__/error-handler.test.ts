import Fastify from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { APIError } from '@postolio/errors';
import { errorHandler } from '../error-handler.js';

describe('errorHandler', () => {
  const buildApp = () => {
    const app = Fastify();
    app.setErrorHandler(errorHandler as any);
    return app;
  };

  it('maps APIError to standardized JSON with code, message, details', async () => {
    const app = buildApp();

    app.get('/test-brand-not-found', async () => {
      throw new APIError('Brand not found or access denied', 'BRAND_NOT_FOUND', 404, {
        brandId: 'brand-123',
      });
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test-brand-not-found',
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as {
      error: string;
      code: string;
      details?: Record<string, unknown>;
      correlationId?: string;
    };

    expect(body.code).toBe('BRAND_NOT_FOUND');
    expect(body.error).toBe('Brand not found or access denied');
    expect(body.details).toMatchObject({ brandId: 'brand-123' });
    expect(body.correlationId).toBeDefined();
  });

  it('preserves domain-specific error codes', async () => {
    const app = buildApp();

    app.get('/test-content-invalid-schedule', async () => {
      throw new APIError('Scheduled time must be in the future', 'CONTENT_INVALID_SCHEDULE', 400, {
        contentId: 'content-123',
      });
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test-content-invalid-schedule',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      code: string;
      details?: Record<string, unknown>;
    };

    expect(body.code).toBe('CONTENT_INVALID_SCHEDULE');
    expect(body.error).toBe('Scheduled time must be in the future');
    expect(body.details).toMatchObject({ contentId: 'content-123' });
  });
});
