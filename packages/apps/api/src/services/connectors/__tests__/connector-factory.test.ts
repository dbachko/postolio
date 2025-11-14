import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConnectorFactory } from '../connector-factory.js';
import type { Connector } from '../types.js';

describe('ConnectorFactory', () => {
  // Mock connector for testing
  const createMockConnector = (platform: string): Connector => ({
    platform: platform as any,
    capabilities: {
      publish: true,
      accountInsights: false,
      mediaInsights: false,
      comments: false,
      pagination: false,
    },
    rateLimits: {
      apiCallsPerHour: 100,
      postsPerDay: 10,
    },
    publish: vi.fn(),
    listRecentPosts: vi.fn(),
    getAccountInsights: vi.fn(),
    getMediaInsights: vi.fn(),
    getComments: vi.fn(),
  });

  describe('get', () => {
    it('should return Instagram connector for instagram platform', () => {
      const connector = ConnectorFactory.get('instagram');
      expect(connector).toBeDefined();
      expect(connector.platform).toBe('instagram');
    });

    it('should throw error for unsupported platform', () => {
      expect(() => {
        ConnectorFactory.get('facebook' as any);
      }).toThrow('No connector found for platform: facebook');
    });

    it('should throw error for invalid platform', () => {
      expect(() => {
        ConnectorFactory.get('invalid-platform' as any);
      }).toThrow('No connector found for platform: invalid-platform');
    });
  });

  describe('supports', () => {
    it('should return true for supported platform (instagram)', () => {
      expect(ConnectorFactory.supports('instagram')).toBe(true);
    });

    it('should return false for unsupported platform', () => {
      expect(ConnectorFactory.supports('facebook' as any)).toBe(false);
      expect(ConnectorFactory.supports('linkedin' as any)).toBe(false);
      expect(ConnectorFactory.supports('x' as any)).toBe(false);
      expect(ConnectorFactory.supports('tiktok' as any)).toBe(false);
    });
  });

  describe('supportedPlatforms', () => {
    it('should return list of supported platforms', () => {
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).toContain('instagram');
      expect(platforms.length).toBeGreaterThan(0);
    });

    it('should return array of strings', () => {
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(Array.isArray(platforms)).toBe(true);
      platforms.forEach((platform) => {
        expect(typeof platform).toBe('string');
      });
    });
  });

  describe('register', () => {
    let mockConnector: Connector;

    beforeEach(() => {
      mockConnector = createMockConnector('facebook');
    });

    afterEach(() => {
      // Cleanup - unregister the test connector
      try {
        ConnectorFactory.unregister('facebook' as any);
      } catch {
        // Ignore if already unregistered
      }
    });

    it('should register a new connector', () => {
      ConnectorFactory.register('facebook' as any, mockConnector);
      expect(ConnectorFactory.supports('facebook' as any)).toBe(true);
    });

    it('should allow retrieving registered connector', () => {
      ConnectorFactory.register('facebook' as any, mockConnector);
      const connector = ConnectorFactory.get('facebook' as any);
      expect(connector).toBe(mockConnector);
    });

    it('should include registered platform in supportedPlatforms', () => {
      ConnectorFactory.register('facebook' as any, mockConnector);
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).toContain('facebook');
    });

    it('should throw error when registering with mismatched platform name', () => {
      const wrongConnector = createMockConnector('linkedin');
      expect(() => {
        ConnectorFactory.register('facebook' as any, wrongConnector);
      }).toThrow("Connector platform 'linkedin' does not match registration key 'facebook'");
    });
  });

  describe('unregister', () => {
    let mockConnector: Connector;

    beforeEach(() => {
      mockConnector = createMockConnector('tiktok');
      ConnectorFactory.register('tiktok' as any, mockConnector);
    });

    it('should unregister an existing connector', () => {
      expect(ConnectorFactory.supports('tiktok' as any)).toBe(true);
      ConnectorFactory.unregister('tiktok' as any);
      expect(ConnectorFactory.supports('tiktok' as any)).toBe(false);
    });

    it('should throw error when getting unregistered connector', () => {
      ConnectorFactory.unregister('tiktok' as any);
      expect(() => {
        ConnectorFactory.get('tiktok' as any);
      }).toThrow('No connector found for platform: tiktok');
    });

    it('should remove platform from supportedPlatforms', () => {
      ConnectorFactory.unregister('tiktok' as any);
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).not.toContain('tiktok');
    });

    it('should not throw when unregistering non-existent platform', () => {
      expect(() => {
        ConnectorFactory.unregister('non-existent' as any);
      }).not.toThrow();
    });
  });

  describe('multiple connectors', () => {
    let facebookConnector: Connector;
    let linkedinConnector: Connector;

    beforeEach(() => {
      facebookConnector = createMockConnector('facebook');
      linkedinConnector = createMockConnector('linkedin');
      ConnectorFactory.register('facebook' as any, facebookConnector);
      ConnectorFactory.register('linkedin' as any, linkedinConnector);
    });

    afterEach(() => {
      ConnectorFactory.unregister('facebook' as any);
      ConnectorFactory.unregister('linkedin' as any);
    });

    it('should support multiple registered connectors', () => {
      expect(ConnectorFactory.supports('facebook' as any)).toBe(true);
      expect(ConnectorFactory.supports('linkedin' as any)).toBe(true);
      expect(ConnectorFactory.supports('instagram')).toBe(true);
    });

    it('should return correct connector for each platform', () => {
      const fb = ConnectorFactory.get('facebook' as any);
      const li = ConnectorFactory.get('linkedin' as any);
      const ig = ConnectorFactory.get('instagram');

      expect(fb).toBe(facebookConnector);
      expect(li).toBe(linkedinConnector);
      expect(ig.platform).toBe('instagram');
    });

    it('should list all registered platforms', () => {
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).toContain('facebook');
      expect(platforms).toContain('linkedin');
      expect(platforms).toContain('instagram');
      expect(platforms.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Instagram connector properties', () => {
    it('should return Instagram connector with correct capabilities', () => {
      const connector = ConnectorFactory.get('instagram');
      expect(connector.capabilities.publish).toBe(true);
      expect(connector.capabilities.accountInsights).toBe(true);
      expect(connector.capabilities.mediaInsights).toBe(true);
      expect(connector.capabilities.comments).toBe(true);
    });

    it('should return Instagram connector with rate limits', () => {
      const connector = ConnectorFactory.get('instagram');
      expect(connector.rateLimits).toBeDefined();
      expect(connector.rateLimits.apiCallsPerHour).toBeGreaterThan(0);
      expect(connector.rateLimits.postsPerDay).toBeGreaterThan(0);
    });

    it('should return Instagram connector with all required methods', () => {
      const connector = ConnectorFactory.get('instagram');
      expect(typeof connector.publish).toBe('function');
      expect(typeof connector.listRecentPosts).toBe('function');
      expect(typeof connector.getAccountInsights).toBe('function');
      expect(typeof connector.getMediaInsights).toBe('function');
      expect(typeof connector.getComments).toBe('function');
    });
  });
});
