// WebSocket-related type definitions
export type ContentStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'skipped';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// ReadyState enum following react-use-websocket pattern
export enum ReadyState {
  UNINSTANTIATED = -1,
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

// Connection status mapping for better UX
export const CONNECTION_STATUS_MAP = {
  [ReadyState.CONNECTING]: 'connecting',
  [ReadyState.OPEN]: 'connected',
  [ReadyState.CLOSING]: 'disconnected',
  [ReadyState.CLOSED]: 'disconnected',
  [ReadyState.UNINSTANTIATED]: 'disconnected',
} as const;

export interface StatusUpdateEvent {
  type: 'status_update' | 'batch_status_update';
  data: StatusUpdateData | StatusUpdateData[];
}

export interface StatusUpdateData {
  contentId: string;
  oldStatus: ContentStatus;
  newStatus: ContentStatus;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface CampaignStatusUpdateData {
  campaignId: string;
  brandId: string;
  oldStatus: CampaignStatus;
  newStatus: CampaignStatus;
  errorMessage?: string | null;
  previewGenerated?: boolean;
  isRunning: boolean;
  metadata?: {
    completedSteps?: string[];
    totalSteps?: number;
    estimatedTimeRemaining?: number;
    lastActivity?: string;
  };
  timestamp: string;
}

export interface CampaignErrorData {
  campaignId: string;
  brandId: string;
  errorType: 'validation' | 'generation' | 'scheduling' | 'network' | 'system';
  errorMessage: string;
  errorCode?: string;
  retryable: boolean;
  timestamp: string;
}

export type CampaignStatus =
  | 'draft'
  | 'preview'
  | 'creating'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed';

export interface WebSocketMessage {
  type:
    | 'authenticated' // Cookie-based auth confirmation from server
    | 'subscribe'
    | 'ping'
    | 'pong'
    | 'heartbeat'
    | 'subscribed'
    | 'status_update'
    | 'batch_status_update'
    | 'campaign_status_update'
    | 'campaign_error'
    | 'notification_created'
    | 'unread_count';
  room?: string;
  brandId?: string;
  campaignId?: string;
  rooms?: string[];
  error?: string;
  data?:
    | StatusUpdateData
    | StatusUpdateData[]
    | CampaignStatusUpdateData
    | CampaignErrorData
    | NotificationCreatedData
    | UnreadCountData;
  timestamp?: number; // For latency measurement in ping/pong
}

export interface NotificationCreatedData {
  id: string;
  type: string;
  category: string;
  severity: 'info' | 'warning' | 'error' | string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
  resource?: { type?: string | null; id?: string | null };
  createdAt: string;
  readAt?: string | null;
}

export interface UnreadCountData {
  count: number;
}

export interface UseSchedulingWebSocketOptions {
  enabled?: boolean;
  onStatusUpdate?: (event: StatusUpdateEvent) => void;
  onCampaignStatusUpdate?: (data: CampaignStatusUpdateData) => void;
  onCampaignError?: (data: CampaignErrorData) => void;
  onConnectionChange?: (status: ConnectionStatus) => void;
  onError?: (error: WebSocketError) => void;
  reconnectInterval?: number | ((lastAttemptNumber: number) => number); // Support function for exponential backoff
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  // Message filtering support following react-use-websocket pattern
  filter?: (message: WebSocketMessage) => boolean;
  // Should reconnect callback
  shouldReconnect?: (closeEvent: CloseEvent) => boolean;
  // Retry on error flag
  retryOnError?: boolean;
}

export interface QueuedAction {
  id: string;
  type: 'schedule' | 'reschedule' | 'cancel';
  payload: Record<string, unknown>;
  timestamp: number;
  retries: number;
  lastAttempt?: number;
  maxRetries?: number;
}

export interface OfflineQueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  onProcess?: (action: QueuedAction) => Promise<boolean>;
  onError?: (action: QueuedAction, error: WebSocketError) => void;
}

export class WebSocketError extends Error {
  public readonly code: string;
  public readonly isOperational: boolean = true;
  public readonly timestamp: number;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'WebSocketError';
    this.code = code;
    this.timestamp = Date.now();
    this.context = context;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, WebSocketError);
    }
  }
}

export class ConnectionError extends WebSocketError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONNECTION_ERROR', context);
  }
}

export class AuthenticationError extends WebSocketError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', context);
  }
}

export class TimeoutError extends WebSocketError {
  constructor(message: string, timeout: number) {
    super(message, 'TIMEOUT_ERROR', { timeout });
  }
}

export class NetworkError extends WebSocketError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', context);
  }
}

// Utility function to check if error is retryable
export function isRetryableError(error: WebSocketError): boolean {
  const retryableCodes = ['CONNECTION_ERROR', 'TIMEOUT_ERROR', 'NETWORK_ERROR'];
  return retryableCodes.includes(error.code);
}

// Utility function to check if error is operational (vs programmer error)
export function isOperationalError(error: Error): boolean {
  return error instanceof WebSocketError && error.isOperational;
}

// Utility function to get friendly connection status message
export function getConnectionStatusMessage(status: ConnectionStatus): string {
  const messages = {
    connecting: 'Connecting to server...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    error: 'Connection error',
  };
  return messages[status] || 'Unknown status';
}

// Utility function to check if WebSocket should reconnect based on close event
export function shouldReconnectDefault(closeEvent: CloseEvent): boolean {
  // Don't reconnect for normal closure or policy violations
  if (closeEvent.code === 1000 || closeEvent.code === 1008) {
    return false;
  }
  // Reconnect for all other cases (unexpected disconnections)
  return true;
}
