/**
 * X-Ray Distributed Tracing Service
 * Provides distributed tracing across all microservices
 */
import { Subsegment } from 'aws-xray-sdk-core';
export interface TraceMetadata {
    correlationId?: string;
    userId?: string;
    brandId?: string;
    [key: string]: any;
}
export declare class TracingService {
    private static instance;
    static getInstance(): TracingService;
    /**
     * Trace an operation with X-Ray
     */
    traceOperation<T>(operationName: string, operation: () => Promise<T>, metadata?: TraceMetadata): Promise<T>;
    /**
     * Trace an HTTP request
     */
    traceHttpRequest<T>(url: string, method: string, operation: () => Promise<T>, metadata?: TraceMetadata): Promise<T>;
    /**
     * Trace a database operation
     */
    traceDatabaseOperation<T>(tableName: string, operation: string, query: () => Promise<T>, metadata?: TraceMetadata): Promise<T>;
    /**
     * Add custom annotation to current segment
     */
    addAnnotation(key: string, value: string | number | boolean): void;
    /**
     * Add custom metadata to current segment
     */
    addMetadata(namespace: string, key: string, value: any): void;
    /**
     * Create a new subsegment for custom operations
     */
    createSubsegment(name: string): Subsegment | null;
    /**
     * Get correlation ID from current segment
     */
    getCorrelationId(): string | undefined;
    /**
     * Wrap a Lambda handler with X-Ray tracing
     */
    static traceLambdaHandler<TEvent, TResult>(handlerName: string, handler: (event: TEvent, context: any) => Promise<TResult>): (event: TEvent, context: any) => Promise<TResult>;
}
export declare const tracingService: TracingService;
