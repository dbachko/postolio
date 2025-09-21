import { describe, it, expect } from 'vitest';
import { validateScheduleRequest } from './schedule-validator';

describe('Schedule Validator', () => {
  describe('validateScheduleRequest', () => {
    it('should validate a complete valid schedule request', () => {
      const validRequest = {
        contentId: 'content-123',
        campaignId: 'campaign-456',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        caption: 'Test content',
        hashtags: ['test', 'content'],
        mediaUrls: ['https://example.com/image.jpg'],
      };

      const result = validateScheduleRequest(validRequest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should validate minimal required fields only', () => {
      const minimalRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const result = validateScheduleRequest(minimalRequest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject request with missing required fields', () => {
      const invalidRequest = {
        contentId: 'content-123',
        // missing brandId, userId, platform, contentType, scheduledAt
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

    it('should reject invalid platform values', () => {
      const invalidRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'invalid-platform',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('platform'))).toBe(true);
    });

    it('should reject past scheduledAt dates', () => {
      const invalidRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('future'))).toBe(true);
    });

    it('should reject invalid ISO date strings', () => {
      const invalidRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: 'not-a-date',
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('valid ISO'))).toBe(true);
    });

    it('should accept all valid platforms', () => {
      const platforms = ['instagram', 'facebook', 'twitter', 'linkedin'];

      platforms.forEach((platform) => {
        const request = {
          contentId: 'content-123',
          brandId: 'brand-789',
          userId: 'user-012',
          platform,
          contentType: 'image',
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        };

        const result = validateScheduleRequest(request);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    it('should validate array fields correctly', () => {
      const requestWithArrays = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        hashtags: ['tag1', 'tag2', 'tag3'],
        mediaUrls: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      };

      const result = validateScheduleRequest(requestWithArrays);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should reject empty strings for required fields', () => {
      const invalidRequest = {
        contentId: '',
        brandId: '',
        userId: '',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('contentId'))).toBe(true);
      expect(result.errors.some((error) => error.includes('brandId'))).toBe(true);
      expect(result.errors.some((error) => error.includes('userId'))).toBe(true);
    });

    it('should validate content types correctly', () => {
      const validContentTypes = ['image', 'video', 'carousel', 'reel', 'story'];

      validContentTypes.forEach((contentType) => {
        const request = {
          contentId: 'content-123',
          brandId: 'brand-789',
          userId: 'user-012',
          platform: 'instagram',
          contentType,
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        };

        const result = validateScheduleRequest(request);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    it('should reject invalid content types', () => {
      const invalidRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'invalid-type',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('contentType'))).toBe(true);
    });

    it('should reject invalid array elements', () => {
      const invalidRequest = {
        contentId: 'content-123',
        brandId: 'brand-789',
        userId: 'user-012',
        platform: 'instagram',
        contentType: 'image',
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        hashtags: ['valid', 123, 'another-valid'], // 123 is not a string
        mediaUrls: ['https://example.com/image.jpg', null], // null is not a string
      };

      const result = validateScheduleRequest(invalidRequest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('hashtags'))).toBe(true);
      expect(result.errors.some((error) => error.includes('mediaUrls'))).toBe(true);
    });
  });
});
