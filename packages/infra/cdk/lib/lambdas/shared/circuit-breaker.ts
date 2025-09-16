import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CIRCUIT_BREAKER_TABLE = process.env.CIRCUIT_BREAKER_TABLE || 'circuit-breaker-state';

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  persistState?: boolean; // Enable DynamoDB persistence
}

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  lastFailureTime?: number;
  successCount: number;
  lastUpdated: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private lastFailureTime?: number;
  private successCount: number = 0;
  private serviceName: string;
  private initialized: boolean = false;

  constructor(
    private options: CircuitBreakerOptions,
    serviceName?: string
  ) {
    this.serviceName = serviceName || 'default';
    // Load state asynchronously on first use
  }

  private async loadState(): Promise<void> {
    if (!this.options.persistState || this.initialized) return;

    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: CIRCUIT_BREAKER_TABLE,
          Key: { serviceName: this.serviceName },
        })
      );

      if (result.Item) {
        const savedState = result.Item as CircuitBreakerState;
        // Only restore if state is recent (within monitoring period)
        if (Date.now() - savedState.lastUpdated < this.options.monitoringPeriod) {
          this.state = savedState.state;
          this.failures = savedState.failures;
          this.lastFailureTime = savedState.lastFailureTime;
          this.successCount = savedState.successCount;
        }
      }
    } catch (error) {
      console.warn('Failed to load circuit breaker state:', error);
    } finally {
      this.initialized = true;
    }
  }

  private async saveState(): Promise<void> {
    if (!this.options.persistState) return;

    try {
      await docClient.send(
        new PutCommand({
          TableName: CIRCUIT_BREAKER_TABLE,
          Item: {
            serviceName: this.serviceName,
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime,
            successCount: this.successCount,
            lastUpdated: Date.now(),
            ttl: Math.floor(Date.now() / 1000) + 3600, // 1 hour TTL
          },
        })
      );
    } catch (error) {
      console.warn('Failed to save circuit breaker state:', error);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Load state on first execution
    await this.loadState();

    if (this.state === CircuitState.OPEN) {
      if (Date.now() - (this.lastFailureTime || 0) > this.options.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        await this.saveState();
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    } catch (error) {
      await this.onFailure();
      throw error;
    }
  }

  private async onSuccess(): Promise<void> {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= 3) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
      }
    } else {
      this.failures = 0;
    }
    await this.saveState();
  }

  private async onFailure(): Promise<void> {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.options.failureThreshold) {
      this.state = CircuitState.OPEN;
    }

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.successCount = 0;
    }
    await this.saveState();
  }

  getState(): CircuitState {
    return this.state;
  }
}

export class CircuitBreakerFactory {
  private breakers: Map<string, CircuitBreaker> = new Map();

  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(name)) {
      const defaultOptions: CircuitBreakerOptions = {
        failureThreshold: 5,
        resetTimeout: 60000, // 1 minute
        monitoringPeriod: 60000,
        persistState: process.env.NODE_ENV === 'prod', // Enable persistence in prod
        ...options,
      };
      this.breakers.set(name, new CircuitBreaker(defaultOptions, name));
    }
    return this.breakers.get(name)!;
  }
}
