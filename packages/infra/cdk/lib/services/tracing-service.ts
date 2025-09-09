/**
 * Tracing Service
 * Stub implementation for build compatibility
 */

export class TracingService {
  private static instance: TracingService

  private constructor() {}

  static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService()
    }
    return TracingService.instance
  }

  startSegment(name: string): any {
    // Stub implementation
    console.log(`Starting trace segment: ${name}`)
    return { name }
  }

  endSegment(segment: any): void {
    // Stub implementation
    console.log(`Ending trace segment: ${segment.name}`)
  }

  addAnnotation(key: string, value: any): void {
    // Stub implementation
    console.log(`Adding annotation: ${key} = ${value}`)
  }

  addMetadata(key: string, value: any): void {
    // Stub implementation
    console.log(`Adding metadata: ${key}`)
  }

  captureError(error: Error): void {
    // Stub implementation
    console.error(`Captured error:`, error)
  }
}

export default TracingService