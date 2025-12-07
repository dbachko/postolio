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

  it('preserves campaign domain codes like CAMPAIGN_INVALID_DATES', async () => {
    const app = buildApp();

    app.get('/test-campaign-invalid-dates', async () => {
      throw new APIError('End date must be after start date', 'CAMPAIGN_INVALID_DATES', 400, {
        campaignId: 'camp-123',
      });
    });

    const res = await app.inject({
      method: 'GET',
      url: '/test-campaign-invalid-dates',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      code: string;
      details?: Record<string, unknown>;
    };

    expect(body.code).toBe('CAMPAIGN_INVALID_DATES');
    expect(body.error).toBe('End date must be after start date');
    expect(body.details).toMatchObject({ campaignId: 'camp-123' });
  });
});
