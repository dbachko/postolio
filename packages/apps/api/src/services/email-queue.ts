import Bull from "bull";
import type Mail from "nodemailer/lib/mailer";
import { EmailService } from "./email.js";
import Redis from "ioredis";
import { getRedisUrl } from "../utils/redis-url.js";

// Email job types
export interface EmailJob {
  type:
    | "welcome"
    | "verification"
    | "password_reset"
    | "two_factor"
    | "generic";
  to: string;
  subject: string;
  html?: string;
  text?: string;
  template?: string;
  templateData?: Record<string, unknown>;
  priority?: "low" | "normal" | "high" | "critical";
  delay?: number; // Delay in milliseconds
  attempts?: number;
}

export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  sentAt: Date;
}

export class EmailQueueService {
  private static instance: EmailQueueService | null = null;
  private emailQueue: Bull.Queue<EmailJob>;
  private redis: Redis;

  private constructor() {
    // Use shared utility for Redis URL construction
    const redisUrl = getRedisUrl();

    // Create Redis connection for Bull
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      family: 4, // Force IPv4
    });

    // Create Bull queue - use same URL for consistency
    const redisConfig = redisUrl;

    this.emailQueue = new Bull("email processing", {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 100, // Keep 100 completed jobs for monitoring
        removeOnFail: 50, // Keep 50 failed jobs for debugging
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000, // Start with 2 seconds, then 4, 8, etc.
        },
      },
      settings: {
        stalledInterval: 30000, // 30 seconds
        maxStalledCount: 1,
      },
    });

    this.setupProcessors();
    this.setupEventListeners();
  }

  static getInstance(): EmailQueueService {
    if (!EmailQueueService.instance) {
      EmailQueueService.instance = new EmailQueueService();
    }
    return EmailQueueService.instance;
  }

  /**
   * Setup job processors
   */
  private setupProcessors(): void {
    // Process emails with concurrency of 10
    this.emailQueue.process(
      "send-email",
      10,
      async (job: Bull.Job<EmailJob>) => {
        const { type, to, subject, html, text, template, templateData } =
          job.data;

        try {
          console.log(`Processing email job ${job.id}: ${type} to ${to}`);

          // Prepare email options
          const emailOptions: Mail.Options = {
            to,
            subject,
          };

          // Use template if provided, otherwise use raw html/text
          if (template && templateData) {
            const renderedEmail = await this.renderTemplate(
              template,
              templateData,
            );
            emailOptions.html = renderedEmail.html;
            emailOptions.text = renderedEmail.text;
          } else {
            emailOptions.html = html;
            emailOptions.text = text;
          }

          // Send email
          const result = await EmailService.sendEmail(emailOptions);

          if (!result.success) {
            throw new Error(result.error || "Email sending failed");
          }

          console.log(`Email job ${job.id} completed successfully`);

          return {
            success: true,
            sentAt: new Date(),
          } as EmailJobResult;
        } catch (error) {
          console.error(`Email job ${job.id} failed:`, error);
          throw error; // Re-throw to trigger retry mechanism
        }
      },
    );
  }

  /**
   * Setup event listeners for monitoring
   */
  private setupEventListeners(): void {
    this.emailQueue.on("completed", (job: Bull.Job, result: EmailJobResult) => {
      console.log(
        `✅ Email job ${job.id} completed:`,
        JSON.stringify({
          type: job.data.type,
          to: job.data.to,
          success: result.success,
        }),
      );
    });

    this.emailQueue.on("failed", (job: Bull.Job, err: Error) => {
      console.error(
        `❌ Email job ${job.id} failed:`,
        JSON.stringify({
          type: job.data.type,
          to: job.data.to,
          error: err.message,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts,
        }),
      );
    });

    this.emailQueue.on("stalled", (job: Bull.Job) => {
      console.warn(
        `⚠️ Email job ${job.id} stalled:`,
        JSON.stringify({
          type: job.data.type,
          to: job.data.to,
        }),
      );
    });

    this.emailQueue.on("error", (error: Error) => {
      console.error("Email queue error:", error);
    });

    this.emailQueue.on("waiting", (jobId: number) => {
      console.log(`📝 Email job ${jobId} waiting to be processed`);
    });

    this.emailQueue.on("active", (job: Bull.Job) => {
      console.log(
        `🔄 Email job ${job.id} started processing:`,
        JSON.stringify({
          type: job.data.type,
          to: job.data.to,
        }),
      );
    });
  }

  /**
   * Add email to queue
   */
  async addEmailJob(emailData: EmailJob): Promise<Bull.Job<EmailJob>> {
    const {
      priority = "normal",
      delay = 0,
      attempts = 3,
      ...jobData
    } = emailData;

    // Set job options based on priority
    const jobOptions: Bull.JobOptions = {
      priority: this.getPriorityValue(priority),
      delay,
      attempts,
      removeOnComplete: priority === "critical" ? 200 : 100,
      removeOnFail: priority === "critical" ? 100 : 50,
    };

    // Add retry strategy based on email type
    if (jobData.type === "verification" || jobData.type === "password_reset") {
      jobOptions.attempts = 5; // Critical emails get more retries
      jobOptions.backoff = {
        type: "exponential",
        delay: 1000,
      };
    }

    const job = await this.emailQueue.add("send-email", jobData, jobOptions);

    console.log(
      `📧 Email job ${job.id} added to queue:`,
      JSON.stringify({
        type: jobData.type,
        to: jobData.to,
        priority,
        delay: delay > 0 ? `${delay}ms` : "immediate",
      }),
    );

    return job;
  }

  /**
   * Add welcome email to queue
   */
  async addWelcomeEmail(
    to: string,
    name?: string,
    options?: { delay?: number; priority?: EmailJob["priority"] },
  ): Promise<Bull.Job<EmailJob>> {
    return this.addEmailJob({
      type: "welcome",
      to,
      subject: "Welcome to Postolio! 🎉",
      template: "welcome",
      templateData: { name: name || "there" },
      priority: options?.priority || "normal",
      delay: options?.delay || 0,
    });
  }

  /**
   * Add verification email to queue
   */
  async addVerificationEmail(
    to: string,
    verificationLink: string,
    options?: { delay?: number; priority?: EmailJob["priority"] },
  ): Promise<Bull.Job<EmailJob>> {
    return this.addEmailJob({
      type: "verification",
      to,
      subject: "Please verify your email address",
      template: "verification",
      templateData: { verificationLink },
      priority: options?.priority || "high",
      delay: options?.delay || 0,
      attempts: 5, // Critical email
    });
  }

  /**
   * Add password reset email to queue
   */
  async addPasswordResetEmail(
    to: string,
    resetLink: string,
    options?: { delay?: number; priority?: EmailJob["priority"] },
  ): Promise<Bull.Job<EmailJob>> {
    return this.addEmailJob({
      type: "password_reset",
      to,
      subject: "Reset your Postolio password",
      template: "password_reset",
      templateData: { resetLink },
      priority: options?.priority || "critical",
      delay: options?.delay || 0,
      attempts: 5, // Critical email
    });
  }

  /**
   * Add two-factor authentication code email to queue
   */
  async addTwoFactorEmail(
    to: string,
    code: string,
    options?: { delay?: number; priority?: EmailJob["priority"] },
  ): Promise<Bull.Job<EmailJob>> {
    return this.addEmailJob({
      type: "two_factor",
      to,
      subject: "Your Postolio verification code",
      template: "two_factor",
      templateData: { code },
      priority: options?.priority || "critical",
      delay: options?.delay || 0,
      attempts: 5, // Critical email
    });
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.emailQueue.getWaiting(),
      this.emailQueue.getActive(),
      this.emailQueue.getCompleted(),
      this.emailQueue.getFailed(),
      this.emailQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      paused: await this.emailQueue.isPaused(),
    };
  }

  /**
   * Get failed jobs for debugging
   */
  async getFailedJobs(limit: number = 10): Promise<Bull.Job[]> {
    return this.emailQueue.getFailed(0, limit - 1);
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(): Promise<number> {
    const failedJobs = await this.emailQueue.getFailed();
    let retriedCount = 0;

    for (const job of failedJobs) {
      try {
        await job.retry();
        retriedCount++;
      } catch (error) {
        console.error(`Failed to retry job ${job.id}:`, error);
      }
    }

    console.log(`Retried ${retriedCount} failed email jobs`);
    return retriedCount;
  }

  /**
   * Clean old jobs
   */
  async cleanOldJobs(): Promise<void> {
    // Clean jobs older than 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    await Promise.all([
      this.emailQueue.clean(oneDayAgo, "completed"),
      this.emailQueue.clean(oneDayAgo, "failed"),
      this.emailQueue.clean(oneDayAgo, "active"), // Clean stalled jobs
    ]);

    console.log("Cleaned old email jobs");
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    await this.emailQueue.pause();
    console.log("Email queue paused");
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    await this.emailQueue.resume();
    console.log("Email queue resumed");
  }

  /**
   * Close the queue connection
   */
  async close(): Promise<void> {
    await this.emailQueue.close();
    await this.redis.quit();
    console.log("Email queue closed");
  }

  /**
   * Convert priority string to Bull priority value
   */
  private getPriorityValue(priority: EmailJob["priority"]): number {
    switch (priority) {
      case "critical":
        return 1; // Highest priority
      case "high":
        return 5;
      case "normal":
        return 10;
      case "low":
        return 20;
      default:
        return 10;
    }
  }

  /**
   * Simple template rendering (can be replaced with a proper template engine)
   */
  private async renderTemplate(
    template: string,
    data: Record<string, unknown>,
  ): Promise<{ html: string; text: string }> {
    // This is a simple template system - in production you might use Handlebars, Mustache, etc.
    const templates = {
      welcome: {
        html: `
          <h1>Welcome to Postolio, ${data.name}! 🎉</h1>
          <p>We're excited to help you manage your Instagram content with AI.</p>
          <p>Get started by connecting your Instagram account and creating your first brand.</p>
          <p>Happy posting!</p>
          <p>The Postolio Team</p>
        `,
        text: `Welcome to Postolio, ${data.name}! We're excited to help you manage your Instagram content with AI. Get started by connecting your Instagram account and creating your first brand. Happy posting! The Postolio Team`,
      },
      verification: {
        html: `
          <h1>Verify your email address</h1>
          <p>Please click the link below to verify your email address:</p>
          <p><a href="${data.verificationLink}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
          <p>If you didn't create this account, you can safely ignore this email.</p>
        `,
        text: `Verify your email address by clicking this link: ${data.verificationLink}. If you didn't create this account, you can safely ignore this email.`,
      },
      password_reset: {
        html: `
          <h1>Reset your password</h1>
          <p>Click the link below to reset your Postolio password:</p>
          <p><a href="${data.resetLink}" style="background: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
          <p>This link will expire in 1 hour for security reasons.</p>
          <p>If you didn't request this reset, you can safely ignore this email.</p>
        `,
        text: `Reset your password by clicking this link: ${data.resetLink}. This link will expire in 1 hour. If you didn't request this reset, you can safely ignore this email.`,
      },
      two_factor: {
        html: `
          <h1>Your verification code</h1>
          <p>Your Postolio two-factor authentication code is:</p>
          <h2 style="font-family: monospace; background: #f8f9fa; padding: 10px; border-radius: 5px; letter-spacing: 0.2em;">${data.code}</h2>
          <p>This code will expire in 5 minutes.</p>
          <p>If you didn't request this code, please secure your account immediately.</p>
        `,
        text: `Your Postolio two-factor authentication code is: ${data.code}. This code will expire in 5 minutes. If you didn't request this code, please secure your account immediately.`,
      },
    };

    const templateData = templates[template as keyof typeof templates];
    if (!templateData) {
      throw new Error(`Template '${template}' not found`);
    }

    return templateData;
  }
}

// Export singleton instance
export const emailQueue = EmailQueueService.getInstance();
