"use strict";
/**
 * DLQ Processor Lambda Handler
 * Automatically processes messages from Dead Letter Queues
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reprocessHandler = exports.handler = void 0;
const dlq_processor_1 = require("../../services/dlq-processor");
const dlqProcessor = dlq_processor_1.DLQProcessor.getInstance();
// DLQ to Original Queue mapping
const DLQ_MAPPINGS = {
    'postolio-content-publisher-dlq': {
        originalQueue: process.env.PUBLISHER_QUEUE_URL,
        processor: 'contentPublisher'
    },
    'postolio-scheduler-dlq': {
        originalQueue: process.env.SCHEDULER_QUEUE_URL,
        processor: 'scheduler'
    },
    'postolio-token-refresh-dlq': {
        originalQueue: process.env.TOKEN_REFRESH_QUEUE_URL,
        processor: 'tokenRefresh'
    },
    'postolio-analytics-dlq': {
        originalQueue: process.env.ANALYTICS_QUEUE_URL,
        processor: 'analytics'
    }
};
// Custom processors for specific DLQs
const PROCESSORS = {
    contentPublisher: async (message) => {
        try {
            console.log('Reprocessing content publisher message:', message);
            // Validate message structure
            if (!message.contentId || !message.platform) {
                console.error('Invalid message structure for content publisher');
                return false;
            }
            // Check if content still exists and is valid
            // This would normally call the content service
            // For now, return true if message is valid
            return true;
        }
        catch (error) {
            console.error('Content publisher processor error:', error);
            return false;
        }
    },
    scheduler: async (message) => {
        try {
            console.log('Reprocessing scheduler message:', message);
            // Validate schedule is still relevant
            if (message.scheduledTime) {
                const scheduledTime = new Date(message.scheduledTime);
                if (scheduledTime < new Date()) {
                    console.log('Schedule is in the past, marking as processed');
                    return true; // Don't retry past schedules
                }
            }
            return true;
        }
        catch (error) {
            console.error('Scheduler processor error:', error);
            return false;
        }
    },
    tokenRefresh: async (message) => {
        try {
            console.log('Reprocessing token refresh message:', message);
            // Token refresh messages are time-sensitive
            // If too old, skip
            const messageTime = new Date(message.timestamp || 0);
            const ageInHours = (Date.now() - messageTime.getTime()) / (1000 * 60 * 60);
            if (ageInHours > 24) {
                console.log('Token refresh message too old, skipping');
                return true; // Mark as processed to remove from DLQ
            }
            return true;
        }
        catch (error) {
            console.error('Token refresh processor error:', error);
            return false;
        }
    },
    analytics: async (message) => {
        try {
            console.log('Reprocessing analytics message:', message);
            // Analytics messages can be batched if old
            // For now, always attempt reprocessing
            return true;
        }
        catch (error) {
            console.error('Analytics processor error:', error);
            return false;
        }
    }
};
/**
 * Lambda handler for scheduled DLQ processing
 */
const handler = async (event, context) => {
    console.log('DLQ Processor triggered:', JSON.stringify(event));
    const results = {
        processed: 0,
        failed: 0,
        parked: 0,
        errors: []
    };
    try {
        // Process each configured DLQ
        for (const [dlqName, config] of Object.entries(DLQ_MAPPINGS)) {
            if (!config.originalQueue) {
                console.warn(`Skipping ${dlqName}: No original queue configured`);
                continue;
            }
            const dlqUrl = `${process.env.SQS_BASE_URL}/${dlqName}`;
            const processorFn = config.processor ? PROCESSORS[config.processor] : undefined;
            try {
                console.log(`Processing DLQ: ${dlqName}`);
                const processingResults = await dlqProcessor.processDLQ(dlqUrl, config.originalQueue, processorFn);
                // Aggregate results
                for (const result of processingResults) {
                    if (result.success) {
                        results.processed++;
                    }
                    else if (result.action === 'parked') {
                        results.parked++;
                    }
                    else {
                        results.failed++;
                    }
                }
                console.log(`DLQ ${dlqName} processing complete:`, {
                    total: processingResults.length,
                    successful: processingResults.filter(r => r.success).length,
                    failed: processingResults.filter(r => !r.success).length
                });
            }
            catch (error) {
                const errorMessage = `Failed to process DLQ ${dlqName}: ${error}`;
                console.error(errorMessage);
                results.errors.push(errorMessage);
            }
        }
        // Get overall stats for monitoring
        const stats = await Promise.all(Object.keys(DLQ_MAPPINGS).map(dlqName => dlqProcessor.getDLQStats(dlqName)));
        console.log('DLQ Processing Complete:', {
            results,
            stats
        });
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'DLQ processing completed',
                results,
                stats,
                timestamp: new Date().toISOString()
            })
        };
    }
    catch (error) {
        console.error('DLQ Processor error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'DLQ processing failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                results,
                timestamp: new Date().toISOString()
            })
        };
    }
};
exports.handler = handler;
/**
 * Lambda handler for manual reprocessing
 */
const reprocessHandler = async (event, context) => {
    console.log('Manual DLQ reprocess triggered:', JSON.stringify(event));
    const { dlqName, messageIds } = event;
    if (!dlqName) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'dlqName is required'
            })
        };
    }
    try {
        const results = await dlqProcessor.reprocessParkedMessages(dlqName, messageIds);
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Reprocessing initiated',
                results,
                count: results.length,
                timestamp: new Date().toISOString()
            })
        };
    }
    catch (error) {
        console.error('Reprocess error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error instanceof Error ? error.message : 'Reprocess failed',
                timestamp: new Date().toISOString()
            })
        };
    }
};
exports.reprocessHandler = reprocessHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7QUFHSCxnRUFBMkQ7QUFFM0QsTUFBTSxZQUFZLEdBQUcsNEJBQVksQ0FBQyxXQUFXLEVBQUUsQ0FBQTtBQUUvQyxnQ0FBZ0M7QUFDaEMsTUFBTSxZQUFZLEdBQUc7SUFDbkIsZ0NBQWdDLEVBQUU7UUFDaEMsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CO1FBQzlDLFNBQVMsRUFBRSxrQkFBa0I7S0FDOUI7SUFDRCx3QkFBd0IsRUFBRTtRQUN4QixhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDOUMsU0FBUyxFQUFFLFdBQVc7S0FDdkI7SUFDRCw0QkFBNEIsRUFBRTtRQUM1QixhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUI7UUFDbEQsU0FBUyxFQUFFLGNBQWM7S0FDMUI7SUFDRCx3QkFBd0IsRUFBRTtRQUN4QixhQUFhLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7UUFDOUMsU0FBUyxFQUFFLFdBQVc7S0FDdkI7Q0FDRixDQUFBO0FBRUQsc0NBQXNDO0FBQ3RDLE1BQU0sVUFBVSxHQUFHO0lBQ2pCLGdCQUFnQixFQUFFLEtBQUssRUFBRSxPQUFZLEVBQW9CLEVBQUU7UUFDekQsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsRUFBRSxPQUFPLENBQUMsQ0FBQTtZQUUvRCw2QkFBNkI7WUFDN0IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7Z0JBQzVDLE9BQU8sQ0FBQyxLQUFLLENBQUMsaURBQWlELENBQUMsQ0FBQTtnQkFDaEUsT0FBTyxLQUFLLENBQUE7WUFDZCxDQUFDO1lBRUQsNkNBQTZDO1lBQzdDLCtDQUErQztZQUMvQywyQ0FBMkM7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d0I7Z0JBQ2pDLE9BQU87Z0JBQ1AsS0FBSyxFQUFFLE9BQU8sQ0FBQyxNQUFNO2dCQUNyQixTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7YUFDcEMsQ0FBQztTQUNILENBQUE7SUFDSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsa0JBQWtCLEVBQUUsS0FBSyxDQUFDLENBQUE7UUFFeEMsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7Z0JBQ25CLEtBQUssRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxrQkFBa0I7Z0JBQ2xFLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTthQUNwQyxDQUFDO1NBQ0gsQ0FBQTtJQUNILENBQUM7QUFDSCxDQUFDLENBQUE7QUFyQ1ksUUFBQSxnQkFBZ0Isb0JBcUM1QiIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogRExRIFByb2Nlc3NvciBMYW1iZGEgSGFuZGxlclxuICogQXV0b21hdGljYWxseSBwcm9jZXNzZXMgbWVzc2FnZXMgZnJvbSBEZWFkIExldHRlciBRdWV1ZXNcbiAqL1xuXG5pbXBvcnQgeyBTY2hlZHVsZWRFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnXG5pbXBvcnQgeyBETFFQcm9jZXNzb3IgfSBmcm9tICcuLi8uLi9zZXJ2aWNlcy9kbHEtcHJvY2Vzc29yJ1xuXG5jb25zdCBkbHFQcm9jZXNzb3IgPSBETFFQcm9jZXNzb3IuZ2V0SW5zdGFuY2UoKVxuXG4vLyBETFEgdG8gT3JpZ2luYWwgUXVldWUgbWFwcGluZ1xuY29uc3QgRExRX01BUFBJTkdTID0ge1xuICAncG9zdG9saW8tY29udGVudC1wdWJsaXNoZXItZGxxJzoge1xuICAgIG9yaWdpbmFsUXVldWU6IHByb2Nlc3MuZW52LlBVQkxJU0hFUl9RVUVVRV9VUkwsXG4gICAgcHJvY2Vzc29yOiAnY29udGVudFB1Ymxpc2hlcidcbiAgfSxcbiAgJ3Bvc3RvbGlvLXNjaGVkdWxlci1kbHEnOiB7XG4gICAgb3JpZ2luYWxRdWV1ZTogcHJvY2Vzcy5lbnYuU0NIRURVTEVSX1FVRVVFX1VSTCxcbiAgICBwcm9jZXNzb3I6ICdzY2hlZHVsZXInXG4gIH0sXG4gICdwb3N0b2xpby10b2tlbi1yZWZyZXNoLWRscSc6IHtcbiAgICBvcmlnaW5hbFF1ZXVlOiBwcm9jZXNzLmVudi5UT0tFTl9SRUZSRVNIX1FVRVVFX1VSTCxcbiAgICBwcm9jZXNzb3I6ICd0b2tlblJlZnJlc2gnXG4gIH0sXG4gICdwb3N0b2xpby1hbmFseXRpY3MtZGxxJzoge1xuICAgIG9yaWdpbmFsUXVldWU6IHByb2Nlc3MuZW52LkFOQUxZVElDU19RVUVVRV9VUkwsXG4gICAgcHJvY2Vzc29yOiAnYW5hbHl0aWNzJ1xuICB9XG59XG5cbi8vIEN1c3RvbSBwcm9jZXNzb3JzIGZvciBzcGVjaWZpYyBETFFzXG5jb25zdCBQUk9DRVNTT1JTID0ge1xuICBjb250ZW50UHVibGlzaGVyOiBhc3luYyAobWVzc2FnZTogYW55KTogUHJvbWlzZTxib29sZWFuPiA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKCdSZXByb2Nlc3NpbmcgY29udGVudCBwdWJsaXNoZXIgbWVzc2FnZTonLCBtZXNzYWdlKVxuICAgICAgXG4gICAgICAvLyBWYWxpZGF0ZSBtZXNzYWdlIHN0cnVjdHVyZVxuICAgICAgaWYgKCFtZXNzYWdlLmNvbnRlbnRJZCB8fCAhbWVzc2FnZS5wbGF0Zm9ybSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1lc3NhZ2Ugc3RydWN0dXJlIGZvciBjb250ZW50IHB1Ymxpc2hlcicpXG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgICAgXG4gICAgICAvLyBDaGVjayBpZiBjb250ZW50IHN0aWxsIGV4aXN0cyBhbmQgaXMgdmFsaWRcbiAgICAgIC8vIFRoaXMgd291bGQgbm9ybWFsbHkgY2FsbCB0aGUgY29udGVudCBzZXJ2aWNlXG4gICAgICAvLyBGb3Igbm93LCByZXR1cm4gdHJ1ZSBpZiBtZXNzYWdlIGlzIHZhbGlkXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdDb250ZW50IHB1Ymxpc2hlciBwcm9jZXNzb3IgZXJyb3I6JywgZXJyb3IpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH0sXG4gIFxuICBzY2hlZHVsZXI6IGFzeW5jIChtZXNzYWdlOiBhbnkpOiBQcm9taXNlPGJvb2xlYW4+ID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coJ1JlcHJvY2Vzc2luZyBzY2hlZHVsZXIgbWVzc2FnZTonLCBtZXNzYWdlKVxuICAgICAgXG4gICAgICAvLyBWYWxpZGF0ZSBzY2hlZHVsZSBpcyBzdGlsbCByZWxldmFudFxuICAgICAgaWYgKG1lc3NhZ2Uuc2NoZWR1bGVkVGltZSkge1xuICAgICAgICBjb25zdCBzY2hlZHVsZWRUaW1lID0gbmV3IERhdGUobWVzc2FnZS5zY2hlZHVsZWRUaW1lKVxuICAgICAgICBpZiAoc2NoZWR1bGVkVGltZSA8IG5ldyBEYXRlKCkpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZygnU2NoZWR1bGUgaXMgaW4gdGhlIHBhc3QsIG1hcmtpbmcgYXMgcHJvY2Vzc2VkJylcbiAgICAgICAgICByZXR1cm4gdHJ1ZSAvLyBEb24ndCByZXRyeSBwYXN0IHNjaGVkdWxlc1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBcbiAgICAgIHJldHVybiB0cnVlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1NjaGVkdWxlciBwcm9jZXNzb3IgZXJyb3I6JywgZXJyb3IpXG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH0sXG4gIFxuICB0b2tlblJlZnJlc2g6IGFzeW5jIChtZXNzYWdlOiBhbnkpOiBQcm9taXNlPGJvb2xlYW4+ID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coJ1JlcHJvY2Vzc2luZyB0b2tlbiByZWZyZXNoIG1lc3NhZ2U6JywgbWVzc2FnZSlcbiAgICAgIFxuICAgICAgLy8gVG9rZW4gcmVmcmVzaCBtZXNzYWdlcyBhcmUgdGltZS1zZW5zaXRpdmVcbiAgICAgIC8vIElmIHRvbyBvbGQsIHNraXBcbiAgICAgIGNvbnN0IG1lc3NhZ2VUaW1lID0gbmV3IERhdGUobWVzc2FnZS50aW1lc3RhbXAgfHwgMClcbiAgICAgIGNvbnN0IGFnZUluSG91cnMgPSAoRGF0ZS5ub3coKSAtIG1lc3NhZ2VUaW1lLmdldFRpbWUoKSkgLyAoMTAwMCAqIDYwICogNjApXG4gICAgICBcbiAgICAgIGlmIChhZ2VJbkhvdXJzID4gMjQpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ1Rva2VuIHJlZnJlc2ggbWVzc2FnZSB0b28gb2xkLCBza2lwcGluZycpXG4gICAgICAgIHJldHVybiB0cnVlIC8vIE1hcmsgYXMgcHJvY2Vzc2VkIHRvIHJlbW92ZSBmcm9tIERMUVxuICAgICAgfVxuICAgICAgXG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zb2xlLmVycm9yKCdUb2tlbiByZWZyZXNoIHByb2Nlc3NvciBlcnJvcjonLCBlcnJvcilcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfSxcbiAgXG4gIGFuYWx5dGljczogYXN5bmMgKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8Ym9vbGVhbj4gPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZygnUmVwcm9jZXNzaW5nIGFuYWx5dGljcyBtZXNzYWdlOicsIG1lc3NhZ2UpXG4gICAgICBcbiAgICAgIC8vIEFuYWx5dGljcyBtZXNzYWdlcyBjYW4gYmUgYmF0Y2hlZCBpZiBvbGRcbiAgICAgIC8vIEZvciBub3csIGFsd2F5cyBhdHRlbXB0IHJlcHJvY2Vzc2luZ1xuICAgICAgcmV0dXJuIHRydWVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignQW5hbHl0aWNzIHByb2Nlc3NvciBlcnJvcjonLCBlcnJvcilcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIExhbWJkYSBoYW5kbGVyIGZvciBzY2hlZHVsZWQgRExRIHByb2Nlc3NpbmdcbiAqL1xuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IFNjaGVkdWxlZEV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxhbnk+ID0+IHtcbiAgY29uc29sZS5sb2coJ0RMUSBQcm9jZXNzb3IgdHJpZ2dlcmVkOicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSlcbiAgXG4gIGNvbnN0IHJlc3VsdHMgPSB7XG4gICAgcHJvY2Vzc2VkOiAwLFxuICAgIGZhaWxlZDogMCxcbiAgICBwYXJrZWQ6IDAsXG4gICAgZXJyb3JzOiBbXSBhcyBzdHJpbmdbXVxuICB9XG4gIFxuICB0cnkge1xuICAgIC8vIFByb2Nlc3MgZWFjaCBjb25maWd1cmVkIERMUVxuICAgIGZvciAoY29uc3QgW2RscU5hbWUsIGNvbmZpZ10gb2YgT2JqZWN0LmVudHJpZXMoRExRX01BUFBJTkdTKSkge1xuICAgICAgaWYgKCFjb25maWcub3JpZ2luYWxRdWV1ZSkge1xuICAgICAgICBjb25zb2xlLndhcm4oYFNraXBwaW5nICR7ZGxxTmFtZX06IE5vIG9yaWdpbmFsIHF1ZXVlIGNvbmZpZ3VyZWRgKVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuICAgICAgXG4gICAgICBjb25zdCBkbHFVcmwgPSBgJHtwcm9jZXNzLmVudi5TUVNfQkFTRV9VUkx9LyR7ZGxxTmFtZX1gXG4gICAgICBjb25zdCBwcm9jZXNzb3JGbiA9IGNvbmZpZy5wcm9jZXNzb3IgPyBQUk9DRVNTT1JTW2NvbmZpZy5wcm9jZXNzb3IgYXMga2V5b2YgdHlwZW9mIFBST0NFU1NPUlNdIDogdW5kZWZpbmVkXG4gICAgICBcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIERMUTogJHtkbHFOYW1lfWApXG4gICAgICAgIGNvbnN0IHByb2Nlc3NpbmdSZXN1bHRzID0gYXdhaXQgZGxxUHJvY2Vzc29yLnByb2Nlc3NETFEoXG4gICAgICAgICAgZGxxVXJsLFxuICAgICAgICAgIGNvbmZpZy5vcmlnaW5hbFF1ZXVlLFxuICAgICAgICAgIHByb2Nlc3NvckZuXG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIC8vIEFnZ3JlZ2F0ZSByZXN1bHRzXG4gICAgICAgIGZvciAoY29uc3QgcmVzdWx0IG9mIHByb2Nlc3NpbmdSZXN1bHRzKSB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXN1bHRzLnByb2Nlc3NlZCsrXG4gICAgICAgICAgfSBlbHNlIGlmIChyZXN1bHQuYWN0aW9uID09PSAncGFya2VkJykge1xuICAgICAgICAgICAgcmVzdWx0cy5wYXJrZWQrK1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHRzLmZhaWxlZCsrXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zb2xlLmxvZyhgRExRICR7ZGxxTmFtZX0gcHJvY2Vzc2luZyBjb21wbGV0ZTpgLCB7XG4gICAgICAgICAgdG90YWw6IHByb2Nlc3NpbmdSZXN1bHRzLmxlbmd0aCxcbiAgICAgICAgICBzdWNjZXNzZnVsOiBwcm9jZXNzaW5nUmVzdWx0cy5maWx0ZXIociA9PiByLnN1Y2Nlc3MpLmxlbmd0aCxcbiAgICAgICAgICBmYWlsZWQ6IHByb2Nlc3NpbmdSZXN1bHRzLmZpbHRlcihyID0+ICFyLnN1Y2Nlc3MpLmxlbmd0aFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYEZhaWxlZCB0byBwcm9jZXNzIERMUSAke2RscU5hbWV9OiAke2Vycm9yfWBcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvck1lc3NhZ2UpXG4gICAgICAgIHJlc3VsdHMuZXJyb3JzLnB1c2goZXJyb3JNZXNzYWdlKVxuICAgICAgfVxuICAgIH1cbiAgICBcbiAgICAvLyBHZXQgb3ZlcmFsbCBzdGF0cyBmb3IgbW9uaXRvcmluZ1xuICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICBPYmplY3Qua2V5cyhETFFfTUFQUElOR1MpLm1hcChkbHFOYW1lID0+IFxuICAgICAgICBkbHFQcm9jZXNzb3IuZ2V0RExRU3RhdHMoZGxxTmFtZSlcbiAgICAgIClcbiAgICApXG4gICAgXG4gICAgY29uc29sZS5sb2coJ0RMUSBQcm9jZXNzaW5nIENvbXBsZXRlOicsIHtcbiAgICAgIHJlc3VsdHMsXG4gICAgICBzdGF0c1xuICAgIH0pXG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgbWVzc2FnZTogJ0RMUSBwcm9jZXNzaW5nIGNvbXBsZXRlZCcsXG4gICAgICAgIHJlc3VsdHMsXG4gICAgICAgIHN0YXRzLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSlcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRExRIFByb2Nlc3NvciBlcnJvcjonLCBlcnJvcilcbiAgICBcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtZXNzYWdlOiAnRExRIHByb2Nlc3NpbmcgZmFpbGVkJyxcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InLFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciBmb3IgbWFudWFsIHJlcHJvY2Vzc2luZ1xuICovXG5leHBvcnQgY29uc3QgcmVwcm9jZXNzSGFuZGxlciA9IGFzeW5jIChldmVudDogYW55LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTxhbnk+ID0+IHtcbiAgY29uc29sZS5sb2coJ01hbnVhbCBETFEgcmVwcm9jZXNzIHRyaWdnZXJlZDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpXG4gIFxuICBjb25zdCB7IGRscU5hbWUsIG1lc3NhZ2VJZHMgfSA9IGV2ZW50XG4gIFxuICBpZiAoIWRscU5hbWUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBlcnJvcjogJ2RscU5hbWUgaXMgcmVxdWlyZWQnXG4gICAgICB9KVxuICAgIH1cbiAgfVxuICBcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZGxxUHJvY2Vzc29yLnJlcHJvY2Vzc1BhcmtlZE1lc3NhZ2VzKGRscU5hbWUsIG1lc3NhZ2VJZHMpXG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgbWVzc2FnZTogJ1JlcHJvY2Vzc2luZyBpbml0aWF0ZWQnLFxuICAgICAgICByZXN1bHRzLFxuICAgICAgICBjb3VudDogcmVzdWx0cy5sZW5ndGgsXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICB9KVxuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdSZXByb2Nlc3MgZXJyb3I6JywgZXJyb3IpXG4gICAgXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1JlcHJvY2VzcyBmYWlsZWQnLFxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgICAgfSlcbiAgICB9XG4gIH1cbn0iXX0=