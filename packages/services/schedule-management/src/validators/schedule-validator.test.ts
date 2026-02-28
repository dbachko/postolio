import { describe, expect, it } from 'vitest';

import { validatePublishNowRequest, validateScheduleRequest } from './schedule-validator';

const DEFAULT_MEDIA_ASSET = {
  key: 'images/2025-01-01/brand/content-123-abcd.jpg',
  type: 'image',
  order: 0,
};

function hoursFromNowIso(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function buildValidScheduleRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    contentId: 'content-123',
    brandId: 'brand-789',
    userId: 'user-012',
    platform: 'instagram',
    contentType: 'post',
    mediaType: 'image',
    scheduledAt: hoursFromNowIso(1),
    mediaAssets: [DEFAULT_MEDIA_ASSET],
    ...overrides,
  };
}

describe('validateScheduleRequest required fields', () => {
  it('should validate a complete valid schedule request', () => {
    const request = buildValidScheduleRequest({
      caption: 'Test content',
      hashtags: ['test', 'content'],
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should validate minimal required fields only', () => {
    const request = buildValidScheduleRequest();

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject request with missing required fields', () => {
    const invalidRequest = {
      contentId: 'content-123',
    };

    const result = validateScheduleRequest(invalidRequest);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((error) => error.includes('brandId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('userId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('platform'))).toBe(true);
    expect(result.errors.some((error) => error.includes('contentType'))).toBe(true);
    expect(result.errors.some((error) => error.includes('scheduledAt'))).toBe(true);
  });

  it('should reject empty strings for required fields', () => {
    const invalidRequest = buildValidScheduleRequest({
      contentId: '',
      brandId: '',
      userId: '',
    });

    const result = validateScheduleRequest(invalidRequest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('contentId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('brandId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('userId'))).toBe(true);
  });
});

describe('validateScheduleRequest enums and dates', () => {
  it('should reject invalid platform values', () => {
    const request = buildValidScheduleRequest({
      platform: 'invalid-platform',
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('platform'))).toBe(true);
  });

  it('should reject past scheduledAt dates', () => {
    const request = buildValidScheduleRequest({
      scheduledAt: hoursFromNowIso(-1),
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('future'))).toBe(true);
  });

  it('should reject invalid ISO date strings', () => {
    const request = buildValidScheduleRequest({
      scheduledAt: 'not-a-date',
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('valid ISO'))).toBe(true);
  });

  it('should accept all valid platforms', () => {
    const platforms = ['instagram', 'facebook', 'twitter', 'linkedin'];

    platforms.forEach((platform) => {
      const result = validateScheduleRequest(buildValidScheduleRequest({ platform }));
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  it('should validate content types correctly', () => {
    const validContentTypes = ['post', 'reel', 'story'];

    validContentTypes.forEach((contentType) => {
      const result = validateScheduleRequest(buildValidScheduleRequest({ contentType }));
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  it('should reject invalid content types', () => {
    const request = buildValidScheduleRequest({
      contentType: 'invalid-type',
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('contentType'))).toBe(true);
  });
});

describe('validateScheduleRequest optional fields and arrays', () => {
  it('should validate array fields correctly', () => {
    const request = buildValidScheduleRequest({
      hashtags: ['tag1', 'tag2', 'tag3'],
      mediaAssets: [
        { key: 'images/2025-01-01/brand/img1.jpg', type: 'image', order: 0 },
        { key: 'images/2025-01-01/brand/img2.jpg', type: 'image', order: 1 },
      ],
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept a valid firstComment within length limits', () => {
    const request = buildValidScheduleRequest({
      firstComment: 'This is a first comment with hashtags #one #two',
    });

    const result = validateScheduleRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject non-string or overly long firstComment', () => {
    const tooLong = 'x'.repeat(2201);
    const nonStringRequest = buildValidScheduleRequest({
      // @ts-expect-error intentional invalid type for test
      firstComment: 123,
    });

    const nonStringResult = validateScheduleRequest(nonStringRequest);
    expect(nonStringResult.valid).toBe(false);
    expect(nonStringResult.errors.some((error) => error.includes('firstComment'))).toBe(true);

    const tooLongResult = validateScheduleRequest(
      buildValidScheduleRequest({ firstComment: tooLong })
    );
    expect(tooLongResult.valid).toBe(false);
    expect(tooLongResult.errors.some((error) => error.includes('firstComment'))).toBe(true);
  });

  it('should reject invalid array elements', () => {
    const invalidRequest = buildValidScheduleRequest({
      hashtags: ['valid', 123, 'another-valid'],
      mediaAssets: [{ key: 'images/2025-01-01/brand/img.jpg', type: 'image', order: 0 }, null],
    });

    const result = validateScheduleRequest(invalidRequest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('hashtags'))).toBe(true);
    expect(result.errors.some((error) => error.includes('mediaAssets'))).toBe(true);
  });
});

describe('validatePublishNowRequest', () => {
  it('should validate a minimal publish-now request without scheduledAt', () => {
    const request = buildValidScheduleRequest();

    const result = validatePublishNowRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should allow a past scheduledAt value if provided (ignored by service)', () => {
    const request = buildValidScheduleRequest({
      scheduledAt: hoursFromNowIso(-1),
    });

    const result = validatePublishNowRequest(request);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject request with missing required fields (but not require scheduledAt)', () => {
    const invalidRequest = {
      contentId: 'content-123',
    };

    const result = validatePublishNowRequest(invalidRequest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('brandId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('userId'))).toBe(true);
    expect(result.errors.some((error) => error.includes('platform'))).toBe(true);
    expect(result.errors.some((error) => error.includes('contentType'))).toBe(true);
    expect(result.errors.some((error) => error.includes('scheduledAt'))).toBe(false);
  });
});
