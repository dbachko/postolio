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
      await request.jwtVerify()
      // The jwtVerify() method sets request.user with the decoded token payload
    } catch {
      reply.code(401).send({ error: 'Authentication required' })
    }
  })
}

export default authPlugin