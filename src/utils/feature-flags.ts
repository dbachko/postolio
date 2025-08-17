/**
 * Feature Flags System
 * Manages gradual rollout of new scheduler microservice
 */

import { createHash } from 'crypto';

// ==================== Types ====================

export interface FeatureFlagConfig {
  migrationPercentage?: number;
  forceNewScheduler?: boolean;
  enabledBrands?: string[];
  disabledBrands?: string[];
  enableMetrics?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface RolloutDecision {
  enabled: boolean;
  reason: string;
  bucket?: number;
  percentage?: number;
}

// ==================== Feature Flags Class ====================

export class FeatureFlags {
  private migrationPercentage: number;
  private forceNewScheduler: boolean;
  private enabledBrands: Set<string>;
  private disabledBrands: Set<string>;
  private enableMetrics: boolean;
  private logLevel: string;
  private decisions: Map<string, RolloutDecision> = new Map();

  constructor(config: FeatureFlagConfig = {}) {
    // Load from environment variables with defaults
    this.migrationPercentage = config.migrationPercentage ?? 
      parseInt(process.env.SCHEDULER_MIGRATION_PCT || '0', 10);
    
    this.forceNewScheduler = config.forceNewScheduler ?? 
      process.env.USE_NEW_SCHEDULER === 'true';
    
    // Parse enabled/disabled brand lists
    this.enabledBrands = new Set(
      config.enabledBrands ?? 
      (process.env.SCHEDULER_ENABLED_BRANDS?.split(',').filter(Boolean) || [])
    );
    
    this.disabledBrands = new Set(
      config.disabledBrands ?? 
      (process.env.SCHEDULER_DISABLED_BRANDS?.split(',').filter(Boolean) || [])
    );
    
    this.enableMetrics = config.enableMetrics ?? 
      process.env.SCHEDULER_ENABLE_METRICS === 'true';
    
    this.logLevel = config.logLevel ?? 
      process.env.SCHEDULER_LOG_LEVEL || 'info';
  }

  /**
   * Check if new scheduler is enabled for a specific brand
   */
  isNewSchedulerEnabled(brandId: string): boolean {
    const decision = this.evaluateRollout(brandId);
    
    // Cache and log decision
    this.decisions.set(brandId, decision);
    this.logDecision(brandId, decision);
    
    return decision.enabled;
  }

  /**
   * Evaluate rollout decision for a brand
   */
  private evaluateRollout(brandId: string): RolloutDecision {
    // 1. Check force flags first
    if (process.env.USE_NEW_SCHEDULER === 'false') {
      return {
        enabled: false,
        reason: 'Force disabled via USE_NEW_SCHEDULER=false',
      };
    }

    if (this.forceNewScheduler) {
      return {
        enabled: true,
        reason: 'Force enabled via USE_NEW_SCHEDULER=true',
      };
    }

    // 2. Check explicit brand lists
    if (this.disabledBrands.has(brandId)) {
      return {
        enabled: false,
        reason: `Brand ${brandId} is in disabled list`,
      };
    }

    if (this.enabledBrands.has(brandId)) {
      return {
        enabled: true,
        reason: `Brand ${brandId} is in enabled list`,
      };
    }

    // 3. Hash-based percentage rollout
    const bucket = this.getBucketForBrand(brandId);
    const enabled = bucket < this.migrationPercentage;

    return {
      enabled,
      reason: `Hash-based rollout: bucket ${bucket} vs percentage ${this.migrationPercentage}`,
      bucket,
      percentage: this.migrationPercentage,
    };
  }

  /**
   * Calculate consistent hash bucket for a brand
   */
  private getBucketForBrand(brandId: string): number {
    // Use MD5 hash for consistent distribution
    const hash = createHash('md5').update(brandId).digest('hex');
    
    // Take first 8 characters and convert to number
    const hashValue = parseInt(hash.substring(0, 8), 16);
    
    // Map to 0-99 bucket
    return hashValue % 100;
  }

  /**
   * Log rollout decision
   */
  private logDecision(brandId: string, decision: RolloutDecision): void {
    const shouldLog = this.shouldLog('debug');
    
    if (shouldLog) {
      console.log('[FeatureFlags]', {
        brandId,
        decision: decision.enabled ? 'NEW_SCHEDULER' : 'LEGACY_SCHEDULER',
        reason: decision.reason,
        bucket: decision.bucket,
        percentage: decision.percentage,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Check if we should log at a given level
   */
  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const requestedLevelIndex = levels.indexOf(level);
    
    return requestedLevelIndex >= currentLevelIndex;
  }

  // ==================== Management Methods ====================

  /**
   * Update migration percentage
   */
  updateMigrationPercentage(percentage: number): void {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }
    
    const oldPercentage = this.migrationPercentage;
    this.migrationPercentage = percentage;
    
    console.info('[FeatureFlags] Migration percentage updated', {
      from: oldPercentage,
      to: percentage,
      timestamp: new Date().toISOString(),
    });
    
    // Clear decision cache as percentages changed
    this.decisions.clear();
  }

  /**
   * Enable specific brand
   */
  enableBrand(brandId: string): void {
    this.enabledBrands.add(brandId);
    this.disabledBrands.delete(brandId);
    this.decisions.delete(brandId);
    
    console.info('[FeatureFlags] Brand enabled', { brandId });
  }

  /**
   * Disable specific brand
   */
  disableBrand(brandId: string): void {
    this.disabledBrands.add(brandId);
    this.enabledBrands.delete(brandId);
    this.decisions.delete(brandId);
    
    console.info('[FeatureFlags] Brand disabled', { brandId });
  }

  /**
   * Force enable new scheduler for all brands
   */
  forceEnableNewScheduler(): void {
    this.forceNewScheduler = true;
    this.decisions.clear();
    
    console.info('[FeatureFlags] New scheduler force enabled for all brands');
  }

  /**
   * Force disable new scheduler for all brands
   */
  forceDisableNewScheduler(): void {
    this.forceNewScheduler = false;
    process.env.USE_NEW_SCHEDULER = 'false';
    this.decisions.clear();
    
    console.info('[FeatureFlags] New scheduler force disabled for all brands');
  }

  // ==================== Monitoring Methods ====================

  /**
   * Get rollout statistics
   */
  getRolloutStats(): {
    percentage: number;
    forceEnabled: boolean;
    enabledBrands: string[];
    disabledBrands: string[];
    recentDecisions: Array<{ brandId: string; decision: RolloutDecision }>;
  } {
    return {
      percentage: this.migrationPercentage,
      forceEnabled: this.forceNewScheduler,
      enabledBrands: Array.from(this.enabledBrands),
      disabledBrands: Array.from(this.disabledBrands),
      recentDecisions: Array.from(this.decisions.entries())
        .slice(-10)
        .map(([brandId, decision]) => ({ brandId, decision })),
    };
  }

  /**
   * Estimate number of brands that would use new scheduler
   */
  estimateRolloutImpact(allBrandIds: string[]): {
    total: number;
    usingNew: number;
    usingLegacy: number;
    percentage: number;
  } {
    let usingNew = 0;
    let usingLegacy = 0;

    for (const brandId of allBrandIds) {
      if (this.isNewSchedulerEnabled(brandId)) {
        usingNew++;
      } else {
        usingLegacy++;
      }
    }

    return {
      total: allBrandIds.length,
      usingNew,
      usingLegacy,
      percentage: allBrandIds.length > 0 
        ? (usingNew / allBrandIds.length) * 100 
        : 0,
    };
  }

  /**
   * Check if metrics collection is enabled
   */
  isMetricsEnabled(): boolean {
    return this.enableMetrics;
  }

  /**
   * Export configuration (for debugging)
   */
  exportConfig(): FeatureFlagConfig {
    return {
      migrationPercentage: this.migrationPercentage,
      forceNewScheduler: this.forceNewScheduler,
      enabledBrands: Array.from(this.enabledBrands),
      disabledBrands: Array.from(this.disabledBrands),
      enableMetrics: this.enableMetrics,
      logLevel: this.logLevel as any,
    };
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.migrationPercentage = 0;
    this.forceNewScheduler = false;
    this.enabledBrands.clear();
    this.disabledBrands.clear();
    this.decisions.clear();
    
    console.info('[FeatureFlags] Reset to defaults');
  }
}

// ==================== Singleton Instance ====================

let instance: FeatureFlags | null = null;

/**
 * Get singleton instance of feature flags
 */
export function getFeatureFlags(config?: FeatureFlagConfig): FeatureFlags {
  if (!instance) {
    instance = new FeatureFlags(config);
  }
  return instance;
}

/**
 * Reset singleton instance (useful for testing)
 */
export function resetFeatureFlags(): void {
  instance = null;
}

// ==================== Utility Functions ====================

/**
 * Quick check if new scheduler is enabled for a brand
 */
export function isNewSchedulerEnabled(brandId: string): boolean {
  return getFeatureFlags().isNewSchedulerEnabled(brandId);
}

/**
 * Update migration percentage globally
 */
export function updateMigrationPercentage(percentage: number): void {
  getFeatureFlags().updateMigrationPercentage(percentage);
}

/**
 * Get current rollout statistics
 */
export function getRolloutStats() {
  return getFeatureFlags().getRolloutStats();
}

// ==================== Default Export ====================

export default {
  FeatureFlags,
  getFeatureFlags,
  resetFeatureFlags,
  isNewSchedulerEnabled,
  updateMigrationPercentage,
  getRolloutStats,
};