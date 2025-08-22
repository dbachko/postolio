/**
 * Publisher Content Service Tests
 * Ensures fresh content fetching works correctly for publishing
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { PublisherContentService } from '../src/services/publisher-content.js';
import { getDatabaseClient } from '../src/config/database.js';
import { getRedisClient } from '../src/services/redis.js';

const prisma = getDatabaseClient();

describe('PublisherContentService', () => {
  let testContentId: string;
  let testBrandId: string;
  let testUserId: string;

  beforeEach(async () => {
    // Create test user
    const testUser = await prisma.user.create({
      data: {
        email: 'publisher-test@example.com',
        password: 'hashedpassword',
        name: 'Publisher Test User',
      },
    });
    testUserId = testUser.id;

    // Create test brand
    const testBrand = await prisma.brand.create({
      data: {
        name: 'Test Brand for Publisher',
        userId: testUserId,
        description: 'Test brand for publisher content tests',
      },
    });
    testBrandId = testBrand.id;

    // Create test content
    const testContent = await prisma.content.create({
      data: {
        brandId: testBrandId,
        caption: 'Test content for publisher',
        hashtags: ['#test', '#publisher', '#content'],
        status: 'scheduled',
        cdnImageUrl: 'https://example.com/test-image.jpg',
        generationParams: {
          contentType: 'image',
          theme: 'test'
        }
      },
    });
    testContentId = testContent.id;
  });

  afterEach(async () => {
    // Clean up test data
    await prisma.content.deleteMany({
      where: { brandId: testBrandId },
    });
    await prisma.brand.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.deleteMany({
      where: { id: testUserId },
    });

    // Clear cache
    await PublisherContentService.invalidateContentCache(testContentId);
  });

  test('should fetch fresh content for publishing', async () => {
    const content = await PublisherContentService.getContentForPublishing(testContentId);

    expect(content).toBeTruthy();
    expect(content?.id).toBe(testContentId);
    expect(content?.caption).toBe('Test content for publisher');
    expect(content?.hashtags).toEqual(['#test', '#publisher', '#content']);
    expect(content?.brandId).toBe(testBrandId);
    expect(content?.contentType).toBe('image');
    expect(content?.mediaUrls).toContain('https://example.com/test-image.jpg');
    expect(content?.brandName).toBe('Test Brand for Publisher');
  });

  test('should return null for non-existent content', async () => {
    const content = await PublisherContentService.getContentForPublishing('non-existent-id');
    expect(content).toBeNull();
  });

  test('should return null for content not in scheduled status', async () => {
    // Update content to draft status
    await prisma.content.update({
      where: { id: testContentId },
      data: { status: 'draft' },
    });

    const content = await PublisherContentService.getContentForPublishing(testContentId);
    expect(content).toBeNull();
  });

  test('should include CDN URL in media URLs', async () => {
    const content = await PublisherContentService.getContentForPublishing(testContentId);
    
    expect(content?.mediaUrls[0]).toBe('https://example.com/test-image.jpg'); // CDN URL
    expect(content?.mediaUrls).toHaveLength(1); // Only CDN URL
  });

  test('should return null when cdnImageUrl is not available', async () => {
    // Update content to remove CDN URL
    await prisma.content.update({
      where: { id: testContentId },
      data: { cdnImageUrl: null },
    });

    const content = await PublisherContentService.getContentForPublishing(testContentId);
    
    expect(content).toBeNull(); // Content should be invalid without media URLs
  });

  test('should detect content type from generation params', async () => {
    // Test video content type
    await prisma.content.update({
      where: { id: testContentId },
      data: { 
        generationParams: {
          contentType: 'video',
          isVideo: true
        }
      },
    });

    const content = await PublisherContentService.getContentForPublishing(testContentId);
    expect(content?.contentType).toBe('video');
  });

  test('should validate content has caption or hashtags', async () => {
    // Create content with no caption and no hashtags
    const emptyContent = await prisma.content.create({
      data: {
        brandId: testBrandId,
        caption: '',
        hashtags: [],
        status: 'scheduled',
        cdnImageUrl: 'https://example.com/test.jpg',
      },
    });

    const content = await PublisherContentService.getContentForPublishing(emptyContent.id);
    expect(content).toBeNull(); // Should be rejected due to no content

    // Cleanup
    await prisma.content.delete({ where: { id: emptyContent.id } });
  });

  test('should validate media URLs are valid', async () => {
    // Create content with invalid URLs
    const invalidContent = await prisma.content.create({
      data: {
        brandId: testBrandId,
        caption: 'Test with invalid URL',
        hashtags: ['#test'],
        status: 'scheduled',
        cdnImageUrl: 'invalid-url',
      },
    });

    const content = await PublisherContentService.getContentForPublishing(invalidContent.id);
    
    // Should still return content but with empty media URLs
    expect(content).toBeTruthy();
    expect(content?.mediaUrls).toHaveLength(0);

    // Cleanup
    await prisma.content.delete({ where: { id: invalidContent.id } });
  });

  test('should cache content and use cache on subsequent calls', async () => {
    // First call - should hit database
    const content1 = await PublisherContentService.getContentForPublishing(testContentId);
    expect(content1).toBeTruthy();

    // Mock console.log to check cache hit message
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Second call - should hit cache (if Redis is available)
    const content2 = await PublisherContentService.getContentForPublishing(testContentId);
    expect(content2).toEqual(content1);

    // Check if cache hit was logged (only if Redis is available)
    const redis = getRedisClient();
    if (redis) {
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Content cache hit for ${testContentId}`)
      );
    }

    consoleSpy.mockRestore();
  });

  test('should invalidate cache correctly', async () => {
    // First, get content to populate cache
    await PublisherContentService.getContentForPublishing(testContentId);

    // Invalidate cache
    await PublisherContentService.invalidateContentCache(testContentId);

    // Update content in database
    await prisma.content.update({
      where: { id: testContentId },
      data: { caption: 'Updated caption for cache test' },
    });

    // Get content again - should get updated version, not cached
    const updatedContent = await PublisherContentService.getContentForPublishing(testContentId);
    expect(updatedContent?.caption).toBe('Updated caption for cache test');
  });

  test('should handle multiple content fetching', async () => {
    // Create additional test content
    const content2 = await prisma.content.create({
      data: {
        brandId: testBrandId,
        caption: 'Second test content',
        hashtags: ['#test2'],
        status: 'scheduled',
        cdnImageUrl: 'https://example.com/test2.jpg',
      },
    });

    const contents = await PublisherContentService.getMultipleContentForPublishing([
      testContentId,
      content2.id,
      'non-existent-id'
    ]);

    expect(contents).toHaveLength(3);
    expect(contents[0]?.id).toBe(testContentId);
    expect(contents[1]?.id).toBe(content2.id);
    expect(contents[2]).toBeNull(); // Non-existent content

    // Cleanup
    await prisma.content.delete({ where: { id: content2.id } });
  });
});