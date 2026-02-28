import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';

interface BaseMessage<T extends string> {
  type: T;
}

type PingMessage = BaseMessage<'ping'>;

interface SubscribeMessage extends BaseMessage<'subscribe'> {
  brandId?: string;
  rooms?: string[];
}

type UnsubscribeMessage = BaseMessage<'unsubscribe'>;
type HeartbeatAckMessage = BaseMessage<'heartbeat_ack'>;

type WebSocketMessage = PingMessage | SubscribeMessage | UnsubscribeMessage | HeartbeatAckMessage;

type OutboundPayload =
  | { type: 'error'; message: string }
  | { type: 'connected'; brandId: string; userId: string; timestamp: string }
  | { type: 'authenticated'; userId: string; timestamp: string }
  | { type: 'subscribed'; brandId?: string; rooms?: string[]; timestamp: string }
  | { type: 'unsubscribed'; timestamp: string }
  | { type: 'pong' }
  | { type: 'heartbeat'; timestamp: string };

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  brandId?: string | undefined;
  subscribedRooms?: Set<string>;
  isAlive?: boolean;
  missedHeartbeats?: number;
}

const connections = new Map<string, Set<AuthenticatedSocket>>();

const HEARTBEAT_INTERVAL_MS = 45_000;
const MAX_MISSED_HEARTBEATS = 2;
let heartbeatInterval: NodeJS.Timeout | null = null;

function sendPayload(socket: AuthenticatedSocket, payload: OutboundPayload): void {
  socket.send(JSON.stringify(payload));
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce(
    (cookies, cookie) => {
      const [name, ...rest] = cookie.trim().split('=');
      cookies[name] = rest.join('=');
      return cookies;
    },
    {} as Record<string, string>
  );
}

function registerBroadcastDecorator(fastify: FastifyInstance): void {
  fastify.decorate(
    'broadcastToRoom',
    (room: string, message: OutboundPayload | Record<string, unknown>) => {
      const sockets = connections.get(room);
      if (!sockets || sockets.size === 0) {
        return;
      }

      const data = JSON.stringify(message);
      const socketArray = Array.from(sockets);
      const batchSize = 100;
      let index = 0;

      const sendBatch = () => {
        socketArray.slice(index, index + batchSize).forEach((socket) => {
          if (socket.readyState !== WebSocket.OPEN) {
            return;
          }

          try {
            socket.send(data);
          } catch (error) {
            fastify.log.error({ err: error, room }, 'Failed to send message to socket');
          }
        });

        index += batchSize;
        if (index < socketArray.length) {
          setImmediate(sendBatch);
        }
      };

      sendBatch();
    }
  );
}

async function authenticateSocket(
  fastify: FastifyInstance,
  socket: AuthenticatedSocket,
  request: FastifyRequest
): Promise<boolean> {
  const cookies = parseCookies(request.headers.cookie);
  const authToken = cookies.auth_token;

  if (!authToken) {
    fastify.log.info('WebSocket connection rejected: No auth token in cookie');
    sendPayload(socket, { type: 'error', message: 'Authentication required' });
    socket.close(1008, 'No authentication cookie');
    return false;
  }

  try {
    const decoded = (await fastify.jwt.verify(authToken)) as { id: string; email: string };
    socket.userId = decoded.id;
    sendPayload(socket, {
      type: 'authenticated',
      userId: socket.userId,
      timestamp: new Date().toISOString(),
    });
    fastify.log.info({ userId: socket.userId }, 'WebSocket authenticated via cookie');
    return true;
  } catch (error) {
    fastify.log.error({ error }, 'WebSocket authentication failed');
    sendPayload(socket, { type: 'error', message: 'Invalid authentication token' });
    socket.close(1008, 'Authentication failed');
    return false;
  }
}

function handleSocketMessage(
  fastify: FastifyInstance,
  socket: AuthenticatedSocket,
  message: WebSocketMessage
): void {
  switch (message.type) {
    case 'ping':
      socket.isAlive = true;
      socket.missedHeartbeats = 0;
      sendPayload(socket, { type: 'pong' });
      return;
    case 'heartbeat_ack':
      socket.isAlive = true;
      socket.missedHeartbeats = 0;
      return;
    case 'subscribe':
      handleSubscribe(socket, message);
      return;
    case 'unsubscribe':
      handleUnsubscribe(socket);
      return;
    default:
      fastify.log.warn(
        { messageType: (message as { type?: string }).type },
        'Unknown WebSocket message type'
      );
      sendPayload(socket, { type: 'error', message: 'Unknown message type' });
  }
}

function registerSocketHandlers(fastify: FastifyInstance, socket: AuthenticatedSocket): void {
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', async (data: Buffer) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      handleSocketMessage(fastify, socket, message);
    } catch (error) {
      fastify.log.error({ error }, 'WebSocket message error');
      sendPayload(socket, { type: 'error', message: 'Invalid message format' });
    }
  });

  socket.on('close', () => {
    cleanupSocket(socket);
  });

  socket.on('error', (error) => {
    fastify.log.error({ error }, 'WebSocket error');
    cleanupSocket(socket);
  });
}

function registerWebSocketRoute(fastify: FastifyInstance): void {
  fastify.get('/ws', { websocket: true }, async (connection, request) => {
    const socket = connection as AuthenticatedSocket;
    socket.isAlive = true;
    socket.missedHeartbeats = 0;

    const authenticated = await authenticateSocket(fastify, socket, request);
    if (!authenticated) {
      return;
    }

    registerSocketHandlers(fastify, socket);
  });
}

function monitorHeartbeat(fastify: FastifyInstance): void {
  connections.forEach((sockets) => {
    sockets.forEach((socket) => {
      if (socket.readyState !== WebSocket.OPEN) {
        cleanupSocket(socket);
        return;
      }

      if (socket.isAlive === false) {
        socket.missedHeartbeats = (socket.missedHeartbeats || 0) + 1;
        if (socket.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
          cleanupSocket(socket);
          return;
        }
      } else {
        socket.missedHeartbeats = 0;
      }

      socket.isAlive = false;

      try {
        socket.ping();
      } catch (error) {
        fastify.log.warn({ err: error }, 'Failed to send WebSocket ping frame');
      }

      try {
        sendPayload(socket, { type: 'heartbeat', timestamp: new Date().toISOString() });
      } catch (error) {
        fastify.log.warn({ err: error }, 'Failed to send WebSocket heartbeat message');
      }
    });
  });
}

function startHeartbeatMonitoring(fastify: FastifyInstance): void {
  if (heartbeatInterval) {
    return;
  }

  heartbeatInterval = setInterval(() => {
    monitorHeartbeat(fastify);
  }, HEARTBEAT_INTERVAL_MS);
}

function registerCleanupHook(fastify: FastifyInstance): void {
  fastify.addHook('onClose', async () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    connections.forEach((sockets) => {
      sockets.forEach((socket) => {
        socket.close(1001, 'Server shutting down');
      });
    });
    connections.clear();
  });
}

const websocketPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1_048_576,
      clientTracking: true,
    },
  });

  registerBroadcastDecorator(fastify);
  registerWebSocketRoute(fastify);
  startHeartbeatMonitoring(fastify);
  registerCleanupHook(fastify);
};

function handleSubscribe(socket: AuthenticatedSocket, message: SubscribeMessage) {
  if (!socket.userId) {
    socket.send(
      JSON.stringify({
        type: 'error',
        message: 'Not authenticated',
      })
    );
    return;
  }

  // Initialize subscribedRooms if not exists
  if (!socket.subscribedRooms) {
    socket.subscribedRooms = new Set();
  }

  const roomsToSubscribe: string[] = [];

  if (message.brandId) {
    roomsToSubscribe.push(`brand:${message.brandId}`);
    socket.brandId = message.brandId; // Keep for backward compatibility
  }

  // Handle explicit rooms array
  if (message.rooms && Array.isArray(message.rooms)) {
    roomsToSubscribe.push(...message.rooms);
  }

  if (roomsToSubscribe.length === 0) {
    socket.send(
      JSON.stringify({
        type: 'error',
        message: 'At least one room identifier required (brandId or rooms)',
      })
    );
    return;
  }

  // Unsubscribe from previous rooms
  if (socket.subscribedRooms.size > 0) {
    for (const oldRoom of socket.subscribedRooms) {
      connections.get(oldRoom)?.delete(socket);
      // Clean up empty rooms
      if (connections.get(oldRoom)?.size === 0) {
        connections.delete(oldRoom);
      }
    }
    socket.subscribedRooms.clear();
  }

  // Subscribe to new rooms
  for (const room of roomsToSubscribe) {
    if (!connections.has(room)) {
      connections.set(room, new Set());
    }
    connections.get(room)!.add(socket);
    socket.subscribedRooms.add(room);
  }

  socket.send(
    JSON.stringify({
      type: 'subscribed',
      brandId: message.brandId,
      rooms: Array.from(socket.subscribedRooms),
      timestamp: new Date().toISOString(),
    })
  );
}

function handleUnsubscribe(socket: AuthenticatedSocket) {
  // Unsubscribe from all rooms
  if (socket.subscribedRooms && socket.subscribedRooms.size > 0) {
    for (const room of socket.subscribedRooms) {
      connections.get(room)?.delete(socket);
      // Clean up empty rooms
      if (connections.get(room)?.size === 0) {
        connections.delete(room);
      }
    }
    socket.subscribedRooms.clear();
  }

  if (socket.brandId) {
    const room = `brand:${socket.brandId}`;
    connections.get(room)?.delete(socket);
    socket.brandId = undefined;
  }

  socket.send(
    JSON.stringify({
      type: 'unsubscribed',
      timestamp: new Date().toISOString(),
    })
  );
}

function cleanupSocket(socket: AuthenticatedSocket) {
  // Remove from all subscribed rooms
  if (socket.subscribedRooms && socket.subscribedRooms.size > 0) {
    for (const room of socket.subscribedRooms) {
      connections.get(room)?.delete(socket);
      // Clean up empty rooms
      if (connections.get(room)?.size === 0) {
        connections.delete(room);
      }
    }
    socket.subscribedRooms.clear();
  }

  if (socket.brandId) {
    const room = `brand:${socket.brandId}`;
    connections.get(room)?.delete(socket);
  }

  // Ensure socket is closed
  if (socket.readyState === WebSocket.OPEN) {
    socket.close();
  }
}

// Export the plugin wrapped with fastify-plugin
export default fastifyPlugin(websocketPlugin, {
  name: 'websocket',
  fastify: '5.x',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    broadcastToRoom: (room: string, message: OutboundPayload | Record<string, unknown>) => void;
  }
}
