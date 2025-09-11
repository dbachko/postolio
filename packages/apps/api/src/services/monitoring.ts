export interface ApiMetrics {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  userId?: string;
  timestamp: Date;
}

export interface ErrorLog {
  level: 'error' | 'warn' | 'info';
  message: string;
  userId?: string;
  endpoint?: string;
  timestamp: Date;
  stack?: string;
}

export class MonitoringService {
  private metrics: ApiMetrics[] = [];
  private errors: ErrorLog[] = [];

  trackApiCall(metrics: Omit<ApiMetrics, 'timestamp'>): void {
    this.metrics.push({
      ...metrics,
      timestamp: new Date(),
    });
  }

  logError(error: Omit<ErrorLog, 'timestamp'>): void {
    this.errors.push({
      ...error,
      timestamp: new Date(),
    });
  }

  getMetrics(): ApiMetrics[] {
    return this.metrics;
  }

  getErrors(): ErrorLog[] {
    return this.errors;
  }

  // Get metrics for specific time period
  getMetricsInPeriod(startTime: Date, endTime: Date): ApiMetrics[] {
    return this.metrics.filter((m) => m.timestamp >= startTime && m.timestamp <= endTime);
  }

  // Get error rate for endpoint
  getErrorRate(endpoint: string): number {
    const endpointMetrics = this.metrics.filter((m) => m.endpoint === endpoint);
    if (endpointMetrics.length === 0) return 0;

    const errors = endpointMetrics.filter((m) => m.statusCode >= 400);
    return errors.length / endpointMetrics.length;
  }

  // Get average response time
  getAverageResponseTime(endpoint?: string): number {
    const relevantMetrics = endpoint
      ? this.metrics.filter((m) => m.endpoint === endpoint)
      : this.metrics;

    if (relevantMetrics.length === 0) return 0;

    const totalTime = relevantMetrics.reduce((sum, m) => sum + m.responseTime, 0);
    return totalTime / relevantMetrics.length;
  }

  // Clear all data (for testing)
  clear(): void {
    this.metrics = [];
    this.errors = [];
  }
}

export const monitoringService = new MonitoringService();
