"use strict";
/**
 * Event Bus Service
 * Centralized event publishing and subscription management
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventBusService = exports.EventBusService = void 0;
const client_eventbridge_1 = require("@aws-sdk/client-eventbridge");
const event_schemas_1 = require("../schemas/event-schemas");
const tracing_service_1 = require("./tracing-service");
const crypto = __importStar(require("crypto"));
const eventBridgeClient = new client_eventbridge_1.EventBridgeClient({});
const tracingService = new tracing_service_1.TracingService();
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'postolio-events';
class EventBusService {
    static instance;
    static getInstance() {
        if (!EventBusService.instance) {
            EventBusService.instance = new EventBusService();
        }
        return EventBusService.instance;
    }
    /**
     * Publish a validated event to EventBridge
     */
    async publish(eventType, data, options) {
        const correlationId = options.correlationId || crypto.randomUUID();
        // Trace the event publishing
        await tracingService.traceOperation('EventBus.publish', async () => {
            try {
                // Build and validate event
                const event = event_schemas_1.EventBuilder.createEvent(eventType, data, {
                    userId: options.userId,
                    brandId: options.brandId,
                    correlationId,
                    causationId: options.causationId,
                    timestamp: new Date().toISOString(),
                    version: '1.0',
                });
                // Publish to EventBridge
                await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
                    Entries: [{
                            Source: event.source,
                            DetailType: event.type,
                            Detail: JSON.stringify(event),
                            EventBusName: EVENT_BUS_NAME,
                            Time: new Date(),
                        }],
                }));
                console.log(`Event published: ${event.type}`, {
                    correlationId,
                    eventId: event.id,
                    source: event.source,
                });
            }
            catch (error) {
                console.error(`Failed to publish event: ${eventType}`, error);
                throw error;
            }
        }, { correlationId, eventType });
    }
    /**
     * Batch publish multiple events
     */
    async publishBatch(events) {
        if (events.length === 0)
            return;
        const correlationId = events[0].options.correlationId || crypto.randomUUID();
        await tracingService.traceOperation('EventBus.publishBatch', async () => {
            try {
                // Build and validate all events
                const validatedEvents = events.map(({ type, data, options }) => {
                    return event_schemas_1.EventBuilder.createEvent(type, data, {
                        userId: options.userId,
                        brandId: options.brandId,
                        correlationId: options.correlationId || correlationId,
                        causationId: options.causationId,
                        timestamp: new Date().toISOString(),
                        version: '1.0',
                    });
                });
                // EventBridge has a limit of 10 events per PutEvents call
                const chunks = this.chunkArray(validatedEvents, 10);
                for (const chunk of chunks) {
                    await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
                        Entries: chunk.map(event => ({
                            Source: event.source,
                            DetailType: event.type,
                            Detail: JSON.stringify(event),
                            EventBusName: EVENT_BUS_NAME,
                            Time: new Date(),
                        })),
                    }));
                }
                console.log(`Batch published ${events.length} events`, {
                    correlationId,
                    eventTypes: events.map(e => e.type),
                });
            }
            catch (error) {
                console.error('Failed to publish batch events', error);
                throw error;
            }
        }, { correlationId, eventCount: events.length });
    }
    /**
     * Handle incoming event from EventBridge
     */
    async handleEvent(eventData, handler) {
        const correlationId = eventData.metadata?.correlationId || crypto.randomUUID();
        await tracingService.traceOperation('EventBus.handleEvent', async () => {
            try {
                // Validate incoming event
                const validEvent = (0, event_schemas_1.validateEvent)(eventData.type, eventData);
                console.log(`Handling event: ${validEvent.type}`, {
                    correlationId,
                    eventId: validEvent.id,
                    source: validEvent.source,
                });
                // Process event with handler
                await handler(validEvent);
                console.log(`Event handled successfully: ${validEvent.type}`, {
                    correlationId,
                    eventId: validEvent.id,
                });
            }
            catch (error) {
                console.error(`Failed to handle event: ${eventData.type}`, error);
                // Publish error event for monitoring
                await this.publishError(eventData, error, correlationId);
                throw error;
            }
        }, { correlationId, eventType: eventData.type });
    }
    /**
     * Publish error event for failed event processing
     */
    async publishError(originalEvent, error, correlationId) {
        try {
            await eventBridgeClient.send(new client_eventbridge_1.PutEventsCommand({
                Entries: [{
                        Source: 'postolio.platform',
                        DetailType: 'event.error',
                        Detail: JSON.stringify({
                            originalEvent,
                            error: {
                                name: error.name,
                                message: error.message,
                                stack: error.stack,
                            },
                            timestamp: new Date().toISOString(),
                            correlationId,
                        }),
                        EventBusName: EVENT_BUS_NAME,
                        Time: new Date(),
                    }],
            }));
        }
        catch (publishError) {
            console.error('Failed to publish error event', publishError);
        }
    }
    /**
     * Helper to chunk array into smaller arrays
     */
    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }
}
exports.EventBusService = EventBusService;
// Export singleton instance
exports.eventBusService = EventBusService.getInstance();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXZlbnQtYnVzLXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJldmVudC1idXMtc2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUE7OztHQUdHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFFSCxvRUFBaUY7QUFDakYsNERBQTBHO0FBRTFHLHVEQUFrRDtBQUNsRCwrQ0FBZ0M7QUFFaEMsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLHNDQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFBO0FBQ25ELE1BQU0sY0FBYyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFBO0FBRTNDLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxJQUFJLGlCQUFpQixDQUFBO0FBU3RFLE1BQWEsZUFBZTtJQUNsQixNQUFNLENBQUMsUUFBUSxDQUFpQjtJQUV4QyxNQUFNLENBQUMsV0FBVztRQUNoQixJQUFJLENBQUMsZUFBZSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQzlCLGVBQWUsQ0FBQyxRQUFRLEdBQUcsSUFBSSxlQUFlLEVBQUUsQ0FBQTtRQUNsRCxDQUFDO1FBQ0QsT0FBTyxlQUFlLENBQUMsUUFBUSxDQUFBO0lBQ2pDLENBQUM7SUFFRDs7T0FFRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQ1gsU0FBaUIsRUFDakIsSUFBeUIsRUFDekIsT0FBNEI7UUFFNUIsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLGFBQWEsSUFBSSxNQUFNLENBQUMsVUFBVSxFQUFFLENBQUE7UUFFbEUsNkJBQTZCO1FBQzdCLE1BQU0sY0FBYyxDQUFDLGNBQWMsQ0FBQyxrQkFBa0IsRUFBRSxLQUFLLElBQUksRUFBRTtZQUNqRSxJQUFJLENBQUM7Z0JBQ0gsMkJBQTJCO2dCQUMzQixNQUFNLEtBQUssR0FBRyw0QkFBWSxDQUFDLFdBQVcsQ0FDcEMsU0FBZ0IsRUFDaEIsSUFBSSxFQUNKO29CQUNFLE1BQU0sRUFBRSxPQUFPLENB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Qzt3QkFDRixZQUFZLEVBQUUsY0FBYzt3QkFDNUIsSUFBSSxFQUFFLElBQUksSUFBSSxFQUFFO3FCQUNqQixDQUFDO2FBQ0gsQ0FBQyxDQUFDLENBQUE7UUFDTCxDQUFDO1FBQUMsT0FBTyxZQUFZLEVBQUUsQ0FBQztZQUN0QixPQUFPLENBQUMsS0FBSyxDQUFDLCtCQUErQixFQUFFLFlBQVksQ0FBQyxDQUFBO1FBQzlELENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxVQUFVLENBQUksS0FBVSxFQUFFLElBQVk7UUFDNUMsTUFBTSxNQUFNLEdBQVUsRUFBRSxDQUFBO1FBQ3hCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUM1QyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFBO1FBQ3ZDLENBQUM7UUFDRCxPQUFPLE1BQU0sQ0FBQTtJQUNmLENBQUM7Q0FDRjtBQXRNRCwwQ0FzTUM7QUFFRCw0QkFBNEI7QUFDZixRQUFBLGVBQWUsR0FBRyxlQUFlLENBQUMsV0FBVyxFQUFFLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEV2ZW50IEJ1cyBTZXJ2aWNlXG4gKiBDZW50cmFsaXplZCBldmVudCBwdWJsaXNoaW5nIGFuZCBzdWJzY3JpcHRpb24gbWFuYWdlbWVudFxuICovXG5cbmltcG9ydCB7IEV2ZW50QnJpZGdlQ2xpZW50LCBQdXRFdmVudHNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWV2ZW50YnJpZGdlJ1xuaW1wb3J0IHsgdmFsaWRhdGVFdmVudCwgRXZlbnRCdWlsZGVyLCBFdmVudE1ldGFkYXRhU2NoZW1hLCBQbGF0Zm9ybUV2ZW50IH0gZnJvbSAnLi4vc2NoZW1hcy9ldmVudC1zY2hlbWFzJ1xuaW1wb3J0IHsgeiB9IGZyb20gJ3pvZCdcbmltcG9ydCB7IFRyYWNpbmdTZXJ2aWNlIH0gZnJvbSAnLi90cmFjaW5nLXNlcnZpY2UnXG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJ1xuXG5jb25zdCBldmVudEJyaWRnZUNsaWVudCA9IG5ldyBFdmVudEJyaWRnZUNsaWVudCh7fSlcbmNvbnN0IHRyYWNpbmdTZXJ2aWNlID0gbmV3IFRyYWNpbmdTZXJ2aWNlKClcblxuY29uc3QgRVZFTlRfQlVTX05BTUUgPSBwcm9jZXNzLmVudi5FVkVOVF9CVVNfTkFNRSB8fCAncG9zdG9saW8tZXZlbnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEV2ZW50UHVibGlzaE9wdGlvbnMge1xuICBjb3JyZWxhdGlvbklkPzogc3RyaW5nXG4gIGNhdXNhdGlvbklkPzogc3RyaW5nXG4gIHVzZXJJZDogc3RyaW5nXG4gIGJyYW5kSWQ6IHN0cmluZ1xufVxuXG5leHBvcnQgY2xhc3MgRXZlbnRCdXNTZXJ2aWNlIHtcbiAgcHJpdmF0ZSBzdGF0aWMgaW5zdGFuY2U6IEV2ZW50QnVzU2VydmljZVxuICBcbiAgc3RhdGljIGdldEluc3RhbmNlKCk6IEV2ZW50QnVzU2VydmljZSB7XG4gICAgaWYgKCFFdmVudEJ1c1NlcnZpY2UuaW5zdGFuY2UpIHtcbiAgICAgIEV2ZW50QnVzU2VydmljZS5pbnN0YW5jZSA9IG5ldyBFdmVudEJ1c1NlcnZpY2UoKVxuICAgIH1cbiAgICByZXR1cm4gRXZlbnRCdXNTZXJ2aWNlLmluc3RhbmNlXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBQdWJsaXNoIGEgdmFsaWRhdGVkIGV2ZW50IHRvIEV2ZW50QnJpZGdlXG4gICAqL1xuICBhc3luYyBwdWJsaXNoKFxuICAgIGV2ZW50VHlwZTogc3RyaW5nLFxuICAgIGRhdGE6IFJlY29yZDxzdHJpbmcsIGFueT4sXG4gICAgb3B0aW9uczogRXZlbnRQdWJsaXNoT3B0aW9uc1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb3JyZWxhdGlvbklkID0gb3B0aW9ucy5jb3JyZWxhdGlvbklkIHx8IGNyeXB0by5yYW5kb21VVUlEKClcbiAgICBcbiAgICAvLyBUcmFjZSB0aGUgZXZlbnQgcHVibGlzaGluZ1xuICAgIGF3YWl0IHRyYWNpbmdTZXJ2aWNlLnRyYWNlT3BlcmF0aW9uKCdFdmVudEJ1cy5wdWJsaXNoJywgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQnVpbGQgYW5kIHZhbGlkYXRlIGV2ZW50XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gRXZlbnRCdWlsZGVyLmNyZWF0ZUV2ZW50KFxuICAgICAgICAgIGV2ZW50VHlwZSBhcyBhbnksXG4gICAgICAgICAgZGF0YSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICB1c2VySWQ6IG9wdGlvbnMudXNlcklkLFxuICAgICAgICAgICAgYnJhbmRJZDogb3B0aW9ucy5icmFuZElkLFxuICAgICAgICAgICAgY29ycmVsYXRpb25JZCxcbiAgICAgICAgICAgIGNhdXNhdGlvbklkOiBvcHRpb25zLmNhdXNhdGlvbklkLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB2ZXJzaW9uOiAnMS4wJyxcbiAgICAgICAgICB9XG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIC8vIFB1Ymxpc2ggdG8gRXZlbnRCcmlkZ2VcbiAgICAgICAgYXdhaXQgZXZlbnRCcmlkZ2VDbGllbnQuc2VuZChuZXcgUHV0RXZlbnRzQ29tbWFuZCh7XG4gICAgICAgICAgRW50cmllczogW3tcbiAgICAgICAgICAgIFNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgICAgICAgRGV0YWlsVHlwZTogZXZlbnQudHlwZSxcbiAgICAgICAgICAgIERldGFpbDogSlNPTi5zdHJpbmdpZnkoZXZlbnQpLFxuICAgICAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVNfTkFNRSxcbiAgICAgICAgICAgIFRpbWU6IG5ldyBEYXRlKCksXG4gICAgICAgICAgfV0sXG4gICAgICAgIH0pKVxuICAgICAgICBcbiAgICAgICAgY29uc29sZS5sb2coYEV2ZW50IHB1Ymxpc2hlZDogJHtldmVudC50eXBlfWAsIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGV2ZW50SWQ6IGV2ZW50LmlkLFxuICAgICAgICAgIHNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIHB1Ymxpc2ggZXZlbnQ6ICR7ZXZlbnRUeXBlfWAsIGVycm9yKVxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0sIHsgY29ycmVsYXRpb25JZCwgZXZlbnRUeXBlIH0pXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBCYXRjaCBwdWJsaXNoIG11bHRpcGxlIGV2ZW50c1xuICAgKi9cbiAgYXN5bmMgcHVibGlzaEJhdGNoKFxuICAgIGV2ZW50czogQXJyYXk8e1xuICAgICAgdHlwZTogc3RyaW5nXG4gICAgICBkYXRhOiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gICAgICBvcHRpb25zOiBFdmVudFB1Ymxpc2hPcHRpb25zXG4gICAgfT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGV2ZW50cy5sZW5ndGggPT09IDApIHJldHVyblxuICAgIFxuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBldmVudHNbMF0ub3B0aW9ucy5jb3JyZWxhdGlvbklkIHx8IGNyeXB0by5yYW5kb21VVUlEKClcbiAgICBcbiAgICBhd2FpdCB0cmFjaW5nU2VydmljZS50cmFjZU9wZXJhdGlvbignRXZlbnRCdXMucHVibGlzaEJhdGNoJywgYXN5bmMgKCkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQnVpbGQgYW5kIHZhbGlkYXRlIGFsbCBldmVudHNcbiAgICAgICAgY29uc3QgdmFsaWRhdGVkRXZlbnRzID0gZXZlbnRzLm1hcCgoeyB0eXBlLCBkYXRhLCBvcHRpb25zIH0pID0+IHtcbiAgICAgICAgICByZXR1cm4gRXZlbnRCdWlsZGVyLmNyZWF0ZUV2ZW50KFxuICAgICAgICAgICAgdHlwZSBhcyBhbnksXG4gICAgICAgICAgICBkYXRhLFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICB1c2VySWQ6IG9wdGlvbnMudXNlcklkLFxuICAgICAgICAgICAgICBicmFuZElkOiBvcHRpb25zLmJyYW5kSWQsXG4gICAgICAgICAgICAgIGNvcnJlbGF0aW9uSWQ6IG9wdGlvbnMuY29ycmVsYXRpb25JZCB8fCBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgICAgICBjYXVzYXRpb25JZDogb3B0aW9ucy5jYXVzYXRpb25JZCxcbiAgICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICAgIHZlcnNpb246ICcxLjAnLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIC8vIEV2ZW50QnJpZGdlIGhhcyBhIGxpbWl0IG9mIDEwIGV2ZW50cyBwZXIgUHV0RXZlbnRzIGNhbGxcbiAgICAgICAgY29uc3QgY2h1bmtzID0gdGhpcy5jaHVua0FycmF5KHZhbGlkYXRlZEV2ZW50cywgMTApXG4gICAgICAgIFxuICAgICAgICBmb3IgKGNvbnN0IGNodW5rIG9mIGNodW5rcykge1xuICAgICAgICAgIGF3YWl0IGV2ZW50QnJpZGdlQ2xpZW50LnNlbmQobmV3IFB1dEV2ZW50c0NvbW1hbmQoe1xuICAgICAgICAgICAgRW50cmllczogY2h1bmsubWFwKGV2ZW50ID0+ICh7XG4gICAgICAgICAgICAgIFNvdXJjZTogZXZlbnQuc291cmNlLFxuICAgICAgICAgICAgICBEZXRhaWxUeXBlOiBldmVudC50eXBlLFxuICAgICAgICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KGV2ZW50KSxcbiAgICAgICAgICAgICAgRXZlbnRCdXNOYW1lOiBFVkVOVF9CVVNfTkFNRSxcbiAgICAgICAgICAgICAgVGltZTogbmV3IERhdGUoKSxcbiAgICAgICAgICAgIH0pKSxcbiAgICAgICAgICB9KSlcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc29sZS5sb2coYEJhdGNoIHB1Ymxpc2hlZCAke2V2ZW50cy5sZW5ndGh9IGV2ZW50c2AsIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGV2ZW50VHlwZXM6IGV2ZW50cy5tYXAoZSA9PiBlLnR5cGUpLFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIHB1Ymxpc2ggYmF0Y2ggZXZlbnRzJywgZXJyb3IpXG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfSwgeyBjb3JyZWxhdGlvbklkLCBldmVudENvdW50OiBldmVudHMubGVuZ3RoIH0pXG4gIH1cbiAgXG4gIC8qKlxuICAgKiBIYW5kbGUgaW5jb21pbmcgZXZlbnQgZnJvbSBFdmVudEJyaWRnZVxuICAgKi9cbiAgYXN5bmMgaGFuZGxlRXZlbnQoXG4gICAgZXZlbnREYXRhOiBhbnksXG4gICAgaGFuZGxlcjogKGV2ZW50OiBQbGF0Zm9ybUV2ZW50KSA9PiBQcm9taXNlPHZvaWQ+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvcnJlbGF0aW9uSWQgPSBldmVudERhdGEubWV0YWRhdGE/LmNvcnJlbGF0aW9uSWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKVxuICAgIFxuICAgIGF3YWl0IHRyYWNpbmdTZXJ2aWNlLnRyYWNlT3BlcmF0aW9uKCdFdmVudEJ1cy5oYW5kbGVFdmVudCcsIGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIFZhbGlkYXRlIGluY29taW5nIGV2ZW50XG4gICAgICAgIGNvbnN0IHZhbGlkRXZlbnQgPSB2YWxpZGF0ZUV2ZW50KGV2ZW50RGF0YS50eXBlLCBldmVudERhdGEpXG4gICAgICAgIFxuICAgICAgICBjb25zb2xlLmxvZyhgSGFuZGxpbmcgZXZlbnQ6ICR7dmFsaWRFdmVudC50eXBlfWAsIHtcbiAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIGV2ZW50SWQ6IHZhbGlkRXZlbnQuaWQsXG4gICAgICAgICAgc291cmNlOiB2YWxpZEV2ZW50LnNvdXJjZSxcbiAgICAgICAgfSlcbiAgICAgICAgXG4gICAgICAgIC8vIFByb2Nlc3MgZXZlbnQgd2l0aCBoYW5kbGVyXG4gICAgICAgIGF3YWl0IGhhbmRsZXIodmFsaWRFdmVudClcbiAgICAgICAgXG4gICAgICAgIGNvbnNvbGUubG9nKGBFdmVudCBoYW5kbGVkIHN1Y2Nlc3NmdWxseTogJHt2YWxpZEV2ZW50LnR5cGV9YCwge1xuICAgICAgICAgIGNvcnJlbGF0aW9uSWQsXG4gICAgICAgICAgZXZlbnRJZDogdmFsaWRFdmVudC5pZCxcbiAgICAgICAgfSlcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBoYW5kbGUgZXZlbnQ6ICR7ZXZlbnREYXRhLnR5cGV9YCwgZXJyb3IpXG4gICAgICAgIFxuICAgICAgICAvLyBQdWJsaXNoIGVycm9yIGV2ZW50IGZvciBtb25pdG9yaW5nXG4gICAgICAgIGF3YWl0IHRoaXMucHVibGlzaEVycm9yKGV2ZW50RGF0YSwgZXJyb3IgYXMgRXJyb3IsIGNvcnJlbGF0aW9uSWQpXG4gICAgICAgIFxuICAgICAgICB0aHJvdyBlcnJvclxuICAgICAgfVxuICAgIH0sIHsgY29ycmVsYXRpb25JZCwgZXZlbnRUeXBlOiBldmVudERhdGEudHlwZSB9KVxuICB9XG4gIFxuICAvKipcbiAgICogUHVibGlzaCBlcnJvciBldmVudCBmb3IgZmFpbGVkIGV2ZW50IHByb2Nlc3NpbmdcbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcHVibGlzaEVycm9yKFxuICAgIG9yaWdpbmFsRXZlbnQ6IGFueSxcbiAgICBlcnJvcjogRXJyb3IsXG4gICAgY29ycmVsYXRpb25JZDogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBldmVudEJyaWRnZUNsaWVudC5zZW5kKG5ldyBQdXRFdmVudHNDb21tYW5kKHtcbiAgICAgICAgRW50cmllczogW3tcbiAgICAgICAgICBTb3VyY2U6ICdwb3N0b2xpby5wbGF0Zm9ybScsXG4gICAgICAgICAgRGV0YWlsVHlwZTogJ2V2ZW50LmVycm9yJyxcbiAgICAgICAgICBEZXRhaWw6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICAgIG9yaWdpbmFsRXZlbnQsXG4gICAgICAgICAgICBlcnJvcjoge1xuICAgICAgICAgICAgICBuYW1lOiBlcnJvci5uYW1lLFxuICAgICAgICAgICAgICBtZXNzYWdlOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICBzdGFjazogZXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBjb3JyZWxhdGlvbklkLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIEV2ZW50QnVzTmFtZTogRVZFTlRfQlVTX05BTUUsXG4gICAgICAgICAgVGltZTogbmV3IERhdGUoKSxcbiAgICAgICAgfV0sXG4gICAgICB9KSlcbiAgICB9IGNhdGNoIChwdWJsaXNoRXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBwdWJsaXNoIGVycm9yIGV2ZW50JywgcHVibGlzaEVycm9yKVxuICAgIH1cbiAgfVxuICBcbiAgLyoqXG4gICAqIEhlbHBlciB0byBjaHVuayBhcnJheSBpbnRvIHNtYWxsZXIgYXJyYXlzXG4gICAqL1xuICBwcml2YXRlIGNodW5rQXJyYXk8VD4oYXJyYXk6IFRbXSwgc2l6ZTogbnVtYmVyKTogVFtdW10ge1xuICAgIGNvbnN0IGNodW5rczogVFtdW10gPSBbXVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgYXJyYXkubGVuZ3RoOyBpICs9IHNpemUpIHtcbiAgICAgIGNodW5rcy5wdXNoKGFycmF5LnNsaWNlKGksIGkgKyBzaXplKSlcbiAgICB9XG4gICAgcmV0dXJuIGNodW5rc1xuICB9XG59XG5cbi8vIEV4cG9ydCBzaW5nbGV0b24gaW5zdGFuY2VcbmV4cG9ydCBjb25zdCBldmVudEJ1c1NlcnZpY2UgPSBFdmVudEJ1c1NlcnZpY2UuZ2V0SW5zdGFuY2UoKSJdfQ==