"use strict";
/**
 * Dead Letter Queue Processor Service
 * Handles failed messages with automated retry and alerting
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dlqProcessor = exports.DLQProcessor = void 0;
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_sns_1 = require("@aws-sdk/client-sns");
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_cloudwatch_1 = require("@aws-sdk/client-cloudwatch");
const tracing_service_1 = require("./tracing-service");
const event_bus_service_1 = require("./event-bus-service");
const sqsClient = new client_sqs_1.SQSClient({});
const snsClient = new client_sns_1.SNSClient({});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const cloudWatchClient = new client_cloudwatch_1.CloudWatchClient({});
const tracingService = new tracing_service_1.TracingService();
const eventBus = event_bus_service_1.EventBusService.getInstance();
const DLQ_STATE_TABLE = process.env.DLQ_STATE_TABLE_NAME || 'dlq-processing-state';
const ALERT_TOPIC_ARN = process.env.DLQ_ALERT_TOPIC_ARN;
const MAX_RETRY_COUNT = parseInt(process.env.DLQ_MAX_RETRIES || '5');
const RETRY_DELAY_BASE = parseInt(process.env.DLQ_RETRY_DELAY_BASE || '60000'); // 1 minute base
class DLQProcessor {
    static instance;
    processingQueues = new Map();
    static getInstance() {
        if (!DLQProcessor.instance) {
            DLQProcessor.instance = new DLQProcessor();
        }
        return DLQProcessor.instance;
    }
    /**
     * Process messages from a specific DLQ
     */
    async processDLQ(dlqUrl, originalQueueUrl, processorFn) {
        const dlqName = this.extractQueueName(dlqUrl);
        const results = [];
        return await tracingService.traceOperation('DLQ.process', async () => {
            // Check if already processing this queue
            if (this.processingQueues.get(dlqName)) {
                console.log(`Already processing DLQ: ${dlqName}`);
                return [];
            }
            this.processingQueues.set(dlqName, true);
            try {
                // Receive messages from DLQ
                const messages = await this.receiveMessages(dlqUrl);
                // Batch load all message states for performance
                const messageIds = messages.map(msg => msg.MessageId || '');
                const messageStates = await this.batchLoadMessageStates(messageIds.filter(id => id));
                for (const message of messages) {
                    const result = await this.processMessage(message, dlqName, originalQueueUrl, processorFn, messageStates);
                    results.push(result);
                    // Update metrics
                    await this.updateMetrics(dlqName, result);
                }
                // Check for critical thresholds
                await this.checkThresholds(dlqName);
                return results;
            }
            finally {
                this.processingQueues.delete(dlqName);
            }
        }, { dlqName, messageCount: results.length });
    }
    /**
     * Process a single message
     */
    async processMessage(sqsMessage, dlqName, originalQueueUrl, processorFn, messageStates) {
        const message = this.parseSQSMessage(sqsMessage, dlqName);
        try {
            // Use batch-loaded state if available, otherwise load individually
            const state = messageStates?.get(message.messageId) || await this.loadMessageState(message.messageId);
            message.retryCount = state?.retryCount || 0;
            message.firstFailureTime = state?.firstFailureTime || new Date().toISOString();
            // Check if max retries exceeded
            if (message.retryCount >= MAX_RETRY_COUNT) {
                return await this.parkMessage(message);
            }
            // Check message age
            const messageAge = Date.now() - new Date(message.firstFailureTime || new Date().toISOString()).getTime();
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            if (messageAge > maxAge) {
                return await this.parkMessage(message, 'Message too old');
            }
            // Attempt to reprocess
            const success = processorFn
                ? await processorFn(JSON.parse(message.body))
                : await this.defaultProcessor(message, originalQueueUrl);
            if (success) {
                // Delete from DLQ
                await this.deleteMessage(dlqName, sqsMessage.ReceiptHandle);
                await this.clearMessageState(message.messageId);
                return {
                    success: true,
                    messageId: message.messageId,
                    action: 'reprocessed'
                };
            }
            else {
                // Update retry count
                await this.updateMessageState(message);
                // Calculate backoff delay
                const delay = this.calculateBackoff(message.retryCount);
                // Re-send to DLQ with delay
                await this.requeueMessage(message, dlqName, delay);
                return {
                    success: false,
                    messageId: message.messageId,
                    action: 'reprocessed',
                    error: 'Processing failed, message requeued'
                };
            }
        }
        catch (error) {
            console.error(`Error processing DLQ message: ${message.messageId}`, error);
            // Update error state
            message.errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.updateMessageState(message);
            // Alert if critical
            if (message.retryCount >= MAX_RETRY_COUNT - 1) {
                await this.sendAlert(message, error);
            }
            return {
                success: false,
                messageId: message.messageId,
                action: 'alerted',
                error: message.errorMessage
            };
        }
    }
    /**
     * Default processor - attempts to resend to original queue
     */
    async defaultProcessor(message, originalQueueUrl) {
        try {
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: originalQueueUrl,
                MessageBody: message.body,
                MessageAttributes: message.messageAttributes
            }));
            console.log(`Successfully reprocessed message ${message.messageId} to original queue`);
            return true;
        }
        catch (error) {
            console.error(`Failed to reprocess message ${message.messageId}`, error);
            return false;
        }
    }
    /**
     * Park message for manual inspection
     */
    async parkMessage(message, reason) {
        console.log(`Parking message ${message.messageId}: ${reason || 'Max retries exceeded'}`);
        // Store in DynamoDB for inspection
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: DLQ_STATE_TABLE,
            Item: {
                messageId: message.messageId,
                status: 'parked',
                dlqName: message.dlqName,
                body: message.body,
                attributes: message.attributes,
                retryCount: message.retryCount,
                firstFailureTime: message.firstFailureTime,
                lastFailureTime: new Date().toISOString(),
                parkReason: reason || 'Max retries exceeded',
                ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
            }
        }));
        // Send alert
        await this.sendAlert(message, new Error(reason || 'Message parked after max retries'));
        // Delete from DLQ
        if (message.receiptHandle) {
            await this.deleteMessage(message.dlqName, message.receiptHandle);
        }
        // Publish event
        await eventBus.publish('dlq.message.parked', {
            messageId: message.messageId,
            dlqName: message.dlqName,
            reason: reason || 'Max retries exceeded',
            retryCount: message.retryCount
        }, {
            correlationId: message.messageId,
            userId: 'system',
            brandId: 'system'
        });
        return {
            success: false,
            messageId: message.messageId,
            action: 'parked'
        };
    }
    /**
     * Send alert for critical failures
     */
    async sendAlert(message, error) {
        if (!ALERT_TOPIC_ARN)
            return;
        const alertMessage = {
            type: 'DLQ_PROCESSING_FAILURE',
            severity: message.retryCount >= MAX_RETRY_COUNT ? 'CRITICAL' : 'WARNING',
            dlqName: message.dlqName,
            messageId: message.messageId,
            retryCount: message.retryCount,
            firstFailureTime: message.firstFailureTime,
            errorMessage: error.message,
            messageBody: message.body.substring(0, 500), // Truncate for SNS limit
            timestamp: new Date().toISOString()
        };
        try {
            await snsClient.send(new client_sns_1.PublishCommand({
                TopicArn: ALERT_TOPIC_ARN,
                Subject: `[${alertMessage.severity}] DLQ Processing Failure - ${message.dlqName}`,
                Message: JSON.stringify(alertMessage, null, 2)
            }));
        }
        catch (alertError) {
            console.error('Failed to send DLQ alert', alertError);
        }
    }
    /**
     * Receive messages from DLQ
     */
    async receiveMessages(dlqUrl) {
        const result = await sqsClient.send(new client_sqs_1.ReceiveMessageCommand({
            QueueUrl: dlqUrl,
            MaxNumberOfMessages: 10,
            VisibilityTimeout: 300, // 5 minutes
            WaitTimeSeconds: 5,
            MessageAttributeNames: ['All'],
            AttributeNames: ['All']
        }));
        return result.Messages || [];
    }
    /**
     * Delete message from DLQ
     */
    async deleteMessage(dlqUrl, receiptHandle) {
        await sqsClient.send(new client_sqs_1.DeleteMessageCommand({
            QueueUrl: dlqUrl,
            ReceiptHandle: receiptHandle
        }));
    }
    /**
     * Requeue message with delay
     */
    async requeueMessage(message, dlqUrl, delaySeconds) {
        await sqsClient.send(new client_sqs_1.SendMessageCommand({
            QueueUrl: dlqUrl,
            MessageBody: message.body,
            DelaySeconds: Math.min(delaySeconds, 900), // Max 15 minutes
            MessageAttributes: {
                ...message.messageAttributes,
                RetryCount: {
                    DataType: 'Number',
                    StringValue: String(message.retryCount + 1)
                },
                LastFailureTime: {
                    DataType: 'String',
                    StringValue: new Date().toISOString()
                }
            }
        }));
        // Delete original message
        if (message.receiptHandle) {
            await this.deleteMessage(dlqUrl, message.receiptHandle);
        }
    }
    /**
     * Load message processing state
     */
    async loadMessageState(messageId) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: DLQ_STATE_TABLE,
                Key: { messageId }
            }));
            return result.Item;
        }
        catch {
            return null;
        }
    }
    /**
     * Batch load message states for performance optimization
     */
    async batchLoadMessageStates(messageIds) {
        const stateMap = new Map();
        if (messageIds.length === 0) {
            return stateMap;
        }
        // DynamoDB BatchGet has a limit of 100 items
        const batchSize = 100;
        for (let i = 0; i < messageIds.length; i += batchSize) {
            const batch = messageIds.slice(i, i + batchSize);
            const keys = batch.map(id => ({ messageId: id }));
            try {
                const result = await docClient.send(new lib_dynamodb_1.BatchGetCommand({
                    RequestItems: {
                        [DLQ_STATE_TABLE]: {
                            Keys: keys
                        }
                    }
                }));
                // Process responses
                const responses = result.Responses?.[DLQ_STATE_TABLE] || [];
                for (const item of responses) {
                    if (item.messageId) {
                        stateMap.set(item.messageId, item);
                    }
                }
            }
            catch (error) {
                console.error('Error batch loading message states:', error);
                // Fallback to individual loads for this batch if batch fails
                for (const messageId of batch) {
                    const state = await this.loadMessageState(messageId);
                    if (state) {
                        stateMap.set(messageId, state);
                    }
                }
            }
        }
        return stateMap;
    }
    /**
     * Update message processing state
     */
    async updateMessageState(message) {
        await docClient.send(new lib_dynamodb_1.UpdateCommand({
            TableName: DLQ_STATE_TABLE,
            Key: { messageId: message.messageId },
            UpdateExpression: 'SET retryCount = :retryCount, lastFailureTime = :lastFailure, errorMessage = :error, #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':retryCount': message.retryCount + 1,
                ':lastFailure': new Date().toISOString(),
                ':error': message.errorMessage || 'Unknown error',
                ':status': 'retrying'
            }
        }));
    }
    /**
     * Clear message state after successful processing
     */
    async clearMessageState(messageId) {
        try {
            await docClient.send(new lib_dynamodb_1.UpdateCommand({
                TableName: DLQ_STATE_TABLE,
                Key: { messageId },
                UpdateExpression: 'SET #status = :status, completedAt = :completedAt',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'completed',
                    ':completedAt': new Date().toISOString()
                }
            }));
        }
        catch {
            // Ignore if doesn't exist
        }
    }
    /**
     * Calculate exponential backoff delay
     */
    calculateBackoff(retryCount) {
        const delay = RETRY_DELAY_BASE * Math.pow(2, retryCount);
        const jitter = Math.random() * 0.3 * delay;
        return Math.floor(Math.min(delay + jitter, 900)); // Max 15 minutes
    }
    /**
     * Update CloudWatch metrics
     */
    async updateMetrics(dlqName, result) {
        const metrics = [];
        if (result.success) {
            metrics.push({
                MetricName: 'MessagesReprocessed',
                Value: 1,
                Unit: 'Count'
            });
        }
        else if (result.action === 'parked') {
            metrics.push({
                MetricName: 'MessagesParked',
                Value: 1,
                Unit: 'Count'
            });
        }
        else if (result.action === 'alerted') {
            metrics.push({
                MetricName: 'AlertsSent',
                Value: 1,
                Unit: 'Count'
            });
        }
        if (metrics.length > 0) {
            await cloudWatchClient.send(new client_cloudwatch_1.PutMetricDataCommand({
                Namespace: 'Postolio/DLQ',
                MetricData: metrics.map(m => ({
                    MetricName: m.MetricName,
                    Value: m.Value,
                    Unit: m.Unit,
                    Dimensions: [
                        { Name: 'QueueName', Value: dlqName },
                        { Name: 'Environment', Value: process.env.ENVIRONMENT || 'dev' }
                    ],
                    Timestamp: new Date()
                }))
            }));
        }
    }
    /**
     * Check for critical thresholds
     */
    async checkThresholds(dlqName) {
        const stats = await this.getDLQStats(dlqName);
        // Alert if too many messages in DLQ
        if (stats.totalMessages > 100) {
            await snsClient.send(new client_sns_1.PublishCommand({
                TopicArn: ALERT_TOPIC_ARN,
                Subject: `[WARNING] High DLQ message count - ${dlqName}`,
                Message: JSON.stringify({
                    type: 'HIGH_DLQ_COUNT',
                    dlqName,
                    totalMessages: stats.totalMessages,
                    threshold: 100,
                    timestamp: new Date().toISOString()
                })
            }));
        }
        // Alert if messages too old
        if (stats.oldestMessageAge && stats.oldestMessageAge > 24 * 60 * 60 * 1000) {
            await snsClient.send(new client_sns_1.PublishCommand({
                TopicArn: ALERT_TOPIC_ARN,
                Subject: `[WARNING] Old messages in DLQ - ${dlqName}`,
                Message: JSON.stringify({
                    type: 'OLD_DLQ_MESSAGES',
                    dlqName,
                    oldestMessageAge: stats.oldestMessageAge,
                    threshold: '24 hours',
                    timestamp: new Date().toISOString()
                })
            }));
        }
    }
    /**
     * Get DLQ statistics
     */
    async getDLQStats(dlqName) {
        const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: DLQ_STATE_TABLE,
            IndexName: 'by-dlq-status',
            KeyConditionExpression: 'dlqName = :dlqName',
            ExpressionAttributeValues: {
                ':dlqName': dlqName
            }
        }));
        const messages = result.Items || [];
        const now = Date.now();
        return {
            queueName: dlqName,
            totalMessages: messages.length,
            processedMessages: messages.filter(m => m.status === 'completed').length,
            failedMessages: messages.filter(m => m.status === 'failed').length,
            parkedMessages: messages.filter(m => m.status === 'parked').length,
            oldestMessageAge: messages.length > 0
                ? Math.max(...messages.map(m => now - new Date(m.firstFailureTime || m.createdAt).getTime()))
                : undefined,
            processingRate: this.calculateProcessingRate(messages)
        };
    }
    /**
     * Calculate message processing rate
     */
    calculateProcessingRate(messages) {
        const lastHour = Date.now() - 60 * 60 * 1000;
        const processedLastHour = messages.filter(m => m.status === 'completed' &&
            new Date(m.completedAt).getTime() > lastHour).length;
        return processedLastHour;
    }
    /**
     * Parse SQS message into DLQMessage
     */
    parseSQSMessage(sqsMessage, dlqName) {
        return {
            messageId: sqsMessage.MessageId,
            body: sqsMessage.Body,
            attributes: sqsMessage.Attributes || {},
            messageAttributes: sqsMessage.MessageAttributes,
            receiptHandle: sqsMessage.ReceiptHandle,
            dlqName,
            retryCount: parseInt(sqsMessage.MessageAttributes?.RetryCount?.StringValue || '0'),
            lastFailureTime: sqsMessage.MessageAttributes?.LastFailureTime?.StringValue
        };
    }
    /**
     * Extract queue name from URL
     */
    extractQueueName(queueUrl) {
        return queueUrl.split('/').pop() || 'unknown';
    }
    /**
     * Manual reprocess parked messages
     */
    async reprocessParkedMessages(dlqName, messageIds) {
        const query = messageIds
            ? { messageId: { $in: messageIds } }
            : { dlqName, status: 'parked' };
        const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
            TableName: DLQ_STATE_TABLE,
            IndexName: 'by-dlq-status',
            KeyConditionExpression: 'dlqName = :dlqName AND #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':dlqName': dlqName,
                ':status': 'parked'
            }
        }));
        const results = [];
        for (const item of result.Items || []) {
            // Reset retry count and reprocess
            const message = {
                messageId: item.messageId,
                body: item.body,
                attributes: item.attributes || {},
                messageAttributes: item.messageAttributes,
                receiptHandle: '',
                dlqName: item.dlqName,
                retryCount: 0,
                firstFailureTime: item.firstFailureTime
            };
            // Send back to original DLQ for reprocessing
            await sqsClient.send(new client_sqs_1.SendMessageCommand({
                QueueUrl: `${process.env.SQS_BASE_URL}/${dlqName}`,
                MessageBody: message.body,
                MessageAttributes: {
                    ...message.messageAttributes,
                    RetryCount: {
                        DataType: 'Number',
                        StringValue: '0'
                    },
                    ReprocessedAt: {
                        DataType: 'String',
                        StringValue: new Date().toISOString()
                    }
                }
            }));
            // Update state
            await docClient.send(new lib_dynamodb_1.UpdateCommand({
                TableName: DLQ_STATE_TABLE,
                Key: { messageId: item.messageId },
                UpdateExpression: 'SET #status = :status, reprocessedAt = :reprocessedAt',
                ExpressionAttributeNames: {
                    '#status': 'status'
                },
                ExpressionAttributeValues: {
                    ':status': 'reprocessing',
                    ':reprocessedAt': new Date().toISOString()
                }
            }));
            results.push({
                success: true,
                messageId: item.messageId,
                action: 'reprocessed'
            });
        }
        return results;
    }
}
exports.DLQProcessor = DLQProcessor;
// Export singleton instance
exports.dlqProcessor = DLQProcessor.getInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGxxLXByb2Nlc3Nvci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImRscS1wcm9jZXNzb3IudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IjtBQUFBOzs7R0FHRzs7O0FBRUgsb0RBQXlIO0FBQ3pILG9EQUErRDtBQUMvRCw4REFBeUQ7QUFDekQsd0RBQW9JO0FBQ3BJLGtFQUFnRztBQUNoRyx1REFBa0Q7QUFDbEQsMkRBQXFEO0FBRXJELE1BQU0sU0FBUyxHQUFHLElBQUksc0JBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQTtBQUNuQyxNQUFNLFNBQVMsR0FBRyxJQUFJLHNCQUFTLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDbkMsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQzNDLE1BQU0sU0FBUyxHQUFHLHFDQUFzQixDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsQ0FBQTtBQUMzRCxNQUFNLGdCQUFnQixHQUFHLElBQUksb0NBQWdCLENBQUMsRUFBRSxDQUFDLENBQUE7QUFDakQsTUFBTSxjQUFjLEdBQUcsSUFBSSxnQ0FBYyxFQUFFLENBQUE7QUFDM0MsTUFBTSxRQUFRLEdBQUcsbUNBQWUsQ0FBQyxXQUFXLEVBQUUsQ0FBQTtBQUU5QyxNQUFNLGVBQWUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixJQUFJLHNCQUFzQixDQUFBO0FBQ2xGLE1BQU0sZUFBZSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUE7QUFDdkQsTUFBTSxlQUFlLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLEdBQUcsQ0FBQyxDQUFBO0FBQ3BFLE1BQU0sZ0JBQWdCLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLElBQUksT0FBTyxDQUFDLENBQUEsQ0FBQyxnQkFBZ0I7QUFpQy9GLE1BQWEsWUFBWTtJQUNmLE1BQU0sQ0FBQyxRQUFRLENBQWM7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Q0FBQztnQkFDckMsU0FBUyxFQUFFLGVBQWU7Z0JBQzFCLEdBQUcsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLENBQUMsU0FBUyxFQUFFO2dCQUNsQyxnQkFBZ0IsRUFBRSx1REFBdUQ7Z0JBQ3pFLHdCQUF3QixFQUFFO29CQUN4QixTQUFTLEVBQUUsUUFBUTtpQkFDcEI7Z0JBQ0QseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxjQUFjO29CQUN6QixnQkFBZ0IsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtpQkFDM0M7YUFDRixDQUFDLENBQUMsQ0FBQTtZQUVILE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsU0FBUyxFQUFFLElBQUksQ0FBQyxTQUFTO2dCQUN6QixNQUFNLEVBQUUsYUFBYTthQUN0QixDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUE7SUFDaEIsQ0FBQztDQUNGO0FBdm5CRCxvQ0F1bkJDO0FBRUQsNEJBQTRCO0FBQ2YsUUFBQSxZQUFZLEdBQUcsWUFBWSxDQUFDLFdBQVcsRUFBRSxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBEZWFkIExldHRlciBRdWV1ZSBQcm9jZXNzb3IgU2VydmljZVxuICogSGFuZGxlcyBmYWlsZWQgbWVzc2FnZXMgd2l0aCBhdXRvbWF0ZWQgcmV0cnkgYW5kIGFsZXJ0aW5nXG4gKi9cblxuaW1wb3J0IHsgU1FTQ2xpZW50LCBTZW5kTWVzc2FnZUNvbW1hbmQsIERlbGV0ZU1lc3NhZ2VDb21tYW5kLCBSZWNlaXZlTWVzc2FnZUNvbW1hbmQsIE1lc3NhZ2UgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtc3FzJ1xuaW1wb3J0IHsgU05TQ2xpZW50LCBQdWJsaXNoQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYidcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIEdldENvbW1hbmQsIFVwZGF0ZUNvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgQmF0Y2hHZXRDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJ1xuaW1wb3J0IHsgQ2xvdWRXYXRjaENsaWVudCwgUHV0TWV0cmljRGF0YUNvbW1hbmQsIE1ldHJpY0RhdHVtIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWNsb3Vkd2F0Y2gnXG5pbXBvcnQgeyBUcmFjaW5nU2VydmljZSB9IGZyb20gJy4vdHJhY2luZy1zZXJ2aWNlJ1xuaW1wb3J0IHsgRXZlbnRCdXNTZXJ2aWNlIH0gZnJvbSAnLi9ldmVudC1idXMtc2VydmljZSdcblxuY29uc3Qgc3FzQ2xpZW50ID0gbmV3IFNRU0NsaWVudCh7fSlcbmNvbnN0IHNuc0NsaWVudCA9IG5ldyBTTlNDbGllbnQoe30pXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoe30pXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KVxuY29uc3QgY2xvdWRXYXRjaENsaWVudCA9IG5ldyBDbG91ZFdhdGNoQ2xpZW50KHt9KVxuY29uc3QgdHJhY2luZ1NlcnZpY2UgPSBuZXcgVHJhY2luZ1NlcnZpY2UoKVxuY29uc3QgZXZlbnRCdXMgPSBFdmVudEJ1c1NlcnZpY2UuZ2V0SW5zdGFuY2UoKVxuXG5jb25zdCBETFFfU1RBVEVfVEFCTEUgPSBwcm9jZXNzLmVudi5ETFFfU1RBVEVfVEFCTEVfTkFNRSB8fCAnZGxxLXByb2Nlc3Npbmctc3RhdGUnXG5jb25zdCBBTEVSVF9UT1BJQ19BUk4gPSBwcm9jZXNzLmVudi5ETFFfQUxFUlRfVE9QSUNfQVJOXG5jb25zdCBNQVhfUkVUUllfQ09VTlQgPSBwYXJzZUludChwcm9jZXNzLmVudi5ETFFfTUFYX1JFVFJJRVMgfHwgJzUnKVxuY29uc3QgUkVUUllfREVMQVlfQkFTRSA9IHBhcnNlSW50KHByb2Nlc3MuZW52LkRMUV9SRVRSWV9ERUxBWV9CQVNFIHx8ICc2MDAwMCcpIC8vIDEgbWludXRlIGJhc2VcblxuZXhwb3J0IGludGVyZmFjZSBETFFNZXNzYWdlIHtcbiAgbWVzc2FnZUlkOiBzdHJpbmdcbiAgYm9keTogc3RyaW5nXG4gIGF0dHJpYnV0ZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgbWVzc2FnZUF0dHJpYnV0ZXM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gIHJlY2VpcHRIYW5kbGU6IHN0cmluZ1xuICBkbHFOYW1lOiBzdHJpbmdcbiAgb3JpZ2luYWxRdWV1ZT86IHN0cmluZ1xuICByZXRyeUNvdW50OiBudW1iZXJcbiAgZmlyc3RGYWlsdXJlVGltZT86IHN0cmluZ1xuICBsYXN0RmFpbHVyZVRpbWU/OiBzdHJpbmdcbiAgZXJyb3JNZXNzYWdlPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHJvY2Vzc2luZ1Jlc3VsdCB7XG4gIHN1Y2Nlc3M6IGJvb2xlYW5cbiAgbWVzc2FnZUlkOiBzdHJpbmdcbiAgYWN0aW9uOiAncmVwcm9jZXNzZWQnIHwgJ2RlbGV0ZWQnIHwgJ3BhcmtlZCcgfCAnYWxlcnRlZCdcbiAgZXJyb3I/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBETFFTdGF0cyB7XG4gIHF1ZXVlTmFtZTogc3RyaW5nXG4gIHRvdGFsTWVzc2FnZXM6IG51bWJlclxuICBwcm9jZXNzZWRNZXNzYWdlczogbnVtYmVyXG4gIGZhaWxlZE1lc3NhZ2VzOiBudW1iZXJcbiAgcGFya2VkTWVzc2FnZXM6IG51bWJlclxuICBvbGRlc3RNZXNzYWdlQWdlPzogbnVtYmVyXG4gIHByb2Nlc3NpbmdSYXRlOiBudW1iZXJcbn1cblxuZXhwb3J0IGNsYXNzIERMUVByb2Nlc3NvciB7XG4gIHByaXZhdGUgc3RhdGljIGluc3RhbmNlOiBETFFQcm9jZXNzb3JcbiAgcHJpdmF0ZSBwcm9jZXNzaW5nUXVldWVzOiBNYXA8c3RyaW5nLCBib29sZWFuPiA9IG5ldyBNYXAoKVxuICBcbiAgc3RhdGljIGdldEluc3RhbmNlKCk6IERMUVByb2Nlc3NvciB7XG4gICAgaWYgKCFETFFQcm9jZXNzb3IuaW5zdGFuY2UpIHtcbiAgICAgIERMUVByb2Nlc3Nvci5pbnN0YW5jZSA9IG5ldyBETFFQcm9jZXNzb3IoKVxuICAgIH1cbiAgICByZXR1cm4gRExRUHJvY2Vzc29yLmluc3RhbmNlXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBQcm9jZXNzIG1lc3NhZ2VzIGZyb20gYSBzcGVjaWZpYyBETFFcbiAgICovXG4gIGFzeW5jIHByb2Nlc3NETFEoXG4gICAgZGxxVXJsOiBzdHJpbmcsXG4gICAgb3JpZ2luYWxRdWV1ZVVybDogc3RyaW5nLFxuICAgIHByb2Nlc3NvckZuPzogKG1lc3NhZ2U6IGFueSkgPT4gUHJvbWlzZTxib29sZWFuPlxuICApOiBQcm9taXNlPFByb2Nlc3NpbmdSZXN1bHRbXT4ge1xuICAgIGNvbnN0IGRscU5hbWUgPSB0aGlzLmV4dHJhY3RRdWV1ZU5hbWUoZGxxVXJsKVxuICAgIGNvbnN0IHJlc3VsdHM6IFByb2Nlc3NpbmdSZXN1bHRbXSA9IFtdXG4gICAgXG4gICAgcmV0dXJuIGF3YWl0IHRyYWNpbmdTZXJ2aWNlLnRyYWNlT3BlcmF0aW9uKCdETFEucHJvY2VzcycsIGFzeW5jICgpID0+IHtcbiAgICAgIC8vIENoZWNrIGlmIGFscmVhZHkgcHJvY2Vzc2luZyB0aGlzIHF1ZXVlXG4gICAgICBpZiAodGhpcy5wcm9jZXNzaW5nUXVldWVzLmdldChkbHFOYW1lKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQWxyZWFkeSBwcm9jZXNzaW5nIERMUTogJHtkbHFOYW1lfWApXG4gICAgICAgIHJldHVybiBbXVxuICAgICAgfVxuICAgICAgXG4gICAgICB0aGlzLnByb2Nlc3NpbmdRdWV1ZXMuc2V0KGRscU5hbWUsIHRydWUpXG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFJlY2VpdmUgbWVzc2FnZXMgZnJvbSBETFFcbiAgICAgICAgY29uc3QgbWVzc2FnZXMgPSBhd2FpdCB0aGlzLnJlY2VpdmVNZXNzYWdlcyhkbHFVcmwpXG4gICAgICAgIFxuICAgICAgICAvLyBCYXRjaCBsb2FkIGFsbCBtZXNzYWdlIHN0YXRlcyBmb3IgcGVyZm9ybWFuY2VcbiAgICAgICAgY29uc3QgbWVzc2FnZUlkcyA9IG1lc3NhZ2VzLm1hcChtc2cgPT4gbXNnLk1lc3NhZ2VJZCB8fCAnJylcbiAgICAgICAgY29uc3QgbWVzc2FnZVN0YXRlcyA9IGF3YWl0IHRoaXMuYmF0Y2hMb2FkTWVzc2FnZVN0YXRlcyhtZXNzYWdlSWRzLmZpbHRlcihpZCA9PiBpZCkpXG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgbWVzc2FnZXMpIHtcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NNZXNzYWdlKFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIGRscU5hbWUsXG4gICAgICAgICAgICBvcmlnaW5hbFF1ZXVlVXJsLFxuICAgICAgICAgICAgcHJvY2Vzc29yRm4sXG4gICAgICAgICAgICBtZXNzYWdlU3RhdGVzXG4gICAgICAgICAgKVxuICAgICAgICAgIHJlc3VsdHMucHVzaChyZXN1bHQpXG4gICAgICAgICAgXG4gICAgICAgICAgLy8gVXBkYXRlIG1ldHJpY3NcbiAgICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZU1ldHJpY3MoZGxxTmFtZSwgcmVzdWx0KVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBDaGVjayBmb3IgY3JpdGljYWwgdGhyZXNob2xkc1xuICAgICAgICBhd2FpdCB0aGlzLmNoZWNrVGhyZXNob2xkcyhkbHFOYW1lKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHJlc3VsdHNcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucHJvY2Vzc2luZ1F1ZXVlcy5kZWxldGUoZGxxTmFtZSlcbiAgICAgIH1cbiAgICB9LCB7IGRscU5hbWUsIG1lc3NhZ2VDb3VudDogcmVzdWx0cy5sZW5ndGggfSlcbiAgfVxuICBcbiAgLyoqXG4gICAqIFByb2Nlc3MgYSBzaW5nbGUgbWVzc2FnZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzTWVzc2FnZShcbiAgICBzcXNNZXNzYWdlOiBNZXNzYWdlLFxuICAgIGRscU5hbWU6IHN0cmluZyxcbiAgICBvcmlnaW5hbFF1ZXVlVXJsOiBzdHJpbmcsXG4gICAgcHJvY2Vzc29yRm4/OiAobWVzc2FnZTogYW55KSA9PiBQcm9taXNlPGJvb2xlYW4+LFxuICAgIG1lc3NhZ2VTdGF0ZXM/OiBNYXA8c3RyaW5nLCBhbnk+XG4gICk6IFByb21pc2U8UHJvY2Vzc2luZ1Jlc3VsdD4ge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLnBhcnNlU1FTTWVzc2FnZShzcXNNZXNzYWdlLCBkbHFOYW1lKVxuICAgIFxuICAgIHRyeSB7XG4gICAgICAvLyBVc2UgYmF0Y2gtbG9hZGVkIHN0YXRlIGlmIGF2YWlsYWJsZSwgb3RoZXJ3aXNlIGxvYWQgaW5kaXZpZHVhbGx5XG4gICAgICBjb25zdCBzdGF0ZSA9IG1lc3NhZ2VTdGF0ZXM/LmdldChtZXNzYWdlLm1lc3NhZ2VJZCkgfHwgYXdhaXQgdGhpcy5sb2FkTWVzc2FnZVN0YXRlKG1lc3NhZ2UubWVzc2FnZUlkKVxuICAgICAgbWVzc2FnZS5yZXRyeUNvdW50ID0gc3RhdGU/LnJldHJ5Q291bnQgfHwgMFxuICAgICAgbWVzc2FnZS5maXJzdEZhaWx1cmVUaW1lID0gc3RhdGU/LmZpcnN0RmFpbHVyZVRpbWUgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICBcbiAgICAgIC8vIENoZWNrIGlmIG1heCByZXRyaWVzIGV4Y2VlZGVkXG4gICAgICBpZiAobWVzc2FnZS5yZXRyeUNvdW50ID49IE1BWF9SRVRSWV9DT1VOVCkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5wYXJrTWVzc2FnZShtZXNzYWdlKVxuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBDaGVjayBtZXNzYWdlIGFnZVxuICAgICAgY29uc3QgbWVzc2FnZUFnZSA9IERhdGUubm93KCkgLSBuZXcgRGF0ZShtZXNzYWdlLmZpcnN0RmFpbHVyZVRpbWUgfHwgbmV3IERhdGUoKS50b0lTT1N0cmluZygpKS5nZXRUaW1lKClcbiAgICAgIGNvbnN0IG1heEFnZSA9IDcgKiAyNCAqIDYwICogNjAgKiAxMDAwIC8vIDcgZGF5c1xuICAgICAgXG4gICAgICBpZiAobWVzc2FnZUFnZSA+IG1heEFnZSkge1xuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5wYXJrTWVzc2FnZShtZXNzYWdlLCAnTWVzc2FnZSB0b28gb2xkJylcbiAgICAgIH1cbiAgICAgIFxuICAgICAgLy8gQXR0ZW1wdCB0byByZXByb2Nlc3NcbiAgICAgIGNvbnN0IHN1Y2Nlc3MgPSBwcm9jZXNzb3JGblxuICAgICAgICA/IGF3YWl0IHByb2Nlc3NvckZuKEpTT04ucGFyc2UobWVzc2FnZS5ib2R5KSlcbiAgICAgICAgOiBhd2FpdCB0aGlzLmRlZmF1bHRQcm9jZXNzb3IobWVzc2FnZSwgb3JpZ2luYWxRdWV1ZVVybClcbiAgICAgIFxuICAgICAgaWYgKHN1Y2Nlc3MpIHtcbiAgICAgICAgLy8gRGVsZXRlIGZyb20gRExRXG4gICAgICAgIGF3YWl0IHRoaXMuZGVsZXRlTWVzc2FnZShkbHFOYW1lLCBzcXNNZXNzYWdlLlJlY2VpcHRIYW5kbGUhKVxuICAgICAgICBhd2FpdCB0aGlzLmNsZWFyTWVzc2FnZVN0YXRlKG1lc3NhZ2UubWVzc2FnZUlkKVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgIG1lc3NhZ2VJZDogbWVzc2FnZS5tZXNzYWdlSWQsXG4gICAgICAgICAgYWN0aW9uOiAncmVwcm9jZXNzZWQnXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIFVwZGF0ZSByZXRyeSBjb3VudFxuICAgICAgICBhd2FpdCB0aGlzLnVwZGF0ZU1lc3NhZ2VTdGF0ZShtZXNzYWdlKVxuICAgICAgICBcbiAgICAgICAgLy8gQ2FsY3VsYXRlIGJhY2tvZmYgZGVsYXlcbiAgICAgICAgY29uc3QgZGVsYXkgPSB0aGlzLmNhbGN1bGF0ZUJhY2tvZmYobWVzc2FnZS5yZXRyeUNvdW50KVxuICAgICAgICBcbiAgICAgICAgLy8gUmUtc2VuZCB0byBETFEgd2l0aCBkZWxheVxuICAgICAgICBhd2FpdCB0aGlzLnJlcXVldWVNZXNzYWdlKG1lc3NhZ2UsIGRscU5hbWUsIGRlbGF5KVxuICAgICAgICBcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICBtZXNzYWdlSWQ6IG1lc3NhZ2UubWVzc2FnZUlkLFxuICAgICAgICAgIGFjdGlvbjogJ3JlcHJvY2Vzc2VkJyxcbiAgICAgICAgICBlcnJvcjogJ1Byb2Nlc3NpbmcgZmFpbGVkLCBtZXNzYWdlIHJlcXVldWVkJ1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgRExRIG1lc3NhZ2U6ICR7bWVzc2FnZS5tZXNzYWdlSWR9YCwgZXJyb3IpXG4gICAgICBcbiAgICAgIC8vIFVwZGF0ZSBlcnJvciBzdGF0ZVxuICAgICAgbWVzc2FnZS5lcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJ1xuICAgICAgYXdhaXQgdGhpcy51cGRhdGVNZXNzYWdlU3RhdGUobWVzc2FnZSlcbiAgICAgIFxuICAgICAgLy8gQWxlcnQgaWYgY3JpdGljYWxcbiAgICAgIGlmIChtZXNzYWdlLnJldHJ5Q291bnQgPj0gTUFYX1JFVFJZX0NPVU5UIC0gMSkge1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmRBbGVydChtZXNzYWdlLCBlcnJvciBhcyBFcnJvcilcbiAgICAgIH1cbiAgICAgIFxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIG1lc3NhZ2VJZDogbWVzc2FnZS5tZXNzYWdlSWQsXG4gICAgICAgIGFjdGlvbjogJ2FsZXJ0ZWQnLFxuICAgICAgICBlcnJvcjogbWVzc2FnZS5lcnJvck1lc3NhZ2VcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBEZWZhdWx0IHByb2Nlc3NvciAtIGF0dGVtcHRzIHRvIHJlc2VuZCB0byBvcmlnaW5hbCBxdWV1ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBkZWZhdWx0UHJvY2Vzc29yKG1lc3NhZ2U6IERMUU1lc3NhZ2UsIG9yaWdpbmFsUXVldWVVcmw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzcXNDbGllbnQuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcbiAgICAgICAgUXVldWVVcmw6IG9yaWdpbmFsUXVldWVVcmwsXG4gICAgICAgIE1lc3NhZ2VCb2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIE1lc3NhZ2VBdHRyaWJ1dGVzOiBtZXNzYWdlLm1lc3NhZ2VBdHRyaWJ1dGVzXG4gICAgICB9KSlcbiAgICAgIFxuICAgICAgY29uc29sZS5sb2coYFN1Y2Nlc3NmdWxseSByZXByb2Nlc3NlZCBtZXNzYWdlICR7bWVzc2FnZS5tZXNzYWdlSWR9IHRvIG9yaWdpbmFsIHF1ZXVlYClcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byByZXByb2Nlc3MgbWVzc2FnZSAke21lc3NhZ2UubWVzc2FnZUlkfWAsIGVycm9yKVxuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogUGFyayBtZXNzYWdlIGZvciBtYW51YWwgaW5zcGVjdGlvblxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBwYXJrTWVzc2FnZShtZXNzYWdlOiBETFFNZXNzYWdlLCByZWFzb24/OiBzdHJpbmcpOiBQcm9taXNlPFByb2Nlc3NpbmdSZXN1bHQ+IHtcbiAgICBjb25zb2xlLmxvZyhgUGFya2luZyBtZXNzYWdlICR7bWVzc2FnZS5tZXNzYWdlSWR9OiAke3JlYXNvbiB8fCAnTWF4IHJldHJpZXMgZXhjZWVkZWQnfWApXG4gICAgXG4gICAgLy8gU3RvcmUgaW4gRHluYW1vREIgZm9yIGluc3BlY3Rpb25cbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERMUV9TVEFURV9UQUJMRSxcbiAgICAgIEl0ZW06IHtcbiAgICAgICAgbWVzc2FnZUlkOiBtZXNzYWdlLm1lc3NhZ2VJZCxcbiAgICAgICAgc3RhdHVzOiAncGFya2VkJyxcbiAgICAgICAgZGxxTmFtZTogbWVzc2FnZS5kbHFOYW1lLFxuICAgICAgICBib2R5OiBtZXNzYWdlLmJvZHksXG4gICAgICAgIGF0dHJpYnV0ZXM6IG1lc3NhZ2UuYXR0cmlidXRlcyxcbiAgICAgICAgcmV0cnlDb3VudDogbWVzc2FnZS5yZXRyeUNvdW50LFxuICAgICAgICBmaXJzdEZhaWx1cmVUaW1lOiBtZXNzYWdlLmZpcnN0RmFpbHVyZVRpbWUsXG4gICAgICAgIGxhc3RGYWlsdXJlVGltZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBwYXJrUmVhc29uOiByZWFzb24gfHwgJ01heCByZXRyaWVzIGV4Y2VlZGVkJyxcbiAgICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICgzMCAqIDI0ICogNjAgKiA2MCkgLy8gMzAgZGF5cyBUVExcbiAgICAgIH1cbiAgICB9KSlcbiAgICBcbiAgICAvLyBTZW5kIGFsZXJ0XG4gICAgYXdhaXQgdGhpcy5zZW5kQWxlcnQobWVzc2FnZSwgbmV3IEVycm9yKHJlYXNvbiB8fCAnTWVzc2FnZSBwYXJrZWQgYWZ0ZXIgbWF4IHJldHJpZXMnKSlcbiAgICBcbiAgICAvLyBEZWxldGUgZnJvbSBETFFcbiAgICBpZiAobWVzc2FnZS5yZWNlaXB0SGFuZGxlKSB7XG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZU1lc3NhZ2UobWVzc2FnZS5kbHFOYW1lLCBtZXNzYWdlLnJlY2VpcHRIYW5kbGUpXG4gICAgfVxuICAgIFxuICAgIC8vIFB1Ymxpc2ggZXZlbnRcbiAgICBhd2FpdCBldmVudEJ1cy5wdWJsaXNoKCdkbHEubWVzc2FnZS5wYXJrZWQnLCB7XG4gICAgICBtZXNzYWdlSWQ6IG1lc3NhZ2UubWVzc2FnZUlkLFxuICAgICAgZGxxTmFtZTogbWVzc2FnZS5kbHFOYW1lLFxuICAgICAgcmVhc29uOiByZWFzb24gfHwgJ01heCByZXRyaWVzIGV4Y2VlZGVkJyxcbiAgICAgIHJldHJ5Q291bnQ6IG1lc3NhZ2UucmV0cnlDb3VudFxuICAgIH0sIHtcbiAgICAgIGNvcnJlbGF0aW9uSWQ6IG1lc3NhZ2UubWVzc2FnZUlkLFxuICAgICAgdXNlcklkOiAnc3lzdGVtJyxcbiAgICAgIGJyYW5kSWQ6ICdzeXN0ZW0nXG4gICAgfSlcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBtZXNzYWdlSWQ6IG1lc3NhZ2UubWVzc2FnZUlkLFxuICAgICAgYWN0aW9uOiAncGFya2VkJ1xuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIFNlbmQgYWxlcnQgZm9yIGNyaXRpY2FsIGZhaWx1cmVzXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHNlbmRBbGVydChtZXNzYWdlOiBETFFNZXNzYWdlLCBlcnJvcjogRXJyb3IpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIUFMRVJUX1RPUElDX0FSTikgcmV0dXJuXG4gICAgXG4gICAgY29uc3QgYWxlcnRNZXNzYWdlID0ge1xuICAgICAgdHlwZTogJ0RMUV9QUk9DRVNTSU5HX0ZBSUxVUkUnLFxuICAgICAgc2V2ZXJpdHk6IG1lc3NhZ2UucmV0cnlDb3VudCA+PSBNQVhfUkVUUllfQ09VTlQgPyAnQ1JJVElDQUwnIDogJ1dBUk5JTkcnLFxuICAgICAgZGxxTmFtZTogbWVzc2FnZS5kbHFOYW1lLFxuICAgICAgbWVzc2FnZUlkOiBtZXNzYWdlLm1lc3NhZ2VJZCxcbiAgICAgIHJldHJ5Q291bnQ6IG1lc3NhZ2UucmV0cnlDb3VudCxcbiAgICAgIGZpcnN0RmFpbHVyZVRpbWU6IG1lc3NhZ2UuZmlyc3RGYWlsdXJlVGltZSxcbiAgICAgIGVycm9yTWVzc2FnZTogZXJyb3IubWVzc2FnZSxcbiAgICAgIG1lc3NhZ2VCb2R5OiBtZXNzYWdlLmJvZHkuc3Vic3RyaW5nKDAsIDUwMCksIC8vIFRydW5jYXRlIGZvciBTTlMgbGltaXRcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgfVxuICAgIFxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzbnNDbGllbnQuc2VuZChuZXcgUHVibGlzaENvbW1hbmQoe1xuICAgICAgICBUb3BpY0FybjogQUxFUlRfVE9QSUNfQVJOLFxuICAgICAgICBTdWJqZWN0OiBgWyR7YWxlcnRNZXNzYWdlLnNldmVyaXR5fV0gRExRIFByb2Nlc3NpbmcgRmFpbHVyZSAtICR7bWVzc2FnZS5kbHFOYW1lfWAsXG4gICAgICAgIE1lc3NhZ2U6IEpTT04uc3RyaW5naWZ5KGFsZXJ0TWVzc2FnZSwgbnVsbCwgMilcbiAgICAgIH0pKVxuICAgIH0gY2F0Y2ggKGFsZXJ0RXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBzZW5kIERMUSBhbGVydCcsIGFsZXJ0RXJyb3IpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogUmVjZWl2ZSBtZXNzYWdlcyBmcm9tIERMUVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyByZWNlaXZlTWVzc2FnZXMoZGxxVXJsOiBzdHJpbmcpOiBQcm9taXNlPE1lc3NhZ2VbXT4ge1xuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNxc0NsaWVudC5zZW5kKG5ldyBSZWNlaXZlTWVzc2FnZUNvbW1hbmQoe1xuICAgICAgUXVldWVVcmw6IGRscVVybCxcbiAgICAgIE1heE51bWJlck9mTWVzc2FnZXM6IDEwLFxuICAgICAgVmlzaWJpbGl0eVRpbWVvdXQ6IDMwMCwgLy8gNSBtaW51dGVzXG4gICAgICBXYWl0VGltZVNlY29uZHM6IDUsXG4gICAgICBNZXNzYWdlQXR0cmlidXRlTmFtZXM6IFsnQWxsJ10sXG4gICAgICBBdHRyaWJ1dGVOYW1lczogWydBbGwnXVxuICAgIH0pKVxuICAgIFxuICAgIHJldHVybiByZXN1bHQuTWVzc2FnZXMgfHwgW11cbiAgfVxuICBcbiAgLyoqXG4gICAqIERlbGV0ZSBtZXNzYWdlIGZyb20gRExRXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGRlbGV0ZU1lc3NhZ2UoZGxxVXJsOiBzdHJpbmcsIHJlY2VpcHRIYW5kbGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHNxc0NsaWVudC5zZW5kKG5ldyBEZWxldGVNZXNzYWdlQ29tbWFuZCh7XG4gICAgICBRdWV1ZVVybDogZGxxVXJsLFxuICAgICAgUmVjZWlwdEhhbmRsZTogcmVjZWlwdEhhbmRsZVxuICAgIH0pKVxuICB9XG4gIFxuICAvKipcbiAgICogUmVxdWV1ZSBtZXNzYWdlIHdpdGggZGVsYXlcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcmVxdWV1ZU1lc3NhZ2UobWVzc2FnZTogRExRTWVzc2FnZSwgZGxxVXJsOiBzdHJpbmcsIGRlbGF5U2Vjb25kczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XG4gICAgICBRdWV1ZVVybDogZGxxVXJsLFxuICAgICAgTWVzc2FnZUJvZHk6IG1lc3NhZ2UuYm9keSxcbiAgICAgIERlbGF5U2Vjb25kczogTWF0aC5taW4oZGVsYXlTZWNvbmRzLCA5MDApLCAvLyBNYXggMTUgbWludXRlc1xuICAgICAgTWVzc2FnZUF0dHJpYnV0ZXM6IHtcbiAgICAgICAgLi4ubWVzc2FnZS5tZXNzYWdlQXR0cmlidXRlcyxcbiAgICAgICAgUmV0cnlDb3VudDoge1xuICAgICAgICAgIERhdGFUeXBlOiAnTnVtYmVyJyxcbiAgICAgICAgICBTdHJpbmdWYWx1ZTogU3RyaW5nKG1lc3NhZ2UucmV0cnlDb3VudCArIDEpXG4gICAgICAgIH0sXG4gICAgICAgIExhc3RGYWlsdXJlVGltZToge1xuICAgICAgICAgIERhdGFUeXBlOiAnU3RyaW5nJyxcbiAgICAgICAgICBTdHJpbmdWYWx1ZTogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KSlcbiAgICBcbiAgICAvLyBEZWxldGUgb3JpZ2luYWwgbWVzc2FnZVxuICAgIGlmIChtZXNzYWdlLnJlY2VpcHRIYW5kbGUpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlTWVzc2FnZShkbHFVcmwsIG1lc3NhZ2UucmVjZWlwdEhhbmRsZSlcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBMb2FkIG1lc3NhZ2UgcHJvY2Vzc2luZyBzdGF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBsb2FkTWVzc2FnZVN0YXRlKG1lc3NhZ2VJZDogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IERMUV9TVEFURV9UQUJMRSxcbiAgICAgICAgS2V5OiB7IG1lc3NhZ2VJZCB9XG4gICAgICB9KSlcbiAgICAgIHJldHVybiByZXN1bHQuSXRlbVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBCYXRjaCBsb2FkIG1lc3NhZ2Ugc3RhdGVzIGZvciBwZXJmb3JtYW5jZSBvcHRpbWl6YXRpb25cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgYmF0Y2hMb2FkTWVzc2FnZVN0YXRlcyhtZXNzYWdlSWRzOiBzdHJpbmdbXSk6IFByb21pc2U8TWFwPHN0cmluZywgYW55Pj4ge1xuICAgIGNvbnN0IHN0YXRlTWFwID0gbmV3IE1hcDxzdHJpbmcsIGFueT4oKVxuICAgIFxuICAgIGlmIChtZXNzYWdlSWRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHN0YXRlTWFwXG4gICAgfVxuICAgIFxuICAgIC8vIER5bmFtb0RCIEJhdGNoR2V0IGhhcyBhIGxpbWl0IG9mIDEwMCBpdGVtc1xuICAgIGNvbnN0IGJhdGNoU2l6ZSA9IDEwMFxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbWVzc2FnZUlkcy5sZW5ndGg7IGkgKz0gYmF0Y2hTaXplKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IG1lc3NhZ2VJZHMuc2xpY2UoaSwgaSArIGJhdGNoU2l6ZSlcbiAgICAgIGNvbnN0IGtleXMgPSBiYXRjaC5tYXAoaWQgPT4gKHsgbWVzc2FnZUlkOiBpZCB9KSlcbiAgICAgIFxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEJhdGNoR2V0Q29tbWFuZCh7XG4gICAgICAgICAgUmVxdWVzdEl0ZW1zOiB7XG4gICAgICAgICAgICBbRExRX1NUQVRFX1RBQkxFXToge1xuICAgICAgICAgICAgICBLZXlzOiBrZXlzXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KSlcbiAgICAgICAgXG4gICAgICAgIC8vIFByb2Nlc3MgcmVzcG9uc2VzXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlcyA9IHJlc3VsdC5SZXNwb25zZXM/LltETFFfU1RBVEVfVEFCTEVdIHx8IFtdXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiByZXNwb25zZXMpIHtcbiAgICAgICAgICBpZiAoaXRlbS5tZXNzYWdlSWQpIHtcbiAgICAgICAgICAgIHN0YXRlTWFwLnNldChpdGVtLm1lc3NhZ2VJZCwgaXRlbSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGJhdGNoIGxvYWRpbmcgbWVzc2FnZSBzdGF0ZXM6JywgZXJyb3IpXG4gICAgICAgIC8vIEZhbGxiYWNrIHRvIGluZGl2aWR1YWwgbG9hZHMgZm9yIHRoaXMgYmF0Y2ggaWYgYmF0Y2ggZmFpbHNcbiAgICAgICAgZm9yIChjb25zdCBtZXNzYWdlSWQgb2YgYmF0Y2gpIHtcbiAgICAgICAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZE1lc3NhZ2VTdGF0ZShtZXNzYWdlSWQpXG4gICAgICAgICAgaWYgKHN0YXRlKSB7XG4gICAgICAgICAgICBzdGF0ZU1hcC5zZXQobWVzc2FnZUlkLCBzdGF0ZSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHN0YXRlTWFwXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBVcGRhdGUgbWVzc2FnZSBwcm9jZXNzaW5nIHN0YXRlXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHVwZGF0ZU1lc3NhZ2VTdGF0ZShtZXNzYWdlOiBETFFNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgVGFibGVOYW1lOiBETFFfU1RBVEVfVEFCTEUsXG4gICAgICBLZXk6IHsgbWVzc2FnZUlkOiBtZXNzYWdlLm1lc3NhZ2VJZCB9LFxuICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCByZXRyeUNvdW50ID0gOnJldHJ5Q291bnQsIGxhc3RGYWlsdXJlVGltZSA9IDpsYXN0RmFpbHVyZSwgZXJyb3JNZXNzYWdlID0gOmVycm9yLCAjc3RhdHVzID0gOnN0YXR1cycsXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlTmFtZXM6IHtcbiAgICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJ1xuICAgICAgfSxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgJzpyZXRyeUNvdW50JzogbWVzc2FnZS5yZXRyeUNvdW50ICsgMSxcbiAgICAgICAgJzpsYXN0RmFpbHVyZSc6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgJzplcnJvcic6IG1lc3NhZ2UuZXJyb3JNZXNzYWdlIHx8ICdVbmtub3duIGVycm9yJyxcbiAgICAgICAgJzpzdGF0dXMnOiAncmV0cnlpbmcnXG4gICAgICB9XG4gICAgfSkpXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBDbGVhciBtZXNzYWdlIHN0YXRlIGFmdGVyIHN1Y2Nlc3NmdWwgcHJvY2Vzc2luZ1xuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjbGVhck1lc3NhZ2VTdGF0ZShtZXNzYWdlSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgVXBkYXRlQ29tbWFuZCh7XG4gICAgICAgIFRhYmxlTmFtZTogRExRX1NUQVRFX1RBQkxFLFxuICAgICAgICBLZXk6IHsgbWVzc2FnZUlkIH0sXG4gICAgICAgIFVwZGF0ZUV4cHJlc3Npb246ICdTRVQgI3N0YXR1cyA9IDpzdGF0dXMsIGNvbXBsZXRlZEF0ID0gOmNvbXBsZXRlZEF0JyxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJ1xuICAgICAgICB9LFxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgJzpzdGF0dXMnOiAnY29tcGxldGVkJyxcbiAgICAgICAgICAnOmNvbXBsZXRlZEF0JzogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH1cbiAgICAgIH0pKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gSWdub3JlIGlmIGRvZXNuJ3QgZXhpc3RcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBDYWxjdWxhdGUgZXhwb25lbnRpYWwgYmFja29mZiBkZWxheVxuICAgKi9cbiAgcHJpdmF0ZSBjYWxjdWxhdGVCYWNrb2ZmKHJldHJ5Q291bnQ6IG51bWJlcik6IG51bWJlciB7XG4gICAgY29uc3QgZGVsYXkgPSBSRVRSWV9ERUxBWV9CQVNFICogTWF0aC5wb3coMiwgcmV0cnlDb3VudClcbiAgICBjb25zdCBqaXR0ZXIgPSBNYXRoLnJhbmRvbSgpICogMC4zICogZGVsYXlcbiAgICByZXR1cm4gTWF0aC5mbG9vcihNYXRoLm1pbihkZWxheSArIGppdHRlciwgOTAwKSkgLy8gTWF4IDE1IG1pbnV0ZXNcbiAgfVxuICBcbiAgLyoqXG4gICAqIFVwZGF0ZSBDbG91ZFdhdGNoIG1ldHJpY3NcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTWV0cmljcyhkbHFOYW1lOiBzdHJpbmcsIHJlc3VsdDogUHJvY2Vzc2luZ1Jlc3VsdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1ldHJpY3M6IFBhcnRpYWw8TWV0cmljRGF0dW0+W10gPSBbXVxuICAgIFxuICAgIGlmIChyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ01lc3NhZ2VzUmVwcm9jZXNzZWQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50J1xuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHJlc3VsdC5hY3Rpb24gPT09ICdwYXJrZWQnKSB7XG4gICAgICBtZXRyaWNzLnB1c2goe1xuICAgICAgICBNZXRyaWNOYW1lOiAnTWVzc2FnZXNQYXJrZWQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50J1xuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHJlc3VsdC5hY3Rpb24gPT09ICdhbGVydGVkJykge1xuICAgICAgbWV0cmljcy5wdXNoKHtcbiAgICAgICAgTWV0cmljTmFtZTogJ0FsZXJ0c1NlbnQnLFxuICAgICAgICBWYWx1ZTogMSxcbiAgICAgICAgVW5pdDogJ0NvdW50J1xuICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgaWYgKG1ldHJpY3MubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgY2xvdWRXYXRjaENsaWVudC5zZW5kKG5ldyBQdXRNZXRyaWNEYXRhQ29tbWFuZCh7XG4gICAgICAgIE5hbWVzcGFjZTogJ1Bvc3RvbGlvL0RMUScsXG4gICAgICAgIE1ldHJpY0RhdGE6IG1ldHJpY3MubWFwKG0gPT4gKHtcbiAgICAgICAgICBNZXRyaWNOYW1lOiBtLk1ldHJpY05hbWUhLFxuICAgICAgICAgIFZhbHVlOiBtLlZhbHVlLFxuICAgICAgICAgIFVuaXQ6IG0uVW5pdCxcbiAgICAgICAgICBEaW1lbnNpb25zOiBbXG4gICAgICAgICAgICB7IE5hbWU6ICdRdWV1ZU5hbWUnLCBWYWx1ZTogZGxxTmFtZSB9LFxuICAgICAgICAgICAgeyBOYW1lOiAnRW52aXJvbm1lbnQnLCBWYWx1ZTogcHJvY2Vzcy5lbnYuRU5WSVJPTk1FTlQgfHwgJ2RldicgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgVGltZXN0YW1wOiBuZXcgRGF0ZSgpXG4gICAgICAgIH0pIGFzIE1ldHJpY0RhdHVtKVxuICAgICAgfSkpXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogQ2hlY2sgZm9yIGNyaXRpY2FsIHRocmVzaG9sZHNcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tUaHJlc2hvbGRzKGRscU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgdGhpcy5nZXRETFFTdGF0cyhkbHFOYW1lKVxuICAgIFxuICAgIC8vIEFsZXJ0IGlmIHRvbyBtYW55IG1lc3NhZ2VzIGluIERMUVxuICAgIGlmIChzdGF0cy50b3RhbE1lc3NhZ2VzID4gMTAwKSB7XG4gICAgICBhd2FpdCBzbnNDbGllbnQuc2VuZChuZXcgUHVibGlzaENvbW1hbmQoe1xuICAgICAgICBUb3BpY0FybjogQUxFUlRfVE9QSUNfQVJOLFxuICAgICAgICBTdWJqZWN0OiBgW1dBUk5JTkddIEhpZ2ggRExRIG1lc3NhZ2UgY291bnQgLSAke2RscU5hbWV9YCxcbiAgICAgICAgTWVzc2FnZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHR5cGU6ICdISUdIX0RMUV9DT1VOVCcsXG4gICAgICAgICAgZGxxTmFtZSxcbiAgICAgICAgICB0b3RhbE1lc3NhZ2VzOiBzdGF0cy50b3RhbE1lc3NhZ2VzLFxuICAgICAgICAgIHRocmVzaG9sZDogMTAwLFxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH0pXG4gICAgICB9KSlcbiAgICB9XG4gICAgXG4gICAgLy8gQWxlcnQgaWYgbWVzc2FnZXMgdG9vIG9sZFxuICAgIGlmIChzdGF0cy5vbGRlc3RNZXNzYWdlQWdlICYmIHN0YXRzLm9sZGVzdE1lc3NhZ2VBZ2UgPiAyNCAqIDYwICogNjAgKiAxMDAwKSB7XG4gICAgICBhd2FpdCBzbnNDbGllbnQuc2VuZChuZXcgUHVibGlzaENvbW1hbmQoe1xuICAgICAgICBUb3BpY0FybjogQUxFUlRfVE9QSUNfQVJOLFxuICAgICAgICBTdWJqZWN0OiBgW1dBUk5JTkddIE9sZCBtZXNzYWdlcyBpbiBETFEgLSAke2RscU5hbWV9YCxcbiAgICAgICAgTWVzc2FnZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIHR5cGU6ICdPTERfRExRX01FU1NBR0VTJyxcbiAgICAgICAgICBkbHFOYW1lLFxuICAgICAgICAgIG9sZGVzdE1lc3NhZ2VBZ2U6IHN0YXRzLm9sZGVzdE1lc3NhZ2VBZ2UsXG4gICAgICAgICAgdGhyZXNob2xkOiAnMjQgaG91cnMnLFxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgIH0pXG4gICAgICB9KSlcbiAgICB9XG4gIH1cbiAgXG4gIC8qKlxuICAgKiBHZXQgRExRIHN0YXRpc3RpY3NcbiAgICovXG4gIGFzeW5jIGdldERMUVN0YXRzKGRscU5hbWU6IHN0cmluZyk6IFByb21pc2U8RExRU3RhdHM+IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcbiAgICAgIFRhYmxlTmFtZTogRExRX1NUQVRFX1RBQkxFLFxuICAgICAgSW5kZXhOYW1lOiAnYnktZGxxLXN0YXR1cycsXG4gICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnZGxxTmFtZSA9IDpkbHFOYW1lJyxcbiAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcbiAgICAgICAgJzpkbHFOYW1lJzogZGxxTmFtZVxuICAgICAgfVxuICAgIH0pKVxuICAgIFxuICAgIGNvbnN0IG1lc3NhZ2VzID0gcmVzdWx0Lkl0ZW1zIHx8IFtdXG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKVxuICAgIFxuICAgIHJldHVybiB7XG4gICAgICBxdWV1ZU5hbWU6IGRscU5hbWUsXG4gICAgICB0b3RhbE1lc3NhZ2VzOiBtZXNzYWdlcy5sZW5ndGgsXG4gICAgICBwcm9jZXNzZWRNZXNzYWdlczogbWVzc2FnZXMuZmlsdGVyKG0gPT4gbS5zdGF0dXMgPT09ICdjb21wbGV0ZWQnKS5sZW5ndGgsXG4gICAgICBmYWlsZWRNZXNzYWdlczogbWVzc2FnZXMuZmlsdGVyKG0gPT4gbS5zdGF0dXMgPT09ICdmYWlsZWQnKS5sZW5ndGgsXG4gICAgICBwYXJrZWRNZXNzYWdlczogbWVzc2FnZXMuZmlsdGVyKG0gPT4gbS5zdGF0dXMgPT09ICdwYXJrZWQnKS5sZW5ndGgsXG4gICAgICBvbGRlc3RNZXNzYWdlQWdlOiBtZXNzYWdlcy5sZW5ndGggPiAwXG4gICAgICAgID8gTWF0aC5tYXgoLi4ubWVzc2FnZXMubWFwKG0gPT4gbm93IC0gbmV3IERhdGUobS5maXJzdEZhaWx1cmVUaW1lIHx8IG0uY3JlYXRlZEF0KS5nZXRUaW1lKCkpKVxuICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIHByb2Nlc3NpbmdSYXRlOiB0aGlzLmNhbGN1bGF0ZVByb2Nlc3NpbmdSYXRlKG1lc3NhZ2VzKVxuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIENhbGN1bGF0ZSBtZXNzYWdlIHByb2Nlc3NpbmcgcmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBjYWxjdWxhdGVQcm9jZXNzaW5nUmF0ZShtZXNzYWdlczogYW55W10pOiBudW1iZXIge1xuICAgIGNvbnN0IGxhc3RIb3VyID0gRGF0ZS5ub3coKSAtIDYwICogNjAgKiAxMDAwXG4gICAgY29uc3QgcHJvY2Vzc2VkTGFzdEhvdXIgPSBtZXNzYWdlcy5maWx0ZXIobSA9PiBcbiAgICAgIG0uc3RhdHVzID09PSAnY29tcGxldGVkJyAmJiBcbiAgICAgIG5ldyBEYXRlKG0uY29tcGxldGVkQXQpLmdldFRpbWUoKSA+IGxhc3RIb3VyXG4gICAgKS5sZW5ndGhcbiAgICByZXR1cm4gcHJvY2Vzc2VkTGFzdEhvdXJcbiAgfVxuICBcbiAgLyoqXG4gICAqIFBhcnNlIFNRUyBtZXNzYWdlIGludG8gRExRTWVzc2FnZVxuICAgKi9cbiAgcHJpdmF0ZSBwYXJzZVNRU01lc3NhZ2Uoc3FzTWVzc2FnZTogTWVzc2FnZSwgZGxxTmFtZTogc3RyaW5nKTogRExRTWVzc2FnZSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG1lc3NhZ2VJZDogc3FzTWVzc2FnZS5NZXNzYWdlSWQhLFxuICAgICAgYm9keTogc3FzTWVzc2FnZS5Cb2R5ISxcbiAgICAgIGF0dHJpYnV0ZXM6IHNxc01lc3NhZ2UuQXR0cmlidXRlcyB8fCB7fSxcbiAgICAgIG1lc3NhZ2VBdHRyaWJ1dGVzOiBzcXNNZXNzYWdlLk1lc3NhZ2VBdHRyaWJ1dGVzLFxuICAgICAgcmVjZWlwdEhhbmRsZTogc3FzTWVzc2FnZS5SZWNlaXB0SGFuZGxlISxcbiAgICAgIGRscU5hbWUsXG4gICAgICByZXRyeUNvdW50OiBwYXJzZUludChzcXNNZXNzYWdlLk1lc3NhZ2VBdHRyaWJ1dGVzPy5SZXRyeUNvdW50Py5TdHJpbmdWYWx1ZSB8fCAnMCcpLFxuICAgICAgbGFzdEZhaWx1cmVUaW1lOiBzcXNNZXNzYWdlLk1lc3NhZ2VBdHRyaWJ1dGVzPy5MYXN0RmFpbHVyZVRpbWU/LlN0cmluZ1ZhbHVlXG4gICAgfVxuICB9XG4gIFxuICAvKipcbiAgICogRXh0cmFjdCBxdWV1ZSBuYW1lIGZyb20gVVJMXG4gICAqL1xuICBwcml2YXRlIGV4dHJhY3RRdWV1ZU5hbWUocXVldWVVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHF1ZXVlVXJsLnNwbGl0KCcvJykucG9wKCkgfHwgJ3Vua25vd24nXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBNYW51YWwgcmVwcm9jZXNzIHBhcmtlZCBtZXNzYWdlc1xuICAgKi9cbiAgYXN5bmMgcmVwcm9jZXNzUGFya2VkTWVzc2FnZXMoZGxxTmFtZTogc3RyaW5nLCBtZXNzYWdlSWRzPzogc3RyaW5nW10pOiBQcm9taXNlPFByb2Nlc3NpbmdSZXN1bHRbXT4ge1xuICAgIGNvbnN0IHF1ZXJ5ID0gbWVzc2FnZUlkc1xuICAgICAgPyB7IG1lc3NhZ2VJZDogeyAkaW46IG1lc3NhZ2VJZHMgfSB9XG4gICAgICA6IHsgZGxxTmFtZSwgc3RhdHVzOiAncGFya2VkJyB9XG4gICAgXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XG4gICAgICBUYWJsZU5hbWU6IERMUV9TVEFURV9UQUJMRSxcbiAgICAgIEluZGV4TmFtZTogJ2J5LWRscS1zdGF0dXMnLFxuICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2RscU5hbWUgPSA6ZGxxTmFtZSBBTkQgI3N0YXR1cyA9IDpzdGF0dXMnLFxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICcjc3RhdHVzJzogJ3N0YXR1cydcbiAgICAgIH0sXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICc6ZGxxTmFtZSc6IGRscU5hbWUsXG4gICAgICAgICc6c3RhdHVzJzogJ3BhcmtlZCdcbiAgICAgIH1cbiAgICB9KSlcbiAgICBcbiAgICBjb25zdCByZXN1bHRzOiBQcm9jZXNzaW5nUmVzdWx0W10gPSBbXVxuICAgIFxuICAgIGZvciAoY29uc3QgaXRlbSBvZiByZXN1bHQuSXRlbXMgfHwgW10pIHtcbiAgICAgIC8vIFJlc2V0IHJldHJ5IGNvdW50IGFuZCByZXByb2Nlc3NcbiAgICAgIGNvbnN0IG1lc3NhZ2U6IERMUU1lc3NhZ2UgPSB7XG4gICAgICAgIG1lc3NhZ2VJZDogaXRlbS5tZXNzYWdlSWQsXG4gICAgICAgIGJvZHk6IGl0ZW0uYm9keSxcbiAgICAgICAgYXR0cmlidXRlczogaXRlbS5hdHRyaWJ1dGVzIHx8IHt9LFxuICAgICAgICBtZXNzYWdlQXR0cmlidXRlczogaXRlbS5tZXNzYWdlQXR0cmlidXRlcyxcbiAgICAgICAgcmVjZWlwdEhhbmRsZTogJycsXG4gICAgICAgIGRscU5hbWU6IGl0ZW0uZGxxTmFtZSxcbiAgICAgICAgcmV0cnlDb3VudDogMCxcbiAgICAgICAgZmlyc3RGYWlsdXJlVGltZTogaXRlbS5maXJzdEZhaWx1cmVUaW1lXG4gICAgICB9XG4gICAgICBcbiAgICAgIC8vIFNlbmQgYmFjayB0byBvcmlnaW5hbCBETFEgZm9yIHJlcHJvY2Vzc2luZ1xuICAgICAgYXdhaXQgc3FzQ2xpZW50LnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XG4gICAgICAgIFF1ZXVlVXJsOiBgJHtwcm9jZXNzLmVudi5TUVNfQkFTRV9VUkx9LyR7ZGxxTmFtZX1gLFxuICAgICAgICBNZXNzYWdlQm9keTogbWVzc2FnZS5ib2R5LFxuICAgICAgICBNZXNzYWdlQXR0cmlidXRlczoge1xuICAgICAgICAgIC4uLm1lc3NhZ2UubWVzc2FnZUF0dHJpYnV0ZXMsXG4gICAgICAgICAgUmV0cnlDb3VudDoge1xuICAgICAgICAgICAgRGF0YVR5cGU6ICdOdW1iZXInLFxuICAgICAgICAgICAgU3RyaW5nVmFsdWU6ICcwJ1xuICAgICAgICAgIH0sXG4gICAgICAgICAgUmVwcm9jZXNzZWRBdDoge1xuICAgICAgICAgICAgRGF0YVR5cGU6ICdTdHJpbmcnLFxuICAgICAgICAgICAgU3RyaW5nVmFsdWU6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSkpXG4gICAgICBcbiAgICAgIC8vIFVwZGF0ZSBzdGF0ZVxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFVwZGF0ZUNvbW1hbmQoe1xuICAgICAgICBUYWJsZU5hbWU6IERMUV9TVEFURV9UQUJMRSxcbiAgICAgICAgS2V5OiB7IG1lc3NhZ2VJZDogaXRlbS5tZXNzYWdlSWQgfSxcbiAgICAgICAgVXBkYXRlRXhwcmVzc2lvbjogJ1NFVCAjc3RhdHVzID0gOnN0YXR1cywgcmVwcm9jZXNzZWRBdCA9IDpyZXByb2Nlc3NlZEF0JyxcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZU5hbWVzOiB7XG4gICAgICAgICAgJyNzdGF0dXMnOiAnc3RhdHVzJ1xuICAgICAgICB9LFxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XG4gICAgICAgICAgJzpzdGF0dXMnOiAncmVwcm9jZXNzaW5nJyxcbiAgICAgICAgICAnOnJlcHJvY2Vzc2VkQXQnOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgfVxuICAgICAgfSkpXG4gICAgICBcbiAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgIG1lc3NhZ2VJZDogaXRlbS5tZXNzYWdlSWQsXG4gICAgICAgIGFjdGlvbjogJ3JlcHJvY2Vzc2VkJ1xuICAgICAgfSlcbiAgICB9XG4gICAgXG4gICAgcmV0dXJuIHJlc3VsdHNcbiAgfVxufVxuXG4vLyBFeHBvcnQgc2luZ2xldG9uIGluc3RhbmNlXG5leHBvcnQgY29uc3QgZGxxUHJvY2Vzc29yID0gRExRUHJvY2Vzc29yLmdldEluc3RhbmNlKCkiXX0=