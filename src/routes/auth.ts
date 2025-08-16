import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { signJWT, verifyJWT } from '../services/jwt.js'
import { getDatabaseClient } from '../config/database.js'

const prisma = getDatabaseClient()

interface RegisterBody {
  email: string
  password: string
  name?: string
}

interface LoginBody {
  email: string
  password: string
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // User registration
  fastify.post<{ Body: RegisterBody }>('/register', async (request, reply) => {
    const { email, password, name } = request.body

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })

    if (existingUser) {
      return reply.code(409).send({ error: 'User already exists' })
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true
      }
    })

    // Generate JWT token
    const token = signJWT({ 
      id: user.id, 
      email: user.email 
    })

    // Set HTTP-only cookie for enhanced security
    reply.setCookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    })

    return reply.code(201).send({
      token,
      user
    })
  })

  // User login
  fastify.post<{ Body: LoginBody }>('/login', async (request, reply) => {
    const { email, password } = request.body

    // Find user with password for verification
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        subscriptionTier: true
      }
    })

    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password)
    if (!validPassword) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }

    // Generate JWT token
    const token = signJWT({ 
      id: user.id, 
      email: user.email 
    })

    // Set HTTP-only cookie for enhanced security
    reply.setCookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    })

    // Return user without password
    const { password: _, ...userWithoutPassword } = user

    return reply.send({
      token,
      user: userWithoutPassword
    })
  })

  // Refresh token endpoint
  fastify.post('/refresh', {
    preHandler: fastify.authenticate
  }, async (request: any, reply) => {
    // After authenticate middleware, user is guaranteed to exist
    const userId = request.user.id
    const userEmail = request.user.email
    
    // Generate new token with same payload
    const newToken = signJWT({ 
      id: userId, 
      email: userEmail 
    })
    
    // Set new HTTP-only cookie
    reply.setCookie('auth_token', newToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 // 7 days
    })
    
    return reply.send({ token: newToken })
  })

  // Logout endpoint
  fastify.post('/logout', async (request, reply) => {
    // Clear the HTTP-only cookie
    reply.clearCookie('auth_token', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    })
    
    return reply.send({ success: true, message: 'Logged out successfully' })
  })

  // Get current user profile  
  fastify.get('/me', async (request, reply) => {
    try {
      // Try to get token from cookie first (more secure)
      let token = (request as any).cookies?.auth_token
      
      // Fallback to Authorization header for backward compatibility
      if (!token) {
        const authHeader = request.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.code(401).send({ error: 'Authentication required' })
        }
        token = authHeader.substring(7)
      }
      const decoded = verifyJWT(token)
      const userId = decoded.id

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          instagramUsername: true,
          subscriptionTier: true,
          timezone: true,
          timezoneAutoDetected: true,
          createdAt: true,
          updatedAt: true
        }
      })

      if (!user) {
        return reply.code(404).send({ error: 'User not found' })
      }

      return { user }
    } catch (err) {
      // Log the specific error for debugging
      if (err instanceof Error) {
        console.error('Auth verification failed:', err.message)
        if (err.name === 'TokenExpiredError') {
          return reply.code(401).send({ error: 'Token expired' })
        } else if (err.name === 'JsonWebTokenError') {
          return reply.code(401).send({ error: 'Invalid token' })
        }
      }
      return reply.code(401).send({ error: 'Authentication required' })
    }
  })
}

export default authRoutes