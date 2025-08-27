/**
 * Event Bus Service
 * Centralized event publishing and subscription management
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { validateEvent, EventBuilder, EventMetadataSchema, PlatformEvent } from '../schemas/event-schemas'
import { z } from 'zod'
import { TracingService } from './tracing-service'
import * as crypto from 'crypto'

const eventBridgeClient = new EventBridgeClient({})
const tracingService = new TracingService()

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME || 'postolio-events'

export interface EventPublishOptions {
  correlationId?: string
  causationId?: string
  userId: string
  brandId: string
}

export class EventBusService {
  private static instance: EventBusService
  
  static getInstance(): EventBusService {
    if (!EventBusService.instance) {
      EventBusService.instance = new EventBusService()
    }
    return EventBusService.instance
  }
  
  /**
   * Publish a validated event to EventBridge
   */
  async publish(
    eventType: string,
    data: Record<string, any>,
    options: EventPublishOptions
  ): Promise<void> {
    const correlationId = options.correlationId || crypto.randomUUID()
    
    // Trace the event publishing
    await tracingService.traceOperation('EventBus.publish', async () => {
      try {
        // Build and validate event
        const event = EventBuilder.createEvent(
          eventType as any,
          data,
          {
            userId: options.userId,
            brandId: options.brandId,
            correlationId,
            causationId: options.causationId,
            timestamp: new Date().toISOString(),
            version: '1.0',
          }
        )
        
        // Publish to EventBridge
        await eventBridgeClient.send(new PutEventsCommand({
          Entries: [{
            Source: event.source,
            DetailType: event.type,
            Detail: JSON.stringify(event),
            EventBusName: EVENT_BUS_NAME,
            Time: new Date(),
          }],
        }))
        
        console.log(`Event published: ${event.type}`, {
          correlationId,
          eventId: event.id,
          source: event.source,
        })
      } catch (error) {
        console.error(`Failed to publish event: ${eventType}`, error)
        throw error
      }
    }, { correlationId, eventType })
  }
  
  /**
   * Batch publish multiple events
   */
  async publishBatch(
    events: Array<{
      type: string
      data: Record<string, any>
      options: EventPublishOptions
    }>
  ): Promise<void> {
    if (events.length === 0) return
    
    const correlationId = events[0].options.correlationId || crypto.randomUUID()
    
    await tracingService.traceOperation('EventBus.publishBatch', async () => {
      try {
        // Build and validate all events
        const validatedEvents = events.map(({ type, data, options }) => {
          return EventBuilder.createEvent(
            type as any,
            data,
            {
              userId: options.userId,
              brandId: options.brandId,
              correlationId: options.correlationId || correlationId,
              causationId: options.causationId,
              timestamp: new Date().toISOString(),
              version: '1.0',
            }
          )
        })
        
        // EventBridge has a limit of 10 events per PutEvents call
        const chunks = this.chunkArray(validatedEvents, 10)
        
        for (const chunk of chunks) {
          await eventBridgeClient.send(new PutEventsCommand({
            Entries: chunk.map(event => ({
              Source: event.source,
              DetailType: event.type,
              Detail: JSON.stringify(event),
              EventBusName: EVENT_BUS_NAME,
              Time: new Date(),
            })),
          }))
        }
        
        console.log(`Batch published ${events.length} events`, {
          correlationId,
          eventTypes: events.map(e => e.type),
        })
      } catch (error) {
        console.error('Failed to publish batch events', error)
        throw error
      }
    }, { correlationId, eventCount: events.length })
  }
  
  /**
   * Handle incoming event from EventBridge
   */
  async handleEvent(
    eventData: any,
    handler: (event: PlatformEvent) => Promise<void>
  ): Promise<void> {
    const correlationId = eventData.metadata?.correlationId || crypto.randomUUID()
    
    await tracingService.traceOperation('EventBus.handleEvent', async () => {
      try {
        // Validate incoming event
        const validEvent = validateEvent(eventData.type, eventData)
        
        console.log(`Handling event: ${validEvent.type}`, {
          correlationId,
          eventId: validEvent.id,
          source: validEvent.source,
        })
        
        // Process event with handler
        await handler(validEvent)
        
        console.log(`Event handled successfully: ${validEvent.type}`, {
          correlationId,
          eventId: validEvent.id,
        })
      } catch (error) {
        console.error(`Failed to handle event: ${eventData.type}`, error)
        
        // Publish error event for monitoring
        await this.publishError(eventData, error as Error, correlationId)
        
        throw error
      }
    }, { correlationId, eventType: eventData.type })
  }
  
  /**
   * Publish error event for failed event processing
   */
  private async publishError(
    originalEvent: any,
    error: Error,
    correlationId: string
  ): Promise<void> {
    try {
      await eventBridgeClient.send(new PutEventsCommand({
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
      }))
    } catch (publishError) {
      console.error('Failed to publish error event', publishError)
    }
  }
  
  /**
   * Helper to chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }
}

// Export singleton instance
export const eventBusService = EventBusService.getInstance()