/**
 * Service Client Integration Layer
 * Centralized management of all service clients
 */

import { TokenServiceClient } from '../clients/token-service-client.js';
import { ContentSchedulerClient } from '../clients/content-scheduler-client.js';
import { logger } from '@postolio/logger';

export class ServiceClients {
  private static instance: ServiceClients | null = null;

  private _tokenService: TokenServiceClient | null = null;
  private _schedulerService: ContentSchedulerClient | null = null;

  /**
   * Singleton pattern for service clients
   */
  static getInstance(): ServiceClients {
    if (!ServiceClients.instance) {
      ServiceClients.instance = new ServiceClients();
    }
    return ServiceClients.instance;
  }

  private constructor() {
    // Private constructor for singleton
  }

  // Optional: eager child logger for this module
  // Using default logger is fine; child can add module context if needed

  /**
   * Get Token Service client
   */
  async getTokenService(): Promise<TokenServiceClient> {
    if (!this._tokenService) {
      try {
        // TokenServiceClient with RESTful endpoints and enhanced features
        this._tokenService = new TokenServiceClient();
        logger.info(
          'Token Service client initialized with RESTful endpoints and enhanced features'
        );
      } catch (error) {
        logger.error('Failed to initialize Token Service client', { error });
        throw error;
      }
    }
    return this._tokenService;
  }

  /**
   * Get Content Scheduler client
   */
  async getSchedulerService(): Promise<ContentSchedulerClient> {
    if (!this._schedulerService) {
      try {
        // Use the static factory method for service discovery
        this._schedulerService = await ContentSchedulerClient.create({
          debugLogging: process.env.NODE_ENV === 'dev',
        });
        logger.info('Content Scheduler client initialized');
      } catch (error) {
        logger.error('Failed to initialize Content Scheduler client', { error });
        throw error;
      }
    }
    return this._schedulerService;
  }

  /**
   * Health check for all service clients
   */
  async healthCheck(): Promise<{
    tokenService: 'healthy' | 'unhealthy' | 'not_initialized';
    schedulerService: 'healthy' | 'unhealthy' | 'not_initialized';
    overall: 'healthy' | 'degraded' | 'unhealthy';
  }> {
    const results: {
      tokenService: 'healthy' | 'unhealthy' | 'not_initialized';
      schedulerService: 'healthy' | 'unhealthy' | 'not_initialized';
      overall: 'healthy' | 'degraded' | 'unhealthy';
    } = {
      tokenService: 'not_initialized',
      schedulerService: 'not_initialized',
      overall: 'healthy',
    };

    // Check Token Service
    if (this._tokenService) {
      try {
        await this._tokenService.healthCheck();
        results.tokenService = 'healthy';
      } catch {
        results.tokenService = 'unhealthy';
      }
    }

    // Check Scheduler Service
    if (this._schedulerService) {
      try {
        await this._schedulerService.healthCheck();
        results.schedulerService = 'healthy';
      } catch {
        results.schedulerService = 'unhealthy';
      }
    }

    // Determine overall health based on individual service health
    const services = [results.tokenService, results.schedulerService];
    const unhealthyCount = services.filter((status) => status === 'unhealthy').length;
    const uninitializedCount = services.filter((status) => status === 'not_initialized').length;

    if (unhealthyCount > 0) {
      if (unhealthyCount === services.length) {
        results.overall = 'unhealthy';
      } else {
        results.overall = 'degraded';
      }
    } else if (uninitializedCount === services.length) {
      results.overall = 'unhealthy'; // All services uninitialized
    } else {
      results.overall = 'healthy';
    }

    return results;
  }
}

// Convenience exports for easy access
export const serviceClients = ServiceClients.getInstance();

/**
 * Convenience functions for direct service access
 */
export async function getTokenService(): Promise<TokenServiceClient> {
  return serviceClients.getTokenService();
}

export async function getSchedulerService(): Promise<ContentSchedulerClient> {
  return serviceClients.getSchedulerService();
}

/**
 * Initialize all service clients (optional, for eager initialization)
 */
export async function initializeAllServices(): Promise<void> {
  logger.info('Initializing all service clients...');

  try {
    await Promise.all([serviceClients.getTokenService(), serviceClients.getSchedulerService()]);
    logger.info('All service clients initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize some service clients', { error });
    throw error;
  }
}
