import './dotenv-init.js'
import fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
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
import campaignTemplatesRoutes from './routes/campaign-templates.js'
import campaignAnalyticsRoutes from './routes/campaign-analytics.js'
import rollingContentRoutes from './routes/rolling-content.js'
import legalRoutes from './routes/legal.js'
import userRoutes from './routes/user.js'
import dataDeletionRoutes from './routes/data-deletion.js'
import { complianceRoutes } from './routes/compliance.js'
import postDetailRoutes from './routes/post-detail.js'
import { autopilotService } from './services/autopilot.js'
import { schedulerService } from './services/scheduler.js'
import { ensureDatabaseSchema } from './config/database-setup.js'
import { getRetentionManager } from './services/retention-manager.js'

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
            key: fs.readFileSync(keyPath),
          },
        }
      }
    } catch (error) {
      console.log('No SSL certificates found, running on HTTP')
    }
  }

  const app = fastify({
    logger: {
      level: 'info',
    },
    bodyLimit: 10 * 1024 * 1024, // 10MB limit - industry standard for social media management tools
    ...httpsOptions,
  })

  // Register plugins
  // CORS configuration for same-origin setup
  const corsOrigins = [
    // Local development origins
    'http://ai.localhost:5173',
    'https://ai.localhost:5173',
    'https://ai.localhost',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    // Production same-domain origin (postolio.example)
    'https://postolio.example',
  ]

  // Add CloudFront domain for backward compatibility
  if (process.env.CORS_ORIGIN) {
    corsOrigins.push(`https://${process.env.CORS_ORIGIN}`)
  }

  app.register(cors, {
    origin: corsOrigins,
    credentials: true,
  })
  app.register(cookie, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET || 'default-secret-change-in-production',
    parseOptions: {}
  })
  app.register(helmet)
  app.register(monitoringPlugin)
  app.register(authPlugin)

  // Register routes WITH /api prefix - CloudFront forwards full paths to backend
  app.register(monitoringRoutes, { prefix: '/api/monitoring' })
  app.register(authRoutes, { prefix: '/api/auth' })
  app.register(userRoutes) // User routes include their own /api prefix
  app.register(instagramOAuthRoutes, { prefix: '/api/auth/instagram' })
  app.register(brandsRoutes, { prefix: '/api/brands' })
  app.register(contentRoutes, { prefix: '/api/content' })
  app.register(instagramRoutes, { prefix: '/api/instagram' })
  app.register(analyticsRoutes, { prefix: '/api/analytics' })
  app.register(instagramAnalyticsRoutes, { prefix: '/api/instagram-analytics' })
  app.register(engagementRoutes, { prefix: '/api/engagement' })
  app.register(growthRoutes, { prefix: '/api/growth' })
  app.register(aiRoutes, { prefix: '/api/ai' })
  app.register(autopilotRoutes, { prefix: '/api/autopilot' })
  app.register(campaignRoutes, { prefix: '/api/campaign' })
  app.register(campaignTemplatesRoutes, { prefix: '/api/templates' })
  app.register(campaignAnalyticsRoutes, { prefix: '/api/' }) // API root level for campaign analytics
  app.register(rollingContentRoutes, { prefix: '/api/rolling-content' })
  app.register(legalRoutes, { prefix: '/api/legal' })
  app.register(dataDeletionRoutes, { prefix: '/api/legal' })
  app.register(complianceRoutes)
  app.register(postDetailRoutes) // Post detail routes don't need prefix, they include /api

  // Health check endpoint for both load balancer health checks and API requests
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  return app
}

// Start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildFastify()

  // Graceful shutdown handling
  const signals = ['SIGTERM', 'SIGINT']
  signals.forEach(signal => {
    process.on(signal, async () => {
      app.log.warn(`Received ${signal}, starting graceful shutdown...`)
      try {
        // Background services now managed by EventBridge
        // No need to stop services here
        
        // Close server
        await app.close()
        app.log.info('Server closed successfully')
        process.exit(0)
      } catch (error) {
        app.log.error('Error during shutdown:', error)
        process.exit(1)
      }
    })
  })

  app.listen({ port: 3000, host: '0.0.0.0' }, async (err, address) => {
    if (err) {
      app.log.error(err)
      process.exit(1)
    }
    app.log.info(`Server listening at ${address}`)

    // Ensure database schema is ready before starting background services
    try {
      app.log.info('🚀 Initializing database schema...')
      await ensureDatabaseSchema()
      
      // Background services now managed by EventBridge
      // Services are triggered by AWS Lambda/EventBridge, not started here
      
      // Initialize retention manager
      const retentionManager = getRetentionManager(app)
      await retentionManager.initialize()

      app.log.info('✅ Database initialized and background services started')
    } catch (dbError) {
      app.log.error('❌ Failed to initialize database:', dbError)
      app.log.info('⚠️  Server running but background services disabled until database is ready')
    }
  })
}
