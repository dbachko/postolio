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

    it('should return Facebook connector for facebook platform', () => {
      const connector = ConnectorFactory.get('facebook' as any);
      expect(connector).toBeDefined();
      expect(connector.platform).toBe('facebook');
    });

    it('should throw error for unsupported platform', () => {
      expect(() => {
        ConnectorFactory.get('linkedin' as any);
      }).toThrow('No connector found for platform: linkedin');
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

    it('should return true for supported platform (facebook)', () => {
      expect(ConnectorFactory.supports('facebook' as any)).toBe(true);
    });

    it('should return false for unsupported platform', () => {
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
      mockConnector = createMockConnector('linkedin');
    });

    afterEach(() => {
      // Cleanup - unregister the test connector
      try {
        ConnectorFactory.unregister('linkedin' as any);
      } catch {
        // Ignore if already unregistered
      }
    });

    it('should register a new connector', () => {
      ConnectorFactory.register('linkedin' as any, mockConnector);
      expect(ConnectorFactory.supports('linkedin' as any)).toBe(true);
    });

    it('should allow retrieving registered connector', () => {
      ConnectorFactory.register('linkedin' as any, mockConnector);
      const connector = ConnectorFactory.get('linkedin' as any);
      expect(connector).toBe(mockConnector);
    });

    it('should include registered platform in supportedPlatforms', () => {
      ConnectorFactory.register('linkedin' as any, mockConnector);
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).toContain('linkedin');
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
    let linkedinConnector: Connector;
    let xConnector: Connector;

    beforeEach(() => {
      linkedinConnector = createMockConnector('linkedin');
      xConnector = createMockConnector('x');
      ConnectorFactory.register('linkedin' as any, linkedinConnector);
      ConnectorFactory.register('x' as any, xConnector);
    });

    afterEach(() => {
      ConnectorFactory.unregister('linkedin' as any);
      ConnectorFactory.unregister('x' as any);
    });

    it('should support multiple registered connectors', () => {
      expect(ConnectorFactory.supports('linkedin' as any)).toBe(true);
      expect(ConnectorFactory.supports('x' as any)).toBe(true);
      expect(ConnectorFactory.supports('instagram')).toBe(true);
      expect(ConnectorFactory.supports('facebook' as any)).toBe(true);
    });

    it('should return correct connector for each platform', () => {
      const li = ConnectorFactory.get('linkedin' as any);
      const x = ConnectorFactory.get('x' as any);
      const ig = ConnectorFactory.get('instagram');
      const fb = ConnectorFactory.get('facebook' as any);

      expect(li).toBe(linkedinConnector);
      expect(x).toBe(xConnector);
      expect(ig.platform).toBe('instagram');
      expect(fb.platform).toBe('facebook');
    });

    it('should list all registered platforms', () => {
      const platforms = ConnectorFactory.supportedPlatforms();
      expect(platforms).toContain('linkedin');
      expect(platforms).toContain('x');
      expect(platforms).toContain('instagram');
      expect(platforms).toContain('facebook');
      expect(platforms.length).toBeGreaterThanOrEqual(4);
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
