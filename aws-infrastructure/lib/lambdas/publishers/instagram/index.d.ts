/**
 * Instagram Publisher Lambda
 * Implements security fixes, validation, circuit breaker, and idempotency
 */
import { SQSEvent } from 'aws-lambda';
/**
 * Main Lambda handler
 */
export declare const handler: (event: SQSEvent) => Promise<void>;
