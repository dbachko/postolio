/**
 * Retry utilities with exponential backoff and circuit breaker patterns
 * Implements reliability patterns for the Content Scheduler
 */
/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    exponentialBase?: number;
    jitter?: boolean;
    retryableErrors?: string[];
    onRetry?: (error: Error, attempt: number) => void;
}
/**
 * Platform-specific retry configurations
 */
export declare const PLATFORM_RETRY_CONFIGS: Record<string, RetryConfig>;
/**
 * Retry with exponential backoff
 */
export declare function retryWithBackoff<T>(operation: () => Promise<T>, config?: RetryConfig): Promise<T>;
/**
 * Circuit breaker state
 */
declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    resetTimeout?: number;
    onStateChange?: (oldState: CircuitState, newState: CircuitState) => void;
}
/**
 * Circuit breaker implementation
 */
export declare class CircuitBreaker {
    private state;
    private failures;
    private successes;
    private lastFailureTime;
    private readonly config;
    private readonly onStateChange?;
    constructor(config?: CircuitBreakerConfig);
    /**
     * Execute operation with circuit breaker protection
     */
    execute<T>(operation: () => Promise<T>): Promise<T>;
    /**
     * Handle successful operation
     */
    private onSuccess;
    /**
     * Handle failed operation
     */
    private onFailure;
    /**
     * Change circuit state
     */
    private setState;
    /**
     * Reset circuit breaker
     */
    private reset;
    /**
     * Get current state
     */
    getState(): CircuitState;
    /**
     * Get circuit breaker statistics
     */
    getStats(): {
        state: CircuitState;
        failures: number;
        successes: number;
    };
}
/**
 * Get or create circuit breaker for a platform
 */
export declare function getPlatformCircuitBreaker(platform: string): CircuitBreaker;
/**
 * Combine retry with circuit breaker
 */
export declare function retryWithCircuitBreaker<T>(operation: () => Promise<T>, platform: string, retryConfig?: RetryConfig): Promise<T>;
export {};
