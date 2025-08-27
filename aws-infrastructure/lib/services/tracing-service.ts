/**
 * X-Ray Distributed Tracing Service
 * Provides distributed tracing across all microservices
 */

import * as AWSXRay from 'aws-xray-sdk-core'
import { Subsegment, Segment } from 'aws-xray-sdk-core'

// Only capture AWS SDK calls in production
if (process.env.NODE_ENV === 'production') {
  AWSXRay.captureAWS(require('aws-sdk'))
}

export interface TraceMetadata {
  correlationId?: string
  userId?: string
  brandId?: string
  [key: string]: any
}

export class TracingService {
  private static instance: TracingService
  
  static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService()
    }
    return TracingService.instance
  }
  
  /**
   * Trace an operation with X-Ray
   */
  async traceOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T> {
    // In development, just execute without tracing
    if (process.env.NODE_ENV !== 'production') {
      return operation()
    }
    
    const segment = AWSXRay.getSegment()
    
    if (!segment) {
      // No active segment, execute without tracing
      console.warn(`No active X-Ray segment for operation: ${operationName}`)
      return operation()
    }
    
    const subsegment = segment.addNewSubsegment(operationName)
    
    try {
      // Add metadata
      if (metadata) {
        Object.entries(metadata).forEach(([key, value]) => {
          if (value !== undefined) {
            // Add as annotation for searchability
            if (['correlationId', 'userId', 'brandId'].includes(key)) {
              subsegment.addAnnotation(key, String(value))
            }
            // Add as metadata for detail
            subsegment.addMetadata(key, value)
          }
        })
      }
      
      // Execute operation
      const result = await operation()
      
      // Mark as successful
      subsegment.close()
      
      return result
    } catch (error) {
      // Add error to subsegment
      subsegment.addError(error as Error)
      subsegment.close(error as Error)
      
      throw error
    }
  }
  
  /**
   * Trace an HTTP request
   */
  async traceHttpRequest<T>(
    url: string,
    method: string,
    operation: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T> {
    return this.traceOperation(`HTTP ${method} ${url}`, async () => {
      const startTime = Date.now()
      
      try {
        const result = await operation()
        const duration = Date.now() - startTime
        
        // Log successful request
        console.log(`HTTP ${method} ${url} - ${duration}ms`, {
          correlationId: metadata?.correlationId,
        })
        
        return result
      } catch (error) {
        const duration = Date.now() - startTime
        
        // Log failed request
        console.error(`HTTP ${method} ${url} - ${duration}ms - FAILED`, {
          correlationId: metadata?.correlationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        
        throw error
      }
    }, {
      ...metadata,
      httpMethod: method,
      url,
    })
  }
  
  /**
   * Trace a database operation
   */
  async traceDatabaseOperation<T>(
    tableName: string,
    operation: string,
    query: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T> {
    return this.traceOperation(`DynamoDB.${operation}`, async () => {
      const startTime = Date.now()
      
      try {
        const result = await query()
        const duration = Date.now() - startTime
        
        // Log successful query
        console.log(`DynamoDB ${operation} on ${tableName} - ${duration}ms`, {
          correlationId: metadata?.correlationId,
        })
        
        return result
      } catch (error) {
        const duration = Date.now() - startTime
        
        // Log failed query
        console.error(`DynamoDB ${operation} on ${tableName} - ${duration}ms - FAILED`, {
          correlationId: metadata?.correlationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        
        throw error
      }
    }, {
      ...metadata,
      tableName,
      operation,
    })
  }
  
  /**
   * Add custom annotation to current segment
   */
  addAnnotation(key: string, value: string | number | boolean): void {
    if (process.env.NODE_ENV !== 'production') return
    
    const segment = AWSXRay.getSegment()
    if (segment) {
      segment.addAnnotation(key, String(value))
    }
  }
  
  /**
   * Add custom metadata to current segment
   */
  addMetadata(namespace: string, key: string, value: any): void {
    if (process.env.NODE_ENV !== 'production') return
    
    const segment = AWSXRay.getSegment()
    if (segment) {
      segment.addMetadata(key, value, namespace)
    }
  }
  
  /**
   * Create a new subsegment for custom operations
   */
  createSubsegment(name: string): Subsegment | null {
    if (process.env.NODE_ENV !== 'production') return null
    
    const segment = AWSXRay.getSegment()
    if (segment) {
      return segment.addNewSubsegment(name)
    }
    return null
  }
  
  /**
   * Get correlation ID from current segment
   */
  getCorrelationId(): string | undefined {
    if (process.env.NODE_ENV !== 'production') {
      return crypto.randomUUID()
    }
    
    const segment = AWSXRay.getSegment()
    if (segment) {
      const annotations = (segment as any).annotations
      return annotations?.correlationId
    }
    return undefined
  }
  
  /**
   * Wrap a Lambda handler with X-Ray tracing
   */
  static traceLambdaHandler<TEvent, TResult>(
    handlerName: string,
    handler: (event: TEvent, context: any) => Promise<TResult>
  ): (event: TEvent, context: any) => Promise<TResult> {
    if (process.env.NODE_ENV !== 'production') {
      return handler
    }
    
    return async (event: TEvent, context: any): Promise<TResult> => {
      const segment = AWSXRay.getSegment()
      
      if (!segment) {
        // No segment available, execute without tracing
        return handler(event, context)
      }
      
      // Add Lambda context to segment
      segment.addAnnotation('handler', handlerName)
      segment.addAnnotation('requestId', context.requestId)
      
      // Add event metadata
      if ((event as any).correlationId) {
        segment.addAnnotation('correlationId', (event as any).correlationId)
      }
      
      try {
        const result = await handler(event, context)
        return result
      } catch (error) {
        segment.addError(error as Error)
        throw error
      }
    }
  }
}

// Export singleton instance
export const tracingService = TracingService.getInstance()