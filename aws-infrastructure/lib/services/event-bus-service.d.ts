/**
 * Event Bus Service
 * Centralized event publishing and subscription management
 */
import { PlatformEvent } from '../schemas/event-schemas';
export interface EventPublishOptions {
    correlationId?: string;
    causationId?: string;
    userId: string;
    brandId: string;
}
export declare class EventBusService {
    private static instance;
    static getInstance(): EventBusService;
    /**
     * Publish a validated event to EventBridge
     */
    publish(eventType: string, data: Record<string, any>, options: EventPublishOptions): Promise<void>;
    /**
     * Batch publish multiple events
     */
    publishBatch(events: Array<{
        type: string;
        data: Record<string, any>;
        options: EventPublishOptions;
    }>): Promise<void>;
    /**
     * Handle incoming event from EventBridge
     */
    handleEvent(eventData: any, handler: (event: PlatformEvent) => Promise<void>): Promise<void>;
    /**
     * Publish error event for failed event processing
     */
    private publishError;
    /**
     * Helper to chunk array into smaller arrays
     */
    private chunkArray;
}
export declare const eventBusService: EventBusService;
