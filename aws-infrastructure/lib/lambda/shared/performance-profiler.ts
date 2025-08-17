/**
 * Performance Profiler for Content Scheduler
 * Provides utilities for measuring and analyzing performance
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { MetricsPublisher, PerformanceMetrics } from './metrics-publisher';

const logger = new Logger({ serviceName: 'performance-profiler' });
const tracer = new Tracer({ serviceName: 'content-scheduler' });

export interface ProfileResult {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
  segments?: ProfileSegment[];
}

export interface ProfileSegment {
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, any>;
}

export interface MemoryProfile {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
}

/**
 * Performance profiler class
 */
export class PerformanceProfiler {
  private profiles: Map<string, ProfileResult> = new Map();
  private segments: Map<string, ProfileSegment[]> = new Map();
  private memoryBaseline?: MemoryProfile;
  private maxProfileSize = 100; // Prevent memory leaks by limiting map size

  /**
   * Start profiling an operation
   */
  startProfile(operation: string, metadata?: Record<string, any>): void {
    // Clean up old profiles if we're at capacity
    if (this.profiles.size >= this.maxProfileSize) {
      const oldestKey = this.profiles.keys().next().value;
      if (oldestKey) {
        this.profiles.delete(oldestKey);
        this.segments.delete(oldestKey);
      }
    }

    const profile: ProfileResult = {
      operation,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      success: false,
      metadata,
      segments: [],
    };

    this.profiles.set(operation, profile);
    this.segments.set(operation, []);

    // Start X-Ray segment
    const segment = tracer.getSegment();
    if (segment) {
      const subsegment = segment.addNewSubsegment(operation);
      if (metadata) {
        subsegment.addMetadata('operation', metadata);
      }
    }

    logger.info('Profile started', { operation, metadata });
  }

  /**
   * Start a segment within a profile
   */
  startSegment(operation: string, segmentName: string, metadata?: Record<string, any>): void {
    const segments = this.segments.get(operation) || [];
    
    const segment: ProfileSegment = {
      name: segmentName,
      startTime: Date.now(),
      endTime: 0,
      duration: 0,
      metadata,
    };

    segments.push(segment);
    this.segments.set(operation, segments);

    // Add X-Ray subsegment
    const xraySegment = tracer.getSegment();
    if (xraySegment) {
      const subsegment = xraySegment.addNewSubsegment(segmentName);
      if (metadata) {
        subsegment.addMetadata('segment', metadata);
      }
    }

    logger.debug('Segment started', { operation, segmentName, metadata });
  }

  /**
   * End a segment within a profile
   */
  endSegment(operation: string, segmentName: string, success: boolean = true): void {
    const segments = this.segments.get(operation);
    if (!segments) return;

    const segment = segments.find(s => s.name === segmentName && s.endTime === 0);
    if (segment) {
      segment.endTime = Date.now();
      segment.duration = segment.endTime - segment.startTime;

      // Close X-Ray subsegment
      const xraySegment = tracer.getSegment();
      if (xraySegment) {
        const subsegments = xraySegment.subsegments || [];
        const subsegment = subsegments.find(s => s.name === segmentName);
        if (subsegment) {
          if (!success) {
            subsegment.addError(new Error(`Segment ${segmentName} failed`));
          }
          subsegment.close();
        }
      }

      logger.debug('Segment ended', { 
        operation, 
        segmentName, 
        duration: segment.duration,
        success 
      });
    }
  }

  /**
   * End profiling an operation
   */
  async endProfile(operation: string, success: boolean = true, errorType?: string): Promise<ProfileResult | undefined> {
    const profile = this.profiles.get(operation);
    if (!profile) return undefined;

    profile.endTime = Date.now();
    profile.duration = profile.endTime - profile.startTime;
    profile.success = success;
    profile.segments = this.segments.get(operation) || [];

    // Close X-Ray segment
    const xraySegment = tracer.getSegment();
    if (xraySegment) {
      const subsegments = xraySegment.subsegments || [];
      const subsegment = subsegments.find(s => s.name === operation);
      if (subsegment) {
        if (!success && errorType) {
          subsegment.addError(new Error(errorType));
        }
        subsegment.close();
      }
    }

    // Emit performance metrics
    const metrics: PerformanceMetrics = {
      operation,
      duration: profile.duration,
      success,
      errorType,
    };
    MetricsPublisher.emitPerformanceMetrics(metrics);

    // Log profile summary
    logger.info('Profile completed', {
      operation,
      duration: profile.duration,
      success,
      segments: profile.segments.length,
      segmentDurations: profile.segments.map(s => ({
        name: s.name,
        duration: s.duration,
      })),
    });

    // Clean up
    this.profiles.delete(operation);
    this.segments.delete(operation);

    return profile;
  }

  /**
   * Profile async operation with automatic timing
   */
  async profileAsync<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    this.startProfile(operation, metadata);
    
    try {
      const result = await fn();
      await this.endProfile(operation, true);
      return result;
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      await this.endProfile(operation, false, errorType);
      throw error;
    }
  }

  /**
   * Profile sync operation with automatic timing
   */
  profile<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, any>
  ): T {
    this.startProfile(operation, metadata);
    
    try {
      const result = fn();
      this.endProfile(operation, true);
      return result;
    } catch (error) {
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.endProfile(operation, false, errorType);
      throw error;
    }
  }

  /**
   * Capture memory profile
   */
  captureMemoryProfile(): MemoryProfile {
    const memUsage = process.memoryUsage();
    
    const profile: MemoryProfile = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers,
    };

    logger.info('Memory profile captured', {
      heapUsedMB: Math.round(profile.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(profile.heapTotal / 1024 / 1024),
      rssMB: Math.round(profile.rss / 1024 / 1024),
    });

    return profile;
  }

  /**
   * Set memory baseline for comparison
   */
  setMemoryBaseline(): void {
    this.memoryBaseline = this.captureMemoryProfile();
    logger.info('Memory baseline set');
  }

  /**
   * Compare current memory with baseline
   */
  compareMemoryWithBaseline(): MemoryProfile | undefined {
    if (!this.memoryBaseline) {
      logger.warn('No memory baseline set');
      return undefined;
    }

    const current = this.captureMemoryProfile();
    
    const diff: MemoryProfile = {
      heapUsed: current.heapUsed - this.memoryBaseline.heapUsed,
      heapTotal: current.heapTotal - this.memoryBaseline.heapTotal,
      external: current.external - this.memoryBaseline.external,
      rss: current.rss - this.memoryBaseline.rss,
      arrayBuffers: current.arrayBuffers - this.memoryBaseline.arrayBuffers,
    };

    logger.info('Memory comparison', {
      heapUsedDiffMB: Math.round(diff.heapUsed / 1024 / 1024),
      heapTotalDiffMB: Math.round(diff.heapTotal / 1024 / 1024),
      rssDiffMB: Math.round(diff.rss / 1024 / 1024),
    });

    // Warn if memory usage increased significantly
    if (diff.heapUsed > 50 * 1024 * 1024) { // 50MB increase
      logger.warn('Significant memory increase detected', {
        increaseMB: Math.round(diff.heapUsed / 1024 / 1024),
      });
    }

    return diff;
  }

  /**
   * Profile Lambda cold start
   */
  profileColdStart(): void {
    const isoColdStart = process.env._LAMBDA_COLD_START === 'true';
    const initDuration = process.env._LAMBDA_INIT_DURATION;
    
    if (isoColdStart && initDuration) {
      logger.info('Cold start detected', {
        initDuration: parseInt(initDuration),
        memorySize: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
      });

      // Emit cold start metric
      MetricsPublisher.emitPerformanceMetrics({
        operation: 'ColdStart',
        duration: parseInt(initDuration),
        success: true,
      });
    }
    
    // Mark as warm for subsequent invocations
    process.env._LAMBDA_COLD_START = 'false';
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(): Promise<Record<string, any>> {
    const stats = {
      timestamp: new Date().toISOString(),
      memory: this.captureMemoryProfile(),
      eventLoopLag: await this.measureEventLoopLag(),
      cpuUsage: process.cpuUsage(),
      uptime: process.uptime(),
    };

    logger.info('Performance stats collected', stats);
    return stats;
  }

  /**
   * Measure event loop lag
   */
  private async measureEventLoopLag(): Promise<number> {
    const start = Date.now();
    
    return new Promise<number>((resolve) => {
      setImmediate(() => {
        const lag = Date.now() - start;
        resolve(lag);
      });
    });
  }

  /**
   * Create performance report
   */
  createPerformanceReport(profiles: ProfileResult[]): Record<string, any> {
    const report = {
      timestamp: new Date().toISOString(),
      totalProfiles: profiles.length,
      successfulProfiles: profiles.filter(p => p.success).length,
      failedProfiles: profiles.filter(p => !p.success).length,
      averageDuration: profiles.reduce((sum, p) => sum + p.duration, 0) / profiles.length,
      maxDuration: Math.max(...profiles.map(p => p.duration)),
      minDuration: Math.min(...profiles.map(p => p.duration)),
      operationBreakdown: this.getOperationBreakdown(profiles),
      segmentAnalysis: this.getSegmentAnalysis(profiles),
    };

    logger.info('Performance report created', report);
    return report;
  }

  /**
   * Get operation breakdown
   */
  private getOperationBreakdown(profiles: ProfileResult[]): Record<string, any> {
    const breakdown: Record<string, any> = {};
    
    profiles.forEach(profile => {
      if (!breakdown[profile.operation]) {
        breakdown[profile.operation] = {
          count: 0,
          totalDuration: 0,
          avgDuration: 0,
          successRate: 0,
        };
      }
      
      breakdown[profile.operation].count++;
      breakdown[profile.operation].totalDuration += profile.duration;
      
      if (profile.success) {
        breakdown[profile.operation].successRate++;
      }
    });

    // Calculate averages
    Object.keys(breakdown).forEach(operation => {
      const data = breakdown[operation];
      data.avgDuration = data.totalDuration / data.count;
      data.successRate = (data.successRate / data.count) * 100;
    });

    return breakdown;
  }

  /**
   * Get segment analysis
   */
  private getSegmentAnalysis(profiles: ProfileResult[]): Record<string, any> {
    const segmentStats: Record<string, any> = {};
    
    profiles.forEach(profile => {
      profile.segments?.forEach(segment => {
        if (!segmentStats[segment.name]) {
          segmentStats[segment.name] = {
            count: 0,
            totalDuration: 0,
            avgDuration: 0,
            maxDuration: 0,
            minDuration: Infinity,
          };
        }
        
        const stats = segmentStats[segment.name];
        stats.count++;
        stats.totalDuration += segment.duration;
        stats.maxDuration = Math.max(stats.maxDuration, segment.duration);
        stats.minDuration = Math.min(stats.minDuration, segment.duration);
      });
    });

    // Calculate averages
    Object.keys(segmentStats).forEach(segmentName => {
      const stats = segmentStats[segmentName];
      stats.avgDuration = stats.totalDuration / stats.count;
    });

    return segmentStats;
  }
}

// Export singleton instance
export const profiler = new PerformanceProfiler();

// Clean up on Lambda container shutdown
process.on('SIGTERM', () => {
  profiler.profiles.clear();
  profiler.segments.clear();
});