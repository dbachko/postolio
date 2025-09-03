export interface CircuitBreakerOptions {
    failureThreshold: number;
    resetTimeout: number;
    monitoringPeriod: number;
    persistState?: boolean;
}
export declare enum CircuitState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}
export declare class CircuitBreaker {
    private options;
    private state;
    private failures;
    private lastFailureTime?;
    private successCount;
    private serviceName;
    private initialized;
    constructor(options: CircuitBreakerOptions, serviceName?: string);
    private loadState;
    private saveState;
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private onSuccess;
    private onFailure;
    getState(): CircuitState;
}
export declare class CircuitBreakerFactory {
    private breakers;
    getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker;
}
