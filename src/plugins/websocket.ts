import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import fastifyPlugin from 'fastify-plugin'
import fastifyWebsocket from '@fastify/websocket'
import { WebSocket } from 'ws'
import jwt from 'jsonwebtoken'

interface WebSocketMessage {
  type: string
  token?: string
  brandId?: string
  data?: any
}

interface AuthenticatedSocket extends WebSocket {
  userId?: string
  brandId?: string
  isAlive?: boolean
}

// Room management using Map
const connections = new Map<string, Set<AuthenticatedSocket>>()

// Heartbeat interval
let heartbeatInterval: NodeJS.Timeout | null = null

const websocketPlugin: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Register the base WebSocket plugin
  await fastify.register(fastifyWebsocket, {
    options: {
      maxPayload: 1048576, // 1MB max message size
      clientTracking: true
    }
  })

  // Add broadcast decorator to fastify instance
  fastify.decorate('broadcastToRoom', (room: string, message: any) => {
    const sockets = connections.get(room)
    if (!sockets) return

    const data = JSON.stringify(message)
    sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(data)
      }
    })
  })

  // WebSocket route handler
  fastify.get('/ws', { websocket: true }, (connection, req: FastifyRequest) => {
    const socket = connection as AuthenticatedSocket
    socket.isAlive = true

    // Handle pong responses for heartbeat
    socket.on('pong', () => {
      socket.isAlive = true
    })

    socket.on('message', async (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString())

        switch (message.type) {
          case 'auth':
            await handleAuth(socket, message, fastify)
            break
          
          case 'ping':
            socket.send(JSON.stringify({ type: 'pong' }))
            break

          case 'subscribe':
            handleSubscribe(socket, message)
            break

          case 'unsubscribe':
            handleUnsubscribe(socket, message)
            break

          default:
            socket.send(JSON.stringify({ 
              type: 'error', 
              message: 'Unknown message type' 
            }))
        }
      } catch (error) {
        fastify.log.error({ error }, 'WebSocket message error')
        socket.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }))
      }
    })

    socket.on('close', () => {
      cleanupSocket(socket)
    })

    socket.on('error', (error) => {
      fastify.log.error({ error }, 'WebSocket error')
      cleanupSocket(socket)
    })
  })

  // Start heartbeat monitoring
  if (!heartbeatInterval) {
    heartbeatInterval = setInterval(() => {
      connections.forEach((sockets, room) => {
        sockets.forEach(socket => {
          if (socket.isAlive === false) {
            cleanupSocket(socket)
            return
          }
          socket.isAlive = false
          socket.ping()
        })
      })
    }, 30000) // 30 seconds
  }

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }

    // Close all connections
    connections.forEach(sockets => {
      sockets.forEach(socket => {
        socket.close(1001, 'Server shutting down')
      })
    })
    connections.clear()
  })
}

async function handleAuth(
  socket: AuthenticatedSocket, 
  message: WebSocketMessage,
  fastify: FastifyInstance
) {
  if (!message.token) {
    socket.send(JSON.stringify({ 
      type: 'error', 
      message: 'Token required for authentication' 
    }))
    socket.close(1008, 'Authentication failed')
    return
  }

  try {
    const decoded = jwt.verify(
      message.token, 
      process.env.JWT_SECRET!
    ) as { userId: string }
    
    socket.userId = decoded.userId

    // Subscribe to brand room if provided
    if (message.brandId) {
      socket.brandId = message.brandId
      const room = `brand:${message.brandId}`
      
      if (!connections.has(room)) {
        connections.set(room, new Set())
      }
      connections.get(room)!.add(socket)
      
      socket.send(JSON.stringify({ 
        type: 'connected',
        brandId: message.brandId,
        userId: decoded.userId,
        timestamp: new Date().toISOString()
      }))

      fastify.log.info({ userId: decoded.userId, brandId: message.brandId }, 'WebSocket authenticated')
    } else {
      socket.send(JSON.stringify({ 
        type: 'authenticated',
        userId: decoded.userId,
        timestamp: new Date().toISOString()
      }))
    }
  } catch (error) {
    fastify.log.error({ error }, 'WebSocket authentication failed')
    socket.send(JSON.stringify({ 
      type: 'error', 
      message: 'Authentication failed' 
    }))
    socket.close(1008, 'Authentication failed')
  }
}

function handleSubscribe(socket: AuthenticatedSocket, message: WebSocketMessage) {
  if (!socket.userId) {
    socket.send(JSON.stringify({ 
      type: 'error', 
      message: 'Not authenticated' 
    }))
    return
  }

  if (!message.brandId) {
    socket.send(JSON.stringify({ 
      type: 'error', 
      message: 'Brand ID required' 
    }))
    return
  }

  // Unsubscribe from current room if any
  if (socket.brandId) {
    const oldRoom = `brand:${socket.brandId}`
    connections.get(oldRoom)?.delete(socket)
  }

  // Subscribe to new room
  socket.brandId = message.brandId
  const room = `brand:${message.brandId}`
  
  if (!connections.has(room)) {
    connections.set(room, new Set())
  }
  connections.get(room)!.add(socket)

  socket.send(JSON.stringify({ 
    type: 'subscribed',
    brandId: message.brandId,
    timestamp: new Date().toISOString()
  }))
}

function handleUnsubscribe(socket: AuthenticatedSocket, message: WebSocketMessage) {
  if (socket.brandId) {
    const room = `brand:${socket.brandId}`
    connections.get(room)?.delete(socket)
    socket.brandId = undefined

    socket.send(JSON.stringify({ 
      type: 'unsubscribed',
      timestamp: new Date().toISOString()
    }))
  }
}

function cleanupSocket(socket: AuthenticatedSocket) {
  // Remove from all rooms
  if (socket.brandId) {
    const room = `brand:${socket.brandId}`
    connections.get(room)?.delete(socket)
    
    // Clean up empty rooms
    if (connections.get(room)?.size === 0) {
      connections.delete(room)
    }
  }

  // Ensure socket is closed
  if (socket.readyState === WebSocket.OPEN) {
    socket.close()
  }
}

// Export the plugin wrapped with fastify-plugin
export default fastifyPlugin(websocketPlugin, {
  name: 'websocket',
  fastify: '5.x'
})

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    broadcastToRoom: (room: string, message: any) => void
  }
}