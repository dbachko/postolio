import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import * as aws from '@aws-sdk/credential-provider-node'
import CircuitBreaker from 'opossum'

/**
 * Centralized email service with AWS SES for production
 * Falls back to SMTP for development
 */
export class EmailService {
  private static transporter: Transporter | null = null
  private static sesClient: SESClient | null = null
  private static useAWSSES: boolean = process.env.USE_AWS_SES === 'true' || process.env.NODE_ENV === 'production'
  private static sesCircuitBreaker: CircuitBreaker | null = null
  private static smtpCircuitBreaker: CircuitBreaker | null = null

  /**
   * Initialize AWS SES circuit breaker
   */
  private static getSESCircuitBreaker(): CircuitBreaker {
    if (!this.sesCircuitBreaker) {
      const sesAction = async (command: SendEmailCommand) => {
        const client = this.getSESClient()
        return await client.send(command)
      }

      this.sesCircuitBreaker = new CircuitBreaker(sesAction, {
        timeout: 30000, // 30 seconds
        errorThresholdPercentage: 50,
        resetTimeout: 60000, // 1 minute
        name: 'AWS-SES',
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10
      })

      // Event listeners for monitoring
      this.sesCircuitBreaker.on('open', () => {
        console.warn('⚠️ AWS SES circuit breaker opened - falling back to SMTP')
      })

      this.sesCircuitBreaker.on('halfOpen', () => {
        console.info('🔄 AWS SES circuit breaker half-open - testing service')
      })

      this.sesCircuitBreaker.on('close', () => {
        console.info('✅ AWS SES circuit breaker closed - service restored')
      })

      this.sesCircuitBreaker.on('fallback', () => {
        console.warn('🔄 AWS SES fallback triggered')
      })
    }
    return this.sesCircuitBreaker
  }

  /**
   * Initialize SMTP circuit breaker
   */
  private static getSMTPCircuitBreaker(): CircuitBreaker {
    if (!this.smtpCircuitBreaker) {
      const smtpAction = async (mailOptions: Mail.Options) => {
        const transporter = this.getTransporter()
        return await transporter.sendMail(mailOptions)
      }

      this.smtpCircuitBreaker = new CircuitBreaker(smtpAction, {
        timeout: 30000, // 30 seconds
        errorThresholdPercentage: 50,
        resetTimeout: 60000, // 1 minute
        name: 'SMTP',
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10
      })

      // Event listeners for monitoring
      this.smtpCircuitBreaker.on('open', () => {
        console.error('❌ SMTP circuit breaker opened - email service unavailable')
      })

      this.smtpCircuitBreaker.on('close', () => {
        console.info('✅ SMTP circuit breaker closed - email service restored')
      })
    }
    return this.smtpCircuitBreaker
  }

  /**
   * Initialize AWS SES client
   */
  private static getSESClient(): SESClient {
    if (!this.sesClient) {
      const config: any = {
        region: process.env.AWS_REGION || 'us-east-1',
      }
      
      // Only add credentials if they exist
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        config.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      }
      
      this.sesClient = new SESClient(config)
    }
    return this.sesClient
  }

  /**
   * Initialize the email transporter for SMTP (fallback)
   */
  private static getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    }
    return this.transporter
  }

  /**
   * Check if email service is properly configured
   */
  static isConfigured(): boolean {
    if (this.useAWSSES) {
      // SES just needs AWS region (credentials come from IAM role in production)
      return !!(process.env.AWS_REGION || process.env.NODE_ENV === 'production')
    }
    // SMTP needs explicit configuration
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  }

  /**
   * Send email via AWS SES with circuit breaker
   */
  private static async sendViaSES(options: Mail.Options): Promise<void> {
    // Convert nodemailer options to SES format
    const from = typeof options.from === 'string' 
      ? options.from 
      : options.from?.address || process.env.SES_FROM_EMAIL || 'noreply@postolio.example'
    
    const to = Array.isArray(options.to) 
      ? options.to.map(addr => typeof addr === 'string' ? addr : addr.address)
      : [typeof options.to === 'string' ? options.to : options.to?.address]
    
    const command = new SendEmailCommand({
      Source: from,
      Destination: {
        ToAddresses: to.filter(Boolean) as string[],
      },
      Message: {
        Subject: {
          Data: options.subject || 'Postolio Notification',
          Charset: 'UTF-8',
        },
        Body: {
          Html: options.html ? {
            Data: typeof options.html === 'string' ? options.html : '',
            Charset: 'UTF-8',
          } : undefined,
          Text: options.text ? {
            Data: typeof options.text === 'string' ? options.text : '',
            Charset: 'UTF-8',
          } : undefined,
        },
      },
    })
    
    // Use circuit breaker for SES calls
    const sesCircuitBreaker = this.getSESCircuitBreaker()
    
    // Set up fallback to SMTP if SES fails
    sesCircuitBreaker.fallback(async () => {
      console.warn('SES circuit breaker triggered, falling back to SMTP')
      if (this.isConfigured()) {
        return await this.sendViaSMTP(options)
      }
      throw new Error('Both SES and SMTP are unavailable')
    })
    
    await sesCircuitBreaker.fire(command)
  }

  /**
   * Send email via SMTP with circuit breaker
   */
  private static async sendViaSMTP(options: Mail.Options): Promise<any> {
    const smtpCircuitBreaker = this.getSMTPCircuitBreaker()
    return await smtpCircuitBreaker.fire(options)
  }

  /**
   * Send an email with the specified options
   */
  static async sendEmail(options: Mail.Options): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isConfigured()) {
        console.warn('Email service not configured')
        return { success: false, error: 'Email service not configured' }
      }

      // Set default from address if not provided
      if (!options.from) {
        options.from = this.useAWSSES 
          ? (process.env.SES_FROM_EMAIL || 'noreply@postolio.example')
          : (process.env.SMTP_FROM || '"Postolio" <noreply@postolio.example>')
      }

      // Use AWS SES in production, SMTP in development
      if (this.useAWSSES) {
        await this.sendViaSES(options)
      } else {
        await this.sendViaSMTP(options)
      }
      
      return { success: true }
    } catch (error) {
      console.error('Email send error:', error)
      
      // Provide more specific error messages for SES
      if (error instanceof Error && error.name === 'MessageRejected') {
        return { 
          success: false, 
          error: 'Email address not verified in AWS SES. Please verify sender email.' 
        }
      }
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Failed to send email' 
      }
    }
  }

  /**
   * Generate a standard email template
   */
  static generateEmailTemplate(params: {
    title: string
    greeting?: string
    content: string
    buttonText?: string
    buttonUrl?: string
    warning?: string
    footer?: string
  }): { html: string; text: string } {
    const currentYear = new Date().getFullYear()
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; padding: 20px 0; }
          .button { 
            display: inline-block; 
            padding: 14px 30px; 
            background: #3b82f6; 
            color: white !important; 
            text-decoration: none; 
            border-radius: 6px;
            font-weight: 500;
          }
          .footer { 
            margin-top: 40px; 
            padding-top: 20px; 
            border-top: 1px solid #e5e7eb;
            color: #6b7280;
            font-size: 14px;
          }
          .warning { 
            background: #fef3c7; 
            border: 1px solid #fcd34d;
            padding: 12px;
            border-radius: 6px;
            margin: 20px 0;
          }
          .code-block {
            background: #f3f4f6;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 16px;
            font-family: monospace;
            word-break: break-all;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${params.title}</h1>
          </div>
          
          ${params.greeting ? `<p>${params.greeting}</p>` : ''}
          
          <div>${params.content}</div>
          
          ${params.buttonText && params.buttonUrl ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${params.buttonUrl}" class="button">${params.buttonText}</a>
            </div>
            
            <p>Or copy and paste this link into your browser:</p>
            <div class="code-block">${params.buttonUrl}</div>
          ` : ''}
          
          ${params.warning ? `
            <div class="warning">
              ${params.warning}
            </div>
          ` : ''}
          
          <div class="footer">
            ${params.footer || `
              <p>If you didn't request this email, you can safely ignore it.</p>
              <p>© ${currentYear} Postolio. All rights reserved.</p>
            `}
          </div>
        </div>
      </body>
      </html>
    `

    const text = `
${params.title}

${params.greeting || ''}

${params.content.replace(/<[^>]*>/g, '')}

${params.buttonText && params.buttonUrl ? `
${params.buttonText}: ${params.buttonUrl}
` : ''}

${params.warning ? params.warning.replace(/<[^>]*>/g, '') : ''}

${params.footer ? params.footer.replace(/<[^>]*>/g, '') : `
If you didn't request this email, you can safely ignore it.

© ${currentYear} Postolio. All rights reserved.
`}
    `.trim()

    return { html, text }
  }

  /**
   * Send a magic link email
   */
  static async sendMagicLink(email: string, token: string, isSignUp = false): Promise<{ success: boolean; error?: string }> {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const magicLinkUrl = `${baseUrl}/auth/magic-link?token=${token}`
    
    const { html, text } = this.generateEmailTemplate({
      title: 'Welcome to Postolio',
      greeting: 'Hi there,',
      content: isSignUp 
        ? "You're almost done! Click the button below to complete your registration:"
        : "Click the button below to securely sign in to your account:",
      buttonText: isSignUp ? 'Complete Registration' : 'Sign In',
      buttonUrl: magicLinkUrl,
      warning: '<strong>⏱ This link expires in 15 minutes</strong><br>For security reasons, this magic link can only be used once.'
    })

    return this.sendEmail({
      to: email,
      subject: isSignUp ? 'Complete your Postolio registration' : 'Sign in to Postolio',
      html,
      text
    })
  }

  /**
   * Send an email verification link
   */
  static async sendVerificationEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const verificationUrl = `${baseUrl}/verify-email?token=${token}`
    
    const { html, text } = this.generateEmailTemplate({
      title: 'Verify Your Email',
      greeting: 'Hi there,',
      content: 'Please verify your email address to unlock all features of your Postolio account.',
      buttonText: 'Verify Email Address',
      buttonUrl: verificationUrl,
      warning: '<strong>This verification link expires in 24 hours</strong><br>You can request a new verification email from your account settings.'
    })

    return this.sendEmail({
      to: email,
      subject: 'Verify your Postolio email address',
      html,
      text
    })
  }

  /**
   * Send a password reset email
   */
  static async sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const resetUrl = `${baseUrl}/reset-password?token=${token}`
    
    const { html, text } = this.generateEmailTemplate({
      title: 'Reset Your Password',
      greeting: 'Hi there,',
      content: 'We received a request to reset your password. Click the button below to set a new password:',
      buttonText: 'Reset Password',
      buttonUrl: resetUrl,
      warning: '<strong>This link expires in 1 hour</strong><br>If you didn\'t request a password reset, please ignore this email and your password will remain unchanged.'
    })

    return this.sendEmail({
      to: email,
      subject: 'Reset your Postolio password',
      html,
      text
    })
  }

  /**
   * Send two-factor authentication code (async via queue)
   */
  static async sendTwoFactorCode(email: string, code: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { emailQueue } = await import('./email-queue.js')
      await emailQueue.addTwoFactorEmail(email, code, { priority: 'critical' })
      return { success: true }
    } catch (error) {
      console.error('Failed to queue 2FA email:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Send two-factor authentication code (immediate)
   */
  static async sendTwoFactorCodeImmediate(email: string, code: string): Promise<{ success: boolean; error?: string }> {
    const { html, text } = this.generateEmailTemplate({
      title: 'Two-Factor Authentication Code',
      content: `
        <p>Your verification code for Postolio is:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 6px;">
          ${code}
        </div>
        <p>This code will expire in 5 minutes.</p>
      `,
      warning: 'If you didn\'t request this code, please secure your account immediately.'
    })

    return this.sendEmail({
      to: email,
      subject: 'Your Postolio Verification Code',
      html,
      text
    })
  }

  /**
   * Send a welcome email to new users (async via queue)
   */
  static async sendWelcomeEmail(email: string, name?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { emailQueue } = await import('./email-queue.js')
      await emailQueue.addWelcomeEmail(email, name)
      return { success: true }
    } catch (error) {
      console.error('Failed to queue welcome email:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  }

  /**
   * Send a welcome email to new users (immediate)
   */
  static async sendWelcomeEmailImmediate(email: string, name?: string): Promise<{ success: boolean; error?: string }> {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    
    const { html, text } = this.generateEmailTemplate({
      title: 'Welcome to Postolio! 🎉',
      greeting: `Hi${name ? ' ' + name : ''},`,
      content: `
        <p>Welcome to Postolio - your AI-powered Instagram content management platform!</p>
        
        <p>Here's what you can do with Postolio:</p>
        <ul>
          <li>🤖 Generate AI-powered content that matches your brand</li>
          <li>📅 Schedule posts for optimal engagement</li>
          <li>📊 Track analytics and grow your audience</li>
          <li>🚀 Run automated campaigns with Autopilot</li>
        </ul>
        
        <p>Ready to get started? Create your first brand and let's grow your Instagram presence together!</p>
      `,
      buttonText: 'Go to Dashboard',
      buttonUrl: `${baseUrl}/dashboard`
    })

    return this.sendEmail({
      to: email,
      subject: 'Welcome to Postolio! 🎉',
      html,
      text
    })
  }

  /**
   * Verify email service connection
   */
  static async verifyConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        return false
      }

      if (this.useAWSSES) {
        // Test SES by checking identity verification status
        const ses = this.getSESClient()
        const { $metadata } = await ses.send(new SendEmailCommand({
          Source: process.env.SES_FROM_EMAIL || 'noreply@postolio.example',
          Destination: { ToAddresses: ['test@example.com'] },
          Message: {
            Subject: { Data: 'Test' },
            Body: { Text: { Data: 'Test' } }
          }
        })).catch(err => ({ $metadata: { httpStatusCode: err.$metadata?.httpStatusCode || 0 } }))
        
        // If we get a 400 error, it means SES is configured but email not verified
        // If we get 200 or 400, SES is working
        return $metadata.httpStatusCode === 200 || $metadata.httpStatusCode === 400
      } else {
        // Verify SMTP connection
        const transporter = this.getTransporter()
        await transporter.verify()
        return true
      }
    } catch (error) {
      console.error('Email service verification failed:', error)
      return false
    }
  }
}