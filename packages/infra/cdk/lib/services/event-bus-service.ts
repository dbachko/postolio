/**
 * Event Bus Service
 * Stub implementation for build compatibility
 */

import { EventBridge } from "@aws-sdk/client-eventbridge";

export class EventBusService {
  private static instance: EventBusService;
  private eventBridge: EventBridge;

  private constructor() {
    this.eventBridge = new EventBridge({});
  }

  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService();
    }
    return EventBusService.instance;
  }

  async putEvent(params: {
    source: string;
    detailType: string;
    detail: any;
    eventBusName?: string;
  }): Promise<void> {
    // Stub implementation
    console.log(`Putting event: ${params.detailType} from ${params.source}`);
  }

  async putEvents(
    events: Array<{
      source: string;
      detailType: string;
      detail: any;
    }>,
  ): Promise<void> {
    // Stub implementation
    console.log(`Putting ${events.length} events`);
  }

  async publish(eventType: string, detail: any, metadata?: any): Promise<void> {
    // Stub implementation
    console.log(`Publishing event: ${eventType}`);
    await this.putEvent({
      source: "postolio",
      detailType: eventType,
      detail: detail,
      eventBusName: "default",
    });
  }
}

export default EventBusService;
