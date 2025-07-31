import fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fs from 'fs'
import path from 'path'
import authPlugin from './plugins/auth.js'
import monitoringPlugin from './plugins/monitoring.js'
import authRoutes from './routes/auth.js'
import monitoringRoutes from './routes/monitoring.js'
import instagramOAuthRoutes from './routes/instagram-oauth.js'
import brandsRoutes from './routes/brands.js'
import contentRoutes from './routes/content.js'
import instagramRoutes from './routes/instagram.js'
import analyticsRoutes from './routes/analytics.js'
import instagramAnalyticsRoutes from './routes/instagram-analytics.js'
import engagementRoutes from './routes/engagement.js'
import growthRoutes from './routes/growth.js'
import aiRoutes from './routes/ai.js'
import autopilotRoutes from './routes/autopilot.js'
import campaignRoutes from './routes/campaign.js'
import { autopilotService } from './services/autopilot.js'
import { schedulerService } from './services/scheduler.js'

export function buildFastify(): FastifyInstance {
  // HTTPS configuration for local development
  let httpsOptions = {}
  
  if (process.env.NODE_ENV === 'development') {
    try {
      // Look for local SSL certificates
      const certPath = process.env.SSL_CERT_PATH || path.join(process.cwd(), 'certs', 'localhost.crt')
      const keyPath = process.env.SSL_KEY_PATH || path.join(process.cwd(), 'certs', 'localhost.key')
      
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        httpsOptions = {
          https: {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
          }
        }
      }
    } catch (error) {
      console.log('No SSL certificates found, running on HTTP')
    }
  }

  const app = fastify({
    logger: {
      level: 'info'
    },
    ...httpsOptions
  })

  // Register plugins
  app.register(cors, {
    origin: [
      'http://localhost:5173', 
      'http://127.0.0.1:5173',
      'https://localhost:5173',
      'https://localhost:3000',
      'https://ai.localhost:5173',
      'https://ai.localhost'
    ],
    credentials: true
  })
  app.register(helmet)
  app.register(monitoringPlugin)
  app.register(authPlugin)

  // Register routes
  app.register(monitoringRoutes, { prefix: '/monitoring' })
  app.register(authRoutes, { prefix: '/auth' })
  app.register(instagramOAuthRoutes, { prefix: '/auth/instagram' })
  app.register(brandsRoutes, { prefix: '/brands' })
  app.register(contentRoutes, { prefix: '/content' })
  app.register(instagramRoutes, { prefix: '/instagram' })
  app.register(analyticsRoutes, { prefix: '/analytics' })
  app.register(instagramAnalyticsRoutes, { prefix: '/instagram-analytics' })
  app.register(engagementRoutes, { prefix: '/engagement' })
  app.register(growthRoutes, { prefix: '/growth' })
  app.register(aiRoutes, { prefix: '/ai' })
  app.register(autopilotRoutes, { prefix: '/autopilot' })
  app.register(campaignRoutes, { prefix: '/campaign' })

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
    
    // Start background services
    schedulerService.start()
    autopilotService.start()
    
    app.log.info('Background services started')
  })
}