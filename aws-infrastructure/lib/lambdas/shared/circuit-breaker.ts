export interface CircuitBreakerOptions {
  failureThreshold: number
  resetTimeout: number
  monitoringPeriod: number
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED
  private failures: number = 0
  private lastFailureTime?: number
  private successCount: number = 0

  constructor(private options: CircuitBreakerOptions) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - (this.lastFailureTime || 0) > this.options.resetTimeout) {
        this.state = CircuitState.HALF_OPEN
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++
      if (this.successCount >= 3) {
        this.state = CircuitState.CLOSED
        this.failures = 0
        this.successCount = 0
      }
    } else {
      this.failures = 0
    }
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()
    
    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN
    }
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN
      this.successCount = 0
    }
  }

  getState(): CircuitState {
    return this.state
  }
}

export class CircuitBreakerFactory {
  private breakers: Map<string, CircuitBreaker> = new Map()

  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker(options || {
        failureThreshold: 5,
        resetTimeout: 60000, // 1 minute
        monitoringPeriod: 60000,
      }))
    }
    return this.breakers.get(name)!
  }
}
