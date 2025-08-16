import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'

interface UserPayload {
  id: string
  email: string
}


/**
 * Authentication middleware for Fastify
 * Verifies JWT tokens and attaches user to request
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Try to get token from cookie first (more secure)
    let token = request.cookies?.auth_token
    
    // Fallback to Authorization header for backward compatibility
    if (!token) {
      const authHeader = request.headers.authorization
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ 
          success: false,
          error: 'Authentication required' 
        })
      }

      token = authHeader.slice(7)
    }
    
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET not configured')
      return reply.code(500).send({ 
        success: false,
        error: 'Server configuration error' 
      })
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as UserPayload
    // @ts-ignore - FastifyJWT types conflict with manual assignment
    request.user = decoded
    
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return reply.code(401).send({ 
        success: false,
        error: 'Token expired' 
      })
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      return reply.code(401).send({ 
        success: false,
        error: 'Invalid token' 
      })
    }
    
    return reply.code(500).send({ 
      success: false,
      error: 'Authentication failed' 
    })
  }
}

/**
 * Optional authentication middleware
 * Sets user if token is valid, but doesn't require it
 */
export async function optionalAuth(
  request: FastifyRequest
): Promise<void> {
  try {
    const authHeader = request.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return
    }

    const token = authHeader.slice(7)
    
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET not configured')
      return
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET) as UserPayload
    // @ts-ignore - FastifyJWT types conflict with manual assignment
    request.user = decoded
    
  } catch (error) {
    // Silently fail for optional auth
    console.debug('Optional auth failed:', error)
  }
}