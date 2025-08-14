import { FastifyPluginAsync } from 'fastify'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'

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

  // Register cookie plugin
  await fastify.register(cookie)

  // Authentication decorator
  fastify.decorate('authenticate', async function (request: any, reply: any) {
    try {
      await request.jwtVerify()
      // The jwtVerify() method sets request.user with the decoded token payload
      console.log('After jwtVerify, request.user:', request.user)
    } catch (err) {
      reply.code(401).send({ error: 'Authentication required' })
    }
  })
}

export default authPlugin