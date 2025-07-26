import fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import authPlugin from './plugins/auth.js'
import authRoutes from './routes/auth.js'
import brandsRoutes from './routes/brands.js'
import contentRoutes from './routes/content.js'
import instagramRoutes from './routes/instagram.js'
import analyticsRoutes from './routes/analytics.js'
import engagementRoutes from './routes/engagement.js'
import growthRoutes from './routes/growth.js'
import aiRoutes from './routes/ai.js'

export function buildFastify(): FastifyInstance {
  const app = fastify({
    logger: {
      level: 'info'
    }
  })

  // Register plugins
  app.register(cors, {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true
  })
  app.register(helmet)
  app.register(authPlugin)

  // Register routes
  app.register(authRoutes, { prefix: '/auth' })
  app.register(brandsRoutes, { prefix: '/brands' })
  app.register(contentRoutes, { prefix: '/content' })
  app.register(instagramRoutes, { prefix: '/instagram' })
  app.register(analyticsRoutes, { prefix: '/analytics' })
  app.register(engagementRoutes, { prefix: '/engagement' })
  app.register(growthRoutes, { prefix: '/growth' })
  app.register(aiRoutes, { prefix: '/ai' })

  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  return app
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildFastify()
  
  app.listen({ port: 3000, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
    app.log.info(`Server listening at ${address}`)
  })
}