import type { Connector, PlatformName } from '@postolio/connectors';
import { InstagramConnector } from '@postolio/connectors';

/**
 * Factory for getting platform-specific connectors
 *
 * This factory implements the Strategy pattern to route requests to the
 * appropriate platform connector based on the platform name.
 *
 * Usage:
 *   const connector = ConnectorFactory.get('instagram');
 *   const result = await connector.publish(request, credentials, account);
 */
export class ConnectorFactory {
  private static connectors: Map<PlatformName, Connector> = new Map([
    ['instagram', new InstagramConnector()],
    // Additional platforms can be registered here as they come online
  ]);

  /**
   * Get a connector for the specified platform
   *
   * @param platform - The platform name (instagram, facebook, etc.)
   * @returns The platform connector
   * @throws Error if the platform is not supported
   */
  static get(platform: PlatformName): Connector {
    const connector = this.connectors.get(platform);

    if (!connector) {
      throw new Error(
        `No connector found for platform: ${platform}. ` +
          `Supported platforms: ${this.supportedPlatforms().join(', ')}`
      );
    }

    return connector;
  }

  /**
   * Check if a platform is supported
   *
   * @param platform - The platform name to check
   * @returns true if the platform has a connector, false otherwise
   */
  static supports(platform: PlatformName): boolean {
    return this.connectors.has(platform);
  }

  /**
   * Get list of all supported platforms
   *
   * @returns Array of supported platform names
   */
  static supportedPlatforms(): PlatformName[] {
    return Array.from(this.connectors.keys());
  }

  /**
   * Register a new connector (useful for testing or dynamic registration)
   *
   * @param platform - The platform name
   * @param connector - The connector instance
   */
  static register(platform: PlatformName, connector: Connector): void {
    if (connector.platform !== platform) {
      throw new Error(
        `Connector platform '${connector.platform}' does not match registration key '${platform}'`
      );
    }
    this.connectors.set(platform, connector);
  }

  /**
   * Unregister a connector (useful for testing)
   *
   * @param platform - The platform name to unregister
   */
  static unregister(platform: PlatformName): void {
    this.connectors.delete(platform);
  }
}
