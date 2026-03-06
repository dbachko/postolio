import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import { logger as baseLogger } from '@postolio/logger';
import { SESClient, SendEmailCommand, type SESClientConfig } from '@aws-sdk/client-ses';
import CircuitBreaker from 'opossum';
import { generateEmailTemplate, type EmailTemplateParams } from './email/template.js';
import {
  sendDataDeletionVerificationEmail as sendDataDeletionVerificationEmailTransactional,
  sendDeletionConfirmationEmail as sendDeletionConfirmationTransactional,
  sendMagicLinkEmail as sendMagicLinkTransactional,
  sendPasswordResetEmail as sendPasswordResetEmailTransactional,
  sendTwoFactorCodeImmediate as sendTwoFactorCodeImmediateTransactional,
  sendVerificationEmail as sendVerificationEmailTransactional,
  sendWelcomeEmailImmediate as sendWelcomeEmailImmediateTransactional,
} from './email/transactional.js';
import { formatError } from '../utils/logging.js';

const emailLogger = baseLogger.child({ module: 'email-service' });

/**
 * Centralized email service with AWS SES for production
 * Falls back to SMTP for development
 */
export class EmailService {
  private static transporter: Transporter | null = null;
  private static sesClient: SESClient | null = null;
  private static useAWSSES: boolean =
    process.env.USE_AWS_SES === 'true' || process.env.NODE_ENV === 'prod';
  private static sesCircuitBreaker: CircuitBreaker | null = null;
  private static smtpCircuitBreaker: CircuitBreaker | null = null;

  /**
   * Initialize AWS SES circuit breaker
   */
  private static getSESCircuitBreaker(): CircuitBreaker {
    if (!this.sesCircuitBreaker) {
      const sesAction = async (command: SendEmailCommand) => {
        const client = this.getSESClient();
        return await client.send(command);
      };

      this.sesCircuitBreaker = new CircuitBreaker(sesAction, {
        timeout: 30000, // 30 seconds
        errorThresholdPercentage: 50,
        resetTimeout: 60000, // 1 minute
        name: 'AWS-SES',
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
      });

      // Event listeners for monitoring
      this.sesCircuitBreaker.on('open', () => {
        emailLogger.warn('⚠️ AWS SES circuit breaker opened - falling back to SMTP');
      });

      this.sesCircuitBreaker.on('halfOpen', () => {
        emailLogger.info('🔄 AWS SES circuit breaker half-open - testing service');
      });

      this.sesCircuitBreaker.on('close', () => {
        emailLogger.info('✅ AWS SES circuit breaker closed - service restored');
      });

      this.sesCircuitBreaker.on('fallback', () => {
        emailLogger.warn('🔄 AWS SES fallback triggered');
      });
    }
    return this.sesCircuitBreaker;
  }

  /**
   * Initialize SMTP circuit breaker
   */
  private static getSMTPCircuitBreaker(): CircuitBreaker {
    if (!this.smtpCircuitBreaker) {
      const smtpAction = async (mailOptions: Mail.Options) => {
        const transporter = this.getTransporter();
        return await transporter.sendMail(mailOptions);
      };

      this.smtpCircuitBreaker = new CircuitBreaker(smtpAction, {
        timeout: 30000, // 30 seconds
        errorThresholdPercentage: 50,
        resetTimeout: 60000, // 1 minute
        name: 'SMTP',
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
      });

      // Event listeners for monitoring
      this.smtpCircuitBreaker.on('open', () => {
        emailLogger.error('❌ SMTP circuit breaker opened - email service unavailable');
      });

      this.smtpCircuitBreaker.on('close', () => {
        emailLogger.info('✅ SMTP circuit breaker closed - email service restored');
      });
    }
    return this.smtpCircuitBreaker;
  }

  /**
   * Initialize AWS SES client
   */
  private static getSESClient(): SESClient {
    if (!this.sesClient) {
      const config: SESClientConfig = {
        region: process.env.AWS_REGION || 'us-east-1',
      };

      // Only add credentials if they exist
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        config.credentials = {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        };
      }

      this.sesClient = new SESClient(config);
    }
    return this.sesClient;
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
      });
    }
    return this.transporter;
  }

  /**
   * Check if email service is properly configured
   */
  static isConfigured(): boolean {
    if (this.useAWSSES) {
      // SES just needs AWS region (credentials come from IAM role in production)
      return !!(process.env.AWS_REGION || process.env.NODE_ENV === 'prod');
    }
    // SMTP needs explicit configuration
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  /**
   * Send email via AWS SES with circuit breaker
   */
  private static resolveFromAddress(options: Mail.Options): string {
    if (typeof options.from === 'string') {
      return options.from;
    }
    if (Array.isArray(options.from)) {
      const address = options.from
        .map((value) => this.resolveRecipientAddress(value))
        .find((value): value is string => Boolean(value));
      return address || process.env.SES_FROM_EMAIL || 'noreply@postolio.example';
    }
    return options.from?.address || process.env.SES_FROM_EMAIL || 'noreply@postolio.example';
  }

  private static resolveRecipientAddress(
    value: Mail.Address | string | undefined
  ): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return value.address;
  }

  private static resolveToAddresses(options: Mail.Options): string[] {
    if (Array.isArray(options.to)) {
      return options.to
        .map((value) => this.resolveRecipientAddress(value))
        .filter((value): value is string => Boolean(value));
    }
    const address = this.resolveRecipientAddress(options.to);
    return address ? [address] : [];
  }

  private static toSesBodyPart(
    value: Mail.Options['html'] | Mail.Options['text']
  ): { Data: string; Charset: 'UTF-8' } | undefined {
    if (!value) {
      return undefined;
    }
    return {
      Data: typeof value === 'string' ? value : '',
      Charset: 'UTF-8',
    };
  }

  private static buildSesCommand(
    options: Mail.Options,
    from: string,
    to: string[]
  ): SendEmailCommand {
    return new SendEmailCommand({
      Source: from,
      Destination: {
        ToAddresses: to,
      },
      Message: {
        Subject: {
          Data: options.subject || 'Postolio Notification',
          Charset: 'UTF-8',
        },
        Body: {
          Html: this.toSesBodyPart(options.html),
          Text: this.toSesBodyPart(options.text),
        },
      },
    });
  }

  private static async sendViaSES(options: Mail.Options): Promise<void> {
    const from = this.resolveFromAddress(options);
    const to = this.resolveToAddresses(options);

    emailLogger.info(`Sending email via SES from ${from} to ${to.join(', ')}`);

    const command = this.buildSesCommand(options, from, to);

    // Use circuit breaker for SES calls
    const sesCircuitBreaker = this.getSESCircuitBreaker();

    // Set up fallback to SMTP if SES fails
    sesCircuitBreaker.fallback(async () => {
      emailLogger.warn('SES circuit breaker triggered, falling back to SMTP');
      if (this.isConfigured()) {
        return await this.sendViaSMTP(options);
      }
      throw new Error('Both SES and SMTP are unavailable');
    });

    try {
      const result = (await sesCircuitBreaker.fire(command)) as {
        MessageId?: string;
        $metadata?: { httpStatusCode?: number };
      };
      emailLogger.info('Email sent successfully via SES', {
        messageId: result?.MessageId,
        statusCode: result?.$metadata?.httpStatusCode,
      });
    } catch (error) {
      emailLogger.error('Failed to send email via SES', formatError(error));
      throw error;
    }
  }

  /**
   * Send email via SMTP with circuit breaker
   */
  private static async sendViaSMTP(options: Mail.Options): Promise<unknown> {
    const smtpCircuitBreaker = this.getSMTPCircuitBreaker();
    return await smtpCircuitBreaker.fire(options);
  }

  /**
   * Send an email with the specified options
   */
  static async sendEmail(options: Mail.Options): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isConfigured()) {
        emailLogger.warn('Email service not configured');
        return { success: false, error: 'Email service not configured' };
      }

      // Set default from address if not provided
      if (!options.from) {
        options.from = this.useAWSSES
          ? process.env.SES_FROM_EMAIL || 'noreply@postolio.example'
          : process.env.SMTP_FROM || '"Postolio" <noreply@postolio.example>';
      }

      // Add important headers to improve deliverability
      if (!options.headers) {
        options.headers = {};
      }
      // Use type assertion for custom headers
      const headers = options.headers as Record<string, string>;
      headers['List-Unsubscribe'] = '<mailto:unsubscribe@postolio.example>';
      headers['X-Priority'] = '3'; // Normal priority
      headers['Importance'] = 'Normal';

      // Use AWS SES in production, SMTP in development
      emailLogger.info(`Email service configured to use: ${this.useAWSSES ? 'AWS SES' : 'SMTP'}`);
      if (this.useAWSSES) {
        await this.sendViaSES(options);
      } else {
        await this.sendViaSMTP(options);
      }

      return { success: true };
    } catch (error) {
      emailLogger.error('Email send error', formatError(error));

      // Provide more specific error messages for SES
      if (error instanceof Error && error.name === 'MessageRejected') {
        return {
          success: false,
          error: 'Email address not verified in AWS SES. Please verify sender email.',
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }

  /**
   * Generate a standard email template
   */
  static generateEmailTemplate(params: EmailTemplateParams): { html: string; text: string } {
    return generateEmailTemplate(params);
  }

  /**
   * Send a magic link email
   */
  static async sendMagicLink(
    email: string,
    token: string,
    isSignUp = false
  ): Promise<{ success: boolean; error?: string }> {
    return sendMagicLinkTransactional((options) => this.sendEmail(options), email, token, isSignUp);
  }

  /**
   * Send an email verification link
   */
  static async sendVerificationEmail(
    email: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    return sendVerificationEmailTransactional((options) => this.sendEmail(options), email, token);
  }

  /**
   * Send a password reset email
   */
  static async sendPasswordResetEmail(
    email: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    return sendPasswordResetEmailTransactional((options) => this.sendEmail(options), email, token);
  }

  /**
   * Send public data deletion verification email
   */
  static async sendDataDeletionVerificationEmail(
    email: string,
    token: string
  ): Promise<{ success: boolean; error?: string }> {
    return sendDataDeletionVerificationEmailTransactional(
      (options) => this.sendEmail(options),
      email,
      token
    );
  }

  /**
   * Send two-factor authentication code (async via queue)
   */
  static async sendTwoFactorCode(
    email: string,
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { emailQueue } = await import('./email-queue.js');
      await emailQueue.addTwoFactorEmail(email, code, { priority: 'critical' });
      return { success: true };
    } catch (error) {
      emailLogger.error('Failed to queue 2FA email', formatError(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send two-factor authentication code (immediate)
   */
  static async sendTwoFactorCodeImmediate(
    email: string,
    code: string
  ): Promise<{ success: boolean; error?: string }> {
    return sendTwoFactorCodeImmediateTransactional(
      (options) => this.sendEmail(options),
      email,
      code
    );
  }

  /**
   * Send a welcome email to new users (async via queue)
   */
  static async sendWelcomeEmail(
    email: string,
    name?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { emailQueue } = await import('./email-queue.js');
      await emailQueue.addWelcomeEmail(email, name);
      return { success: true };
    } catch (error) {
      emailLogger.error('Failed to queue welcome email', formatError(error));
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a welcome email to new users (immediate)
   */
  static async sendWelcomeEmailImmediate(
    email: string,
    name?: string
  ): Promise<{ success: boolean; error?: string }> {
    return sendWelcomeEmailImmediateTransactional(
      (options) => this.sendEmail(options),
      email,
      name
    );
  }

  /**
   * Send account deletion confirmation email
   */
  static async sendDeletionConfirmation(
    email: string,
    scheduledDeletionDate: Date
  ): Promise<{ success: boolean; error?: string }> {
    return sendDeletionConfirmationTransactional(
      (options) => this.sendEmail(options),
      email,
      scheduledDeletionDate
    );
  }

  /**
   * Send account deletion confirmation email (immediate)
   */
  static async sendDeletionConfirmationImmediate(
    email: string,
    scheduledDeletionDate: Date
  ): Promise<{ success: boolean; error?: string }> {
    return sendDeletionConfirmationTransactional(
      (options) => this.sendEmail(options),
      email,
      scheduledDeletionDate
    );
  }

  /**
   * Verify email service connection
   */
  static async verifyConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        return false;
      }

      if (this.useAWSSES) {
        // Test SES by checking identity verification status
        const ses = this.getSESClient();
        const { $metadata } = await ses
          .send(
            new SendEmailCommand({
              Source: process.env.SES_FROM_EMAIL || 'noreply@postolio.example',
              Destination: { ToAddresses: ['test@example.com'] },
              Message: {
                Subject: { Data: 'Test' },
                Body: { Text: { Data: 'Test' } },
              },
            })
          )
          .catch((err) => ({
            $metadata: { httpStatusCode: err.$metadata?.httpStatusCode || 0 },
          }));

        // If we get a 400 error, it means SES is configured but email not verified
        // If we get 200 or 400, SES is working
        return $metadata.httpStatusCode === 200 || $metadata.httpStatusCode === 400;
      }
      // Verify SMTP connection
      const transporter = this.getTransporter();
      await transporter.verify();
      return true;
    } catch (error) {
      emailLogger.error('Email service verification failed', formatError(error));
      return false;
    }
  }
}
