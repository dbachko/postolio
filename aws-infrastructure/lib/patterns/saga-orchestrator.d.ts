/**
 * Saga Orchestrator Pattern
 * Manages distributed transactions across microservices with compensation
 */
export interface SagaStep<T = any> {
    name: string;
    service: string;
    forward: (context: T) => Promise<any>;
    compensate: (context: T, stepResult?: any) => Promise<void>;
    retryable?: boolean;
    maxRetries?: number;
    timeout?: number;
}
export interface SagaContext {
    sagaId: string;
    correlationId: string;
    userId: string;
    brandId: string;
    [key: string]: any;
}
export declare enum SagaStatus {
    PENDING = "PENDING",
    RUNNING = "RUNNING",
    COMPENSATING = "COMPENSATING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    COMPENSATED = "COMPENSATED"
}
export interface SagaState {
    sagaId: string;
    sagaType: string;
    status: SagaStatus;
    context: SagaContext;
    executedSteps: Array<{
        name: string;
        result?: any;
        startedAt: string;
        completedAt?: string;
        error?: any;
    }>;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
}
export declare class SagaOrchestrator<T extends SagaContext = SagaContext> {
    private steps;
    private sagaType;
    private state?;
    constructor(sagaType: string);
    /**
     * Add a step to the saga
     */
    addStep(step: SagaStep<T>): this;
    /**
     * Execute the saga
     */
    execute(context: T): Promise<T>;
    /**
     * Execute a single step with retry logic
     */
    private executeStep;
    /**
     * Compensate executed steps in reverse order
     */
    private compensate;
    /**
     * Initialize saga state in DynamoDB
     */
    private initializeSaga;
    /**
     * Update saga status
     */
    private updateSagaStatus;
    /**
     * Record step execution
     */
    private recordStepExecution;
    /**
     * Execute with timeout
     */
    private withTimeout;
    /**
     * Get saga state
     */
    static getSagaState(sagaId: string): Promise<SagaState | null>;
}
