/**
 * Publisher Credentials Service
 * Provides a secure way for the AWS publisher Lambda to fetch fresh Instagram credentials
 * This ensures credentials are always up-to-date even if user reconnects their account
 */

import { getDatabaseClient } from '../config/database.js';

const prisma = getDatabaseClient();

export interface PublisherCredentials {
  instagramAccessToken: string | null;
  instagramAccountId: string | null;
  instagramPageId: string | null;
  brandName: string;
}

export class PublisherCredentialsService {
  /**
   * Fetch fresh Instagram credentials for a brand
   * This should be called by the publisher Lambda at publish time
   * to ensure we always have the latest valid credentials
   */
  static async getCredentialsForBrand(brandId: string): Promise<PublisherCredentials | null> {
    try {
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: {
          id: true,
          name: true,
          instagramAccessToken: true,
          instagramAccountId: true,
          instagramPageId: true,
        },
      });

      if (!brand) {
        console.error(`Brand not found: ${brandId}`);
        return null;
      }

      // Check if Instagram is connected
      if (!brand.instagramAccessToken || !brand.instagramAccountId) {
        console.error(`Instagram not connected for brand: ${brandId}`);
        return null;
      }

      return {
        instagramAccessToken: brand.instagramAccessToken,
        instagramAccountId: brand.instagramAccountId,
        instagramPageId: brand.instagramPageId,
        brandName: brand.name,
      };
    } catch (error) {
      console.error('Error fetching publisher credentials:', error);
      return null;
    }
  }

  /**
   * Validate that credentials are still valid
   * This could be extended to check token expiry dates
   */
  static async validateCredentials(credentials: PublisherCredentials): Promise<boolean> {
    if (!credentials.instagramAccessToken) {
      return false;
    }

    // TODO: Check token expiry if we store it
    // const tokenExpiry = await this.getTokenExpiry(credentials.brandId);
    // if (tokenExpiry && new Date(tokenExpiry) < new Date()) {
    //   return false;
    // }

    return true;
  }

  /**
   * Get credentials for publishing
   * This is the main method the publisher Lambda should call
   */
  static async getPublishingCredentials(brandId: string): Promise<PublisherCredentials | null> {
    const credentials = await this.getCredentialsForBrand(brandId);
    
    if (!credentials) {
      return null;
    }

    const isValid = await this.validateCredentials(credentials);
    
    if (!isValid) {
      console.error(`Invalid credentials for brand ${brandId}`);
      return null;
    }

    return credentials;
  }
}