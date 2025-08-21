// WebSocket-related type definitions
export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface StatusUpdateEvent {
  type: 'status_update' | 'batch_status_update'
  data: StatusUpdateData | StatusUpdateData[]
}

export interface StatusUpdateData {
  contentId: string
  oldStatus: ContentStatus
  newStatus: ContentStatus
  metadata?: Record<string, any>
  timestamp: string
}

export interface WebSocketMessage {
  type: 'auth' | 'subscribe' | 'ping' | 'pong' | 'auth_success' | 'auth_error' | 'subscribed' | 'status_update' | 'batch_status_update'
  token?: string
  room?: string
  error?: string
  data?: StatusUpdateData | StatusUpdateData[]
}

export interface UseSchedulingWebSocketOptions {
  enabled?: boolean
  onStatusUpdate?: (event: StatusUpdateEvent) => void
  onConnectionChange?: (status: ConnectionStatus) => void
  onError?: (error: WebSocketError) => void
  reconnectInterval?: number
  maxReconnectAttempts?: number
  heartbeatInterval?: number
}

export interface QueuedAction {
  id: string
  type: 'schedule' | 'reschedule' | 'cancel'
  payload: Record<string, any>
  timestamp: number
  retries: number
  lastAttempt?: number
  maxRetries?: number
}

export interface OfflineQueueOptions {
  maxRetries?: number
  retryDelay?: number
  onProcess?: (action: QueuedAction) => Promise<boolean>
  onError?: (action: QueuedAction, error: WebSocketError) => void
}

export class WebSocketError extends Error {
  public readonly code: string
  public readonly isOperational: boolean = true

  constructor(message: string, code: string) {
    super(message)
    this.name = 'WebSocketError'
    this.code = code
    Error.captureStackTrace(this)
  }
}

export class ConnectionError extends WebSocketError {
  constructor(message: string) {
    super(message, 'CONNECTION_ERROR')
  }
}

export class AuthenticationError extends WebSocketError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR')
  }
}

// Utility function to check if error is retryable
export function isRetryableError(error: WebSocketError): boolean {
  const retryableCodes = ['CONNECTION_ERROR', 'TIMEOUT_ERROR', 'NETWORK_ERROR']
  return retryableCodes.includes(error.code)
}

// Utility function to check if error is operational (vs programmer error)
export function isOperationalError(error: Error): boolean {
  return error instanceof WebSocketError && error.isOperational
}