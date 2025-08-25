/**
 * Circuit Breaker Implementation
 * Prevents cascading failures when external APIs are down
 */

import { Logger } from '@aws-lambda-powertools/logger'
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch'

const logger = new Logger({ serviceName: 'circuit-breaker' })
const cloudwatch = new CloudWatchClient({})

export interface CircuitBreakerConfig {
  name: string
  timeout: number              // Request timeout in ms
  errorThreshold: number       // Number of failures to open circuit
  errorThresholdPercentage: number  // Percentage of failures to open circuit
  resetTimeout: number         // Time before attempting to close circuit (ms)
  volumeThreshold: number      // Minimum requests before calculating error percentage
  bucketSize: number          // Time window for calculating metrics (ms)
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitMetrics {
  failures: number
  successes: number
  timeouts: number
  shortCircuits: number
  lastFailureTime?: number
  lastSuccessTime?: number
}

export class CircuitBreaker<T = any> {
  private state: CircuitState = CircuitState.CLOSED
  private metrics: CircuitMetrics = {
    failures: 0,
    successes: 0,
    timeouts: 0,
    shortCircuits: 0,
  }
  private nextAttempt: number = Date.now()
  private bucketStart: number = Date.now()
  
  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute function with circuit breaker protection
   */
  async execute<R>(fn: () => Promise<R>): Promise<R> {
    // Check if we need to reset the metrics bucket
    this.checkBucketReset()

    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        this.metrics.shortCircuits++
        await this.emitMetrics('ShortCircuit')
        throw new CircuitBreakerError(
          `Circuit breaker is OPEN for ${this.config.name}`,
          'CIRCUIT_OPEN'
        )
      }
      // Try half-open
      this.state = CircuitState.HALF_OPEN
      logger.info('Circuit breaker entering HALF_OPEN state', {
        name: this.config.name,
      })
    }

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn)
      
      // Record success
      this.onSuccess()
      
      return result
    } catch (error) {
      // Record failure
      this.onFailure(error)
      
      throw error
    }
  }

  /**
   * Execute function with timeout
   */
  private async executeWithTimeout<R>(fn: () => Promise<R>): Promise<R> {
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => 
        setTimeout(
          () => reject(new CircuitBreakerError('Request timeout', 'TIMEOUT')),
          this.config.timeout
        )
      ),
    ])
  }

  /**
   * Handle successful execution
   */
  private onSuccess(): void {
    this.metrics.successes++
    this.metrics.lastSuccessTime = Date.now()

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.CLOSED
      this.metrics.failures = 0
      logger.info('Circuit breaker CLOSED after successful half-open test', {
        name: this.config.name,
      })
    }

    this.emitMetrics('Success')
  }

  /**
   * Handle failed execution
   */
  private onFailure(error: unknown): void {
    this.metrics.failures++
    this.metrics.lastFailureTime = Date.now()

    if (error instanceof CircuitBreakerError && error.code === 'TIMEOUT') {
      this.metrics.timeouts++
    }

    // Check if we should open the circuit
    const totalRequests = this.metrics.successes + this.metrics.failures
    const shouldOpen = this.shouldOpenCircuit(totalRequests)

    if (shouldOpen) {
      this.state = CircuitState.OPEN
      this.nextAttempt = Date.now() + this.config.resetTimeout
      
      logger.warn('Circuit breaker OPENED', {
        name: this.config.name,
        failures: this.metrics.failures,
        totalRequests,
        nextAttempt: new Date(this.nextAttempt).toISOString(),
      })
      
      this.emitMetrics('CircuitOpened')
    }

    this.emitMetrics('Failure')
  }

  /**
   * Determine if circuit should open
   */
  private shouldOpenCircuit(totalRequests: number): boolean {
    // Check absolute threshold
    if (this.metrics.failures >= this.config.errorThreshold) {
      return true
    }

    // Check percentage threshold if we have enough volume
    if (totalRequests >= this.config.volumeThreshold) {
      const errorPercentage = (this.metrics.failures / totalRequests) * 100
      return errorPercentage >= this.config.errorThresholdPercentage
    }

    return false
  }

  /**
   * Check if metrics bucket should be reset
   */
  private checkBucketReset(): void {
    const now = Date.now()
    if (now - this.bucketStart >= this.config.bucketSize) {
      this.metrics = {
        failures: 0,
        successes: 0,
        timeouts: 0,
        shortCircuits: 0,
        lastFailureTime: this.metrics.lastFailureTime,
        lastSuccessTime: this.metrics.lastSuccessTime,
      }
      this.bucketStart = now
    }
  }

  /**
   * Emit CloudWatch metrics
   */
  private async emitMetrics(metricName: string): Promise<void> {
    try {
      await cloudwatch.send(new PutMetricDataCommand({
        Namespace: 'Postolio/CircuitBreaker',
        MetricData: [{
          MetricName: metricName,
          Value: 1,
          Unit: 'Count',
          Timestamp: new Date(),
          Dimensions: [
            { Name: 'CircuitName', Value: this.config.name },
            { Name: 'State', Value: this.state },
          ],
        }],
      }))
    } catch (error) {
      // Don't let metrics failure affect main flow
      logger.warn('Failed to emit metrics', { error })
    }
  }

  /**
   * Get current circuit state and metrics
   */
  getState(): { state: CircuitState; metrics: CircuitMetrics } {
    return {
      state: this.state,
      metrics: { ...this.metrics },
    }
  }

  /**
   * Manually reset the circuit
   */
  reset(): void {
    this.state = CircuitState.CLOSED
    this.metrics = {
      failures: 0,
      successes: 0,
      timeouts: 0,
      shortCircuits: 0,
    }
    this.nextAttempt = Date.now()
    logger.info('Circuit breaker manually reset', {
      name: this.config.name,
    })
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'CircuitBreakerError'
  }
}

/**
 * Factory for creating circuit breakers with default configs
 */
export class CircuitBreakerFactory {
  private static breakers = new Map<string, CircuitBreaker>()

  static getBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const defaultConfig: CircuitBreakerConfig = {
        name,
        timeout: 10000,               // 10 seconds
        errorThreshold: 5,            // 5 failures opens circuit
        errorThresholdPercentage: 50, // 50% failure rate opens circuit
        resetTimeout: 30000,          // 30 seconds before retry
        volumeThreshold: 10,          // Need 10 requests for percentage calculation
        bucketSize: 60000,           // 1 minute buckets
        ...config,
      }
      this.breakers.set(name, new CircuitBreaker(defaultConfig))
    }
    return this.breakers.get(name)!
  }

  static resetAll(): void {
    this.breakers.forEach(breaker => breaker.reset())
    this.breakers.clear()
  }
}