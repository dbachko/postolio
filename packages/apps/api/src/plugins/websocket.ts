import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';

interface BaseMessage<T extends string> {
  type: T;
}
type PingMessage = BaseMessage<'ping'>;
interface SubscribeMessage extends BaseMessage<'subscribe'> {
  brandId?: string;
  rooms?: string[]; // Support subscribing to multiple rooms
}
type UnsubscribeMessage = BaseMessage<'unsubscribe'>;
type HeartbeatAckMessage = BaseMessage<'heartbeat_ack'>;

type WebSocketMessage = PingMessage | SubscribeMessage | UnsubscribeMessage | HeartbeatAckMessage;

type OutboundPayload =
  | { type: 'error'; message: string }
  | { type: 'connected'; brandId: string; userId: string; timestamp: string }
  | { type: 'authenticated'; userId: string; timestamp: string }
  | {
      type: 'subscribed';
      brandId?: string;
      rooms?: string[];
      timestamp: string;
    }
  | { type: 'unsubscribed'; timestamp: string }
  | { type: 'pong' }
  | { type: 'heartbeat'; timestamp: string };

interface AuthenticatedSocket extends WebSocket {
  userId?: string;
  brandId?: string | undefined;
  subscribedRooms?: Set<string>; // Track all subscribed rooms
  isAlive?: boolean;
  missedHeartbeats?: number;
}

// Room management using Map
const connections = new Map<string, Set<AuthenticatedSocket>>();

// Heartbeat interval
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Parse cookies from HTTP request header
 */
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

const websocketPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const HEARTBEAT_INTERVAL_MS = 45000; // ~45s, under AWS 10-min idle timeout
  const MAX_MISSED_HEARTBEATS = 2; // Only disconnect after ~90s without acknowledgement

  // Register the base WebSocket plugin
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB max message size
      clientTracking: true,
    },
  });

  // Add broadcast decorator to fastify instance with batched sending for performance
  fastify.decorate(
    'broadcastToRoom',
    (room: string, message: OutboundPayload | Record<string, unknown>) => {
      const sockets = connections.get(room);
      if (!sockets || sockets.size === 0) {
        return;
      }

      const data = JSON.stringify(message);
      const BATCH_SIZE = 100; // Send to 100 sockets at a time
      const socketArray = Array.from(sockets);
      let index = 0;

      function sendBatch() {
        const batch = socketArray.slice(index, index + BATCH_SIZE);
        batch.forEach((sock) => {
          if (sock.readyState === WebSocket.OPEN) {
            try {
              sock.send(data);
            } catch (err) {
              fastify.log.error({ err, room }, 'Failed to send message to socket');
            }
          }
        });
        index += BATCH_SIZE;

        // Schedule next batch asynchronously
        if (index < socketArray.length) {
          setImmediate(sendBatch);
        }
      }

      sendBatch();
    }
  );

  // WebSocket route handler
  // Always use /ws path for WebSocket connections through CloudFront
  const wsPath = '/ws';
  fastify.get(wsPath, { websocket: true }, async (connection, request) => {
    const socket = connection as AuthenticatedSocket;
    socket.isAlive = true;
    socket.missedHeartbeats = 0;

    // Authenticate using cookie from handshake
    const cookies = parseCookies(request.headers.cookie);
    const authToken = cookies.auth_token;

    if (!authToken) {
      fastify.log.info('WebSocket connection rejected: No auth token in cookie');
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      socket.close(1008, 'No authentication cookie');
      return;
    }

    // Verify JWT token
    try {
      const decoded = (await fastify.jwt.verify(authToken)) as { id: string; email: string };
      socket.userId = decoded.id;

      // Send authenticated confirmation
      socket.send(
        JSON.stringify({
          type: 'authenticated',
          userId: socket.userId,
          timestamp: new Date().toISOString(),
        })
      );

      fastify.log.info({ userId: socket.userId }, 'WebSocket authenticated via cookie');
    } catch (error) {
      fastify.log.error({ error }, 'WebSocket authentication failed');
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid authentication token' }));
      socket.close(1008, 'Authentication failed');
      return;
    }

    // Handle pong responses for heartbeat
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', async (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'ping':
            // Treat explicit ping messages from the client as a heartbeat signal.
            // Some edge proxies strip WebSocket control frames, so `socket.on('pong')`
            // might never fire; updating `isAlive` here prevents the server heartbeat
            // from closing otherwise healthy connections.
            socket.isAlive = true;
            socket.missedHeartbeats = 0;
            socket.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'heartbeat_ack':
            // Client confirms receipt of server heartbeat message
            socket.isAlive = true;
            socket.missedHeartbeats = 0;
            break;

          case 'subscribe':
            handleSubscribe(socket, message);
            break;

          case 'unsubscribe':
            handleUnsubscribe(socket);
            break;

          default:
            socket.send(
              JSON.stringify({
                type: 'error',
                message: 'Unknown message type',
              })
            );
        }
      } catch (error) {
        fastify.log.error({ error }, 'WebSocket message error');
        socket.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    socket.on('close', () => {
      cleanupSocket(socket);
    });

    socket.on('error', (error) => {
      fastify.log.error({ error }, 'WebSocket error');
      cleanupSocket(socket);
    });
  });

  // Start heartbeat monitoring
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
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
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to send WebSocket ping frame');
          }

          try {
            socket.send(
              JSON.stringify({
                type: 'heartbeat',
                timestamp: new Date().toISOString(),
              })
            );
          } catch (err) {
            fastify.log.warn({ err }, 'Failed to send WebSocket heartbeat message');
          }
        });
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    // Close all connections
    connections.forEach((sockets) => {
      sockets.forEach((socket) => {
        socket.close(1001, 'Server shutting down');
      });
    });
    connections.clear();
  });
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
