import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type Mail from 'nodemailer/lib/mailer'

/**
 * Centralized email service to handle all email sending
 * Eliminates duplication and provides consistent email handling
 */
export class EmailService {
  private static transporter: Transporter | null = null

  /**
   * Initialize the email transporter (singleton pattern)
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
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
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

      const transporter = this.getTransporter()
      
      // Set default from address if not provided
      if (!options.from) {
        options.from = process.env.SMTP_FROM || '"Postolio" <noreply@postolio.example>'
      }

      await transporter.sendMail(options)
      
      return { success: true }
    } catch (error) {
      console.error('Email send error:', error)
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
   * Send a welcome email to new users
   */
  static async sendWelcomeEmail(email: string, name?: string): Promise<{ success: boolean; error?: string }> {
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
   * Verify SMTP connection
   */
  static async verifyConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        return false
      }

      const transporter = this.getTransporter()
      await transporter.verify()
      return true
    } catch (error) {
      console.error('SMTP verification failed:', error)
      return false
    }
  }
}