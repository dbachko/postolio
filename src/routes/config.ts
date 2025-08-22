import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export default async function configRoutes(fastify: FastifyInstance) {
  // Get WebSocket configuration for frontend
  fastify.get('/api/config/websocket', async (_request: FastifyRequest, reply: FastifyReply) => {
    const albDomain = process.env.ALB_DOMAIN
    const nodeEnv = process.env.NODE_ENV || 'development'
    
    // In production, we need to connect directly to ALB since CloudFront doesn't support WebSocket
    // GitHub uses the same approach - main domain with /ws path, but direct connection
    let wsUrl: string
    
    if (nodeEnv === 'production' && albDomain) {
      // Use direct ALB connection for WebSocket in production
      // This bypasses CloudFront entirely for WebSocket traffic
      wsUrl = `wss://${albDomain}/ws`
      
      // Note: In future, if we get a proper SSL cert for ALB, we could use:
      // wsUrl = `wss://postolio.example:443/ws` (if ALB is exposed on a different port)
      // Or implement a WebSocket-specific subdomain like postolio.example
    } else {
      // In development or if ALB_DOMAIN not set, use relative path
      wsUrl = '' // Empty means use same origin (Vite proxy handles it)
    }
    
    return reply.send({
      wsUrl,
      useRelative: !wsUrl, // If wsUrl is empty, frontend should use relative path
      environment: nodeEnv,
      // Include additional info for debugging
      albDomain: nodeEnv === 'production' ? albDomain : undefined
    })
  })
}