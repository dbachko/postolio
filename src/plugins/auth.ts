import { FastifyPluginAsync } from 'fastify'
import jwt from '@fastify/jwt'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string
      email: string
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Register JWT plugin
  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET || 'fallback-secret-for-development'
  })

  // Cookie plugin is registered elsewhere in the application

  // Authentication decorator
  fastify.decorate('authenticate', async function (request: any, reply: any) {
    try {
      // Check for token in Authorization header first
      const authHeader = request.headers.authorization
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        request.user = await fastify.jwt.verify(token)
      } else {
        // Fall back to cookie-based authentication
        await request.jwtVerify()
        // The jwtVerify() method sets request.user with the decoded token payload
      }
      
      // Validate that user object has required fields
      if (!request.user || !request.user.id || !request.user.email) {
        throw new Error('Invalid user token payload')
      }
    } catch {
      // Send 401 response - Fastify will stop the request chain
      return reply.code(401).send({ error: 'Authentication required' })
    }
  })
}

export default authPlugin