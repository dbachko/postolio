/**
 * Dead Letter Queue Processor Service
 * Handles failed messages with automated retry and alerting
 */
export interface DLQMessage {
    messageId: string;
    body: string;
    attributes: Record<string, string>;
    messageAttributes?: Record<string, any>;
    receiptHandle: string;
    dlqName: string;
    originalQueue?: string;
    retryCount: number;
    firstFailureTime?: string;
    lastFailureTime?: string;
    errorMessage?: string;
}
export interface ProcessingResult {
    success: boolean;
    messageId: string;
    action: 'reprocessed' | 'deleted' | 'parked' | 'alerted';
    error?: string;
}
export interface DLQStats {
    queueName: string;
    totalMessages: number;
    processedMessages: number;
    failedMessages: number;
    parkedMessages: number;
    oldestMessageAge?: number;
    processingRate: number;
}
export declare class DLQProcessor {
    private static instance;
    private processingQueues;
    static getInstance(): DLQProcessor;
    /**
     * Process messages from a specific DLQ
     */
    processDLQ(dlqUrl: string, originalQueueUrl: string, processorFn?: (message: any) => Promise<boolean>): Promise<ProcessingResult[]>;
    /**
     * Process a single message
     */
    private processMessage;
    /**
     * Default processor - attempts to resend to original queue
     */
    private defaultProcessor;
    /**
     * Park message for manual inspection
     */
    private parkMessage;
    /**
     * Send alert for critical failures
     */
    private sendAlert;
    /**
     * Receive messages from DLQ
     */
    private receiveMessages;
    /**
     * Delete message from DLQ
     */
    private deleteMessage;
    /**
     * Requeue message with delay
     */
    private requeueMessage;
    /**
     * Load message processing state
     */
    private loadMessageState;
    /**
     * Batch load message states for performance optimization
     */
    private batchLoadMessageStates;
    /**
     * Update message processing state
     */
    private updateMessageState;
    /**
     * Clear message state after successful processing
     */
    private clearMessageState;
    /**
     * Calculate exponential backoff delay
     */
    private calculateBackoff;
    /**
     * Update CloudWatch metrics
     */
    private updateMetrics;
    /**
     * Check for critical thresholds
     */
    private checkThresholds;
    /**
     * Get DLQ statistics
     */
    getDLQStats(dlqName: string): Promise<DLQStats>;
    /**
     * Calculate message processing rate
     */
    private calculateProcessingRate;
    /**
     * Parse SQS message into DLQMessage
     */
    private parseSQSMessage;
    /**
     * Extract queue name from URL
     */
    private extractQueueName;
    /**
     * Manual reprocess parked messages
     */
    reprocessParkedMessages(dlqName: string, messageIds?: string[]): Promise<ProcessingResult[]>;
}
export declare const dlqProcessor: DLQProcessor;
