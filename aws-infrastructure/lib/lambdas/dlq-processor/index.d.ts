/**
 * DLQ Processor Lambda Handler
 * Automatically processes messages from Dead Letter Queues
 */
import { ScheduledEvent, Context } from 'aws-lambda';
/**
 * Lambda handler for scheduled DLQ processing
 */
export declare const handler: (event: ScheduledEvent, context: Context) => Promise<any>;
/**
 * Lambda handler for manual reprocessing
 */
export declare const reprocessHandler: (event: any, context: Context) => Promise<any>;
