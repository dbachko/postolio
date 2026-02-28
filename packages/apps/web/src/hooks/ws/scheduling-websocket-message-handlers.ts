import type { MutableRefObject } from 'react';
import type { Notification } from '@/lib/api';
import type { NotificationsState } from '@/stores/notificationsStore';
import type { ConnectionStatus, StatusUpdateEvent, WebSocketMessage } from '@/types/websocket';

interface CreateSchedulingWebSocketMessageHandlerParams {
  ws: WebSocket;
  selectedBrandId?: string;
  reconnectAttemptsRef: MutableRefObject<number>;
  isAuthenticatedRef: MutableRefObject<boolean>;
  handleConnectionChange: (status: ConnectionStatus) => void;
  handleStatusUpdate: (event: StatusUpdateEvent) => void;
  handleWebSocketError: (error: Error) => void;
  messageFilter: (message: WebSocketMessage) => boolean;
}

function acknowledgeHeartbeat(ws: WebSocket) {
  ws.send(
    JSON.stringify({
      type: 'heartbeat_ack',
      timestamp: Date.now(),
    })
  );
}

function getSubscriptionRooms(message: WebSocketMessage, selectedBrandId?: string) {
  const rooms: string[] = [];
  if (selectedBrandId) {
    rooms.push(`brand:${selectedBrandId}`);
  }
  const userId = (message as { userId?: unknown }).userId;
  if (typeof userId === 'string' && userId.length > 0) {
    rooms.push(`user:${userId}`);
  }
  return rooms;
}

function subscribeToRooms(ws: WebSocket, message: WebSocketMessage, selectedBrandId?: string) {
  const rooms = getSubscriptionRooms(message, selectedBrandId);
  if (!rooms.length) {
    return;
  }
  ws.send(
    JSON.stringify({
      type: 'subscribe',
      rooms,
    })
  );
}

async function handleNotificationCreated(message: WebSocketMessage) {
  const { useNotificationsStore } = await import('@/stores/notificationsStore');
  const data = (message as { data?: Notification }).data;
  if (!data) {
    return;
  }
  useNotificationsStore.setState((state: NotificationsState) => ({
    items: [data, ...state.items].slice(0, 50),
    unreadCount: (state.unreadCount || 0) + 1,
  }));
}

async function handleUnreadCount(message: WebSocketMessage) {
  const { useNotificationsStore } = await import('@/stores/notificationsStore');
  const count = (message as { data?: { count?: unknown } }).data?.count;
  useNotificationsStore.setState({ unreadCount: typeof count === 'number' ? count : 0 });
}

async function handleNotifications(message: WebSocketMessage) {
  if (message.type === 'notification_created') {
    await handleNotificationCreated(message);
    return;
  }
  if (message.type === 'unread_count') {
    await handleUnreadCount(message);
  }
}

export function createSchedulingWebSocketMessageHandler({
  ws,
  selectedBrandId,
  reconnectAttemptsRef,
  isAuthenticatedRef,
  handleConnectionChange,
  handleStatusUpdate,
  handleWebSocketError,
  messageFilter,
}: CreateSchedulingWebSocketMessageHandlerParams) {
  return async (event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      if (message.type === 'heartbeat') {
        acknowledgeHeartbeat(ws);
        return;
      }
      if (!messageFilter(message)) {
        return;
      }
      if (message.type === 'authenticated') {
        isAuthenticatedRef.current = true;
        reconnectAttemptsRef.current = 0;
        handleConnectionChange('connected');
        subscribeToRooms(ws, message, selectedBrandId);
        return;
      }
      if (message.type === 'status_update' || message.type === 'batch_status_update') {
        handleStatusUpdate(message as StatusUpdateEvent);
      }
      await handleNotifications(message);
    } catch (error) {
      handleWebSocketError(
        error instanceof Error ? error : new Error('Failed to parse WebSocket message')
      );
    }
  };
}
