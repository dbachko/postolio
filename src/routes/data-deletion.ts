import { FastifyInstance } from 'fastify'
import { prisma } from '../config/database.js'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { verifyJWT } from '../services/jwt.js'
import { markdownToHtml } from '../utils/markdown.js'

interface DeletionRequest {
  email: string
  userId?: string
  reason?: string
  source: 'user' | 'meta' | 'legal'
  verificationToken?: string
}

interface MetaDeletionCallback {
  signed_request: string
}

interface DeletionSurvey {
  reason: 'not_using' | 'too_expensive' | 'missing_features' | 'privacy_concerns' | 'switching_service' | 'other'
  feedback?: string
}

// Deletion reasons for survey
const DELETION_REASONS = {
  not_using: "I'm not using the service anymore",
  too_expensive: "It's too expensive",
  missing_features: "It's missing features I need",
  privacy_concerns: "I have privacy concerns",
  switching_service: "I'm switching to another service",
  other: "Other reason"
}

export default async function dataDeletionRoutes(fastify: FastifyInstance) {
  
  // Public data deletion page content
  fastify.get('/data-deletion', async (request, reply) => {
    try {
      // Read the data deletion instructions
      const fs = await import('fs')
      const path = await import('path')
      const { fileURLToPath } = await import('url')
      
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = path.dirname(__filename)
      const deletionPath = path.join(__dirname, '..', '..', 'DATA_DELETION.md')
      
      let content = fs.readFileSync(deletionPath, 'utf8')
      
      // Make copyright year dynamic
      const currentYear = new Date().getFullYear()
      content = content.replace(/© \d{4} Postolio/, `© ${currentYear} Postolio`)
      
      // Check if client accepts HTML
      const acceptsHtml = request.headers.accept?.includes('text/html')
      
      if (acceptsHtml) {
        // Return HTML version
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Deletion - Postolio</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2563eb;
            border-bottom: 3px solid #2563eb;
            padding-bottom: 10px;
        }
        h2 {
            color: #1e40af;
            margin-top: 30px;
            margin-bottom: 15px;
        }
        h3 {
            color: #1e3a8a;
            margin-top: 25px;
            margin-bottom: 10px;
        }
        ul, ol {
            margin: 10px 0 10px 20px;
        }
        li {
            margin-bottom: 5px;
        }
        strong {
            color: #1f2937;
        }
        .warning {
            background: #fef2f2;
            border-left: 4px solid #ef4444;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        .info {
            background: #e0f2fe;
            border-left: 4px solid #2563eb;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
        .button {
            display: inline-block;
            background: #2563eb;
            color: white;
            text-decoration: none;
            padding: 12px 24px;
            border-radius: 6px;
            margin: 10px 0;
            transition: background-color 0.2s;
        }
        .button:hover {
            background: #1e40af;
        }
        .back-link {
            display: inline-block;
            color: #2563eb;
            text-decoration: none;
            margin-bottom: 20px;
            transition: color 0.2s;
        }
        .back-link:hover {
            color: #1e40af;
        }
        @media (max-width: 600px) {
            body {
                padding: 10px;
            }
            .container {
                padding: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-link">← Back to Postolio</a>
        ${markdownToHtml(content)}
        <div class="info">
            <h3>Need Help?</h3>
            <p>If you need assistance with deleting your data, please contact us at 
            <a href="mailto:privacy@postolio.example">privacy@postolio.example</a></p>
        </div>
    </div>
</body>
</html>
        `
        
        reply.type('text/html').send(htmlContent)
      } else {
        // Return markdown content
        reply.type('text/plain').send(content)
      }
    } catch (error) {
      fastify.log.error('Error serving data deletion page:', error)
      reply.code(500).send({ error: 'Failed to load data deletion instructions' })
    }
  })
  
  // Public deletion request endpoint (for unauthenticated users)
  fastify.post('/data-deletion-request', async (request, reply) => {
    const body = request.body as DeletionRequest
    
    // Input validation
    if (!body.email || typeof body.email !== 'string') {
      return reply.code(400).send({ error: 'Valid email address is required' })
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return reply.code(400).send({ error: 'Invalid email format' })
    }
    
    // Validate reason if provided
    if (body.reason && !Object.keys(DELETION_REASONS).includes(body.reason)) {
      return reply.code(400).send({ error: 'Invalid deletion reason' })
    }
    
    try {
      const user = await prisma.user.findUnique({
        where: { email: body.email }
      })
      
      if (!user) {
        return reply.code(404).send({ 
          error: 'No account found with this email address' 
        })
      }
      
      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString('hex')
      
      // TODO: Store verification token in Redis with 24-hour expiration
      // Example: await redis.setex(`deletion-token:${user.id}`, 86400, verificationToken)
      
      // TODO: Implement email sending service
      // Should send email with verification link containing the token
      // Example: await emailService.sendDeletionVerification(user.email, verificationToken)
      
      return reply.send({
        success: true,
        message: 'Verification email sent. Please check your inbox.'
      })
    } catch (error) {
      fastify.log.error('Data deletion request error:', error)
      reply.code(500).send({ error: 'Failed to process deletion request' })
    }
  })
  
  // Authenticated user account deletion
  fastify.delete('/account', async (request, reply) => {
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Authentication required' })
    }
    
    const token = authHeader.substring(7)
    
    try {
      const decoded = verifyJWT(token)
      const userId = decoded.id
      
      // Get deletion survey from body
      const { reason, feedback } = request.body as DeletionSurvey
      
      // Calculate scheduled deletion date (30 days from now)
      const deletedAt = new Date()
      const scheduledDeletion = new Date()
      scheduledDeletion.setDate(scheduledDeletion.getDate() + 30)
      
      // Soft delete the user account
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt,
          deletionReason: reason ? `${DELETION_REASONS[reason]}${feedback ? `: ${feedback}` : ''}` : null,
          scheduledDeletion,
          // Clear sensitive tokens but keep password for recovery
          instagramToken: null
          // Password is kept intact to allow account recovery
        }
      })
      
      // TODO: Implement scheduled deletion job for GDPR compliance
      // This should run daily to permanently delete accounts past their 30-day recovery period
      // Example: await scheduleJob('permanent-deletion', { userId: user.id, scheduledFor: scheduledDeletion })
      
      // TODO: Send deletion confirmation email
      // Example: await emailService.sendDeletionConfirmation(user.email, scheduledDeletion)
      
      return reply.send({
        success: true,
        message: 'Account scheduled for deletion',
        recoveryDeadline: scheduledDeletion.toISOString()
      })
    } catch (error) {
      fastify.log.error('Account deletion error:', error)
      reply.code(500).send({ error: 'Failed to delete account' })
    }
  })
  
  // Account recovery endpoint (within 30 days)
  fastify.post('/account-recovery', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string }
    
    try {
      const user = await prisma.user.findUnique({
        where: { email }
      })
      
      if (!user || !user.deletedAt) {
        return reply.code(404).send({ error: 'No deleted account found' })
      }
      
      // Check if within 30-day recovery period
      const now = new Date()
      if (user.scheduledDeletion && now > user.scheduledDeletion) {
        return reply.code(410).send({ 
          error: 'Recovery period has expired. Account has been permanently deleted.' 
        })
      }
      
      // Verify password before allowing account recovery
      const passwordHash = user.password
      if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) {
        return reply.code(401).send({ error: 'Invalid password' })
      }
      
      // Recover the account
      await prisma.user.update({
        where: { id: user.id },
        data: {
          deletedAt: null,
          deletionReason: null,
          scheduledDeletion: null
        }
      })
      
      return reply.send({
        success: true,
        message: 'Account successfully recovered'
      })
    } catch (error) {
      fastify.log.error('Account recovery error:', error)
      reply.code(500).send({ error: 'Failed to recover account' })
    }
  })
  
  // Meta/Instagram deletion callback
  fastify.post('/meta-deletion-callback', async (request, reply) => {
    const body = request.body as MetaDeletionCallback
    
    try {
      // Parse and verify the signed request from Meta
      const requestParts = body.signed_request.split('.')
      if (requestParts.length !== 2) {
        return reply.code(400).send({ error: 'Invalid signed request format' })
      }
      
      const encodedSig = requestParts[0]!
      const payload = requestParts[1]!
      
      // Verify signature
      if (!process.env.FACEBOOK_APP_SECRET) {
        fastify.log.error('FACEBOOK_APP_SECRET not configured')
        return reply.code(400).send({ error: 'Invalid request' })
      }
      
      const expectedSig = crypto
        .createHmac('sha256', process.env.FACEBOOK_APP_SECRET)
        .update(payload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
      
      if (expectedSig !== encodedSig) {
        fastify.log.warn('Invalid Meta signature received', { expectedSig, receivedSig: encodedSig })
        return reply.code(401).send({ error: 'Invalid signature' })
      }
      
      // Decode payload
      const data = JSON.parse(Buffer.from(payload, 'base64').toString())
      
      // Find user by Instagram ID
      if (data.user_id) {
        const user = await prisma.user.findFirst({
          where: { instagramId: data.user_id }
        })
        
        if (user) {
          // Mark for deletion
          const deletedAt = new Date()
          const scheduledDeletion = new Date()
          scheduledDeletion.setDate(scheduledDeletion.getDate() + 30)
          
          await prisma.user.update({
            where: { id: user.id },
            data: {
              deletedAt,
              deletionReason: 'Instagram data deletion request',
              scheduledDeletion,
              instagramToken: null,
              instagramId: null,
              instagramUsername: null
            }
          })
        }
      }
      
      // Return confirmation URL as required by Meta
      const confirmationUrl = `${process.env.APP_URL || 'https://postolio.example'}/legal/data-deletion-confirmation?id=${data.user_id}`
      
      return reply.send({
        url: confirmationUrl,
        confirmation_code: crypto.randomBytes(16).toString('hex')
      })
    } catch (error) {
      fastify.log.error('Meta deletion callback error:', error)
      reply.code(500).send({ error: 'Failed to process Meta deletion request' })
    }
  })
  
  // Get deletion reasons (for frontend survey)
  fastify.get('/deletion-reasons', async (request, reply) => {
    return reply.send({
      reasons: Object.entries(DELETION_REASONS).map(([key, value]) => ({
        id: key,
        label: value
      }))
    })
  })
}