import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'
import { signJWT, verifyJWT } from '../services/jwt.js'

const prisma = new PrismaClient()

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
  // Wait for JWT plugin to be registered
  await fastify.after()
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
      userId: user.id, 
      email: user.email 
    })

    // Return user without password
    const { password: _, ...userWithoutPassword } = user

    return reply.send({
      token,
      user: userWithoutPassword
    })
  })

  // Get current user profile  
  fastify.get('/me', async (request, reply) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Authentication required' })
      }

      const token = authHeader.substring(7)
      const decoded = verifyJWT(token)
      const userId = decoded.userId || decoded.id

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          instagramUsername: true,
          subscriptionTier: true,
          createdAt: true
        }
      })

      return { user }
    } catch (err) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
  })
}

export default authRoutes