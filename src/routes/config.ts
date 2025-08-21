import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get('/api/config/websocket', async (_request: FastifyRequest, reply: FastifyReply) => {
    const albDomain = process.env.ALB_DOMAIN
    const nodeEnv = process.env.NODE_ENV || 'development'
    
    // In production, use ALB domain for WebSocket connections to bypass CloudFront
    // In development, use same origin (Vite proxy will handle it)
    let wsUrl: string
    
    if (nodeEnv === 'production' && albDomain) {
      // Use direct ALB connection for WebSocket in production
      wsUrl = `wss://${albDomain}/ws`
    } else {
      // In development or if ALB_DOMAIN not set, use relative path
      wsUrl = '' // Empty means use same origin
    }
    
    return reply.send({
      wsUrl,
      useRelative: !wsUrl, // If wsUrl is empty, frontend should use relative path
      environment: nodeEnv
    })
  })
}