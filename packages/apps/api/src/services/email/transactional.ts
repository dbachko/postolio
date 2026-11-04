import type { SendMailOptions } from 'nodemailer';
import { generateEmailTemplate } from './template.js';

type EmailResult = { success: boolean; error?: string };
type SendEmailFn = (options: SendMailOptions) => Promise<EmailResult>;

function getFrontendBaseUrl(): string {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}

function formatDeletionDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function sendMagicLinkEmail(
  sendEmail: SendEmailFn,
  email: string,
  token: string,
  isSignUp: boolean
): Promise<EmailResult> {
  const magicLinkUrl = `${getFrontendBaseUrl()}/auth/magic-link?token=${token}`;
  const { html, text } = generateEmailTemplate({
    title: isSignUp ? 'Complete Your Registration' : 'Your Secure Sign-In Link',
    greeting: 'Hello,',
    content: isSignUp
      ? 'Thank you for signing up for Postolio. Please click the button below to verify your email and complete your registration:'
      : 'We received a request to sign in to your Postolio account. Click the button below to continue:',
    buttonText: isSignUp ? 'Verify Email & Complete Registration' : 'Sign In to Postolio',
    buttonUrl: magicLinkUrl,
    warning:
      '<strong>Security Notice:</strong> This link will expire in 15 minutes and can only be used once. If you did not request this link, please ignore this email.',
  });

  return sendEmail({
    to: email,
    subject: isSignUp ? 'Verify your email for Postolio' : 'Your Postolio sign-in link',
    html,
    text,
    replyTo: 'support@postolio.example',
  });
}

export async function sendVerificationEmail(
  sendEmail: SendEmailFn,
  email: string,
  token: string
): Promise<EmailResult> {
  const verificationUrl = `${getFrontendBaseUrl()}/auth/verify-email?token=${token}`;
  const { html, text } = generateEmailTemplate({
    title: 'Verify Your Email',
    greeting: 'Hi there,',
    content: 'Please verify your email address to unlock all features of your Postolio account.',
    buttonText: 'Verify Email Address',
    buttonUrl: verificationUrl,
    warning:
      '<strong>This verification link expires in 24 hours</strong><br>You can request a new verification email from your account settings.',
  });

  return sendEmail({
    to: email,
    subject: 'Verify your Postolio email address',
    html,
    text,
  });
}

export async function sendPasswordResetEmail(
  sendEmail: SendEmailFn,
  email: string,
  token: string
): Promise<EmailResult> {
  const resetUrl = `${getFrontendBaseUrl()}/reset-password?token=${token}`;
  const { html, text } = generateEmailTemplate({
    title: 'Reset Your Password',
    greeting: 'Hi there,',
    content:
      'We received a request to reset your password. Click the button below to set a new password:',
    buttonText: 'Reset Password',
    buttonUrl: resetUrl,
    warning:
      "<strong>This link expires in 1 hour</strong><br>If you didn't request a password reset, please ignore this email and your password will remain unchanged.",
  });

  return sendEmail({
    to: email,
    subject: 'Reset your Postolio password',
    html,
    text,
  });
}

export async function sendDataDeletionVerificationEmail(
  sendEmail: SendEmailFn,
  email: string,
  token: string
): Promise<EmailResult> {
  const verifyUrl = `${getFrontendBaseUrl()}/legal/data-deletion-verify?token=${token}`;
  const { html, text } = generateEmailTemplate({
    title: 'Confirm Your Data Deletion Request',
    greeting: 'Hi there,',
    content:
      'We received a request to delete your Postolio account and associated data. To confirm this request, please click the button below.',
    buttonText: 'Confirm Data Deletion Request',
    buttonUrl: verifyUrl,
    warning:
      '<strong>This deletion verification link expires in 24 hours.</strong><br>If you did not request data deletion, you can safely ignore this email and your account will remain active.',
  });

  return sendEmail({
    to: email,
    subject: 'Confirm your Postolio data deletion request',
    html,
    text,
  });
}

export async function sendTwoFactorCodeImmediate(
  sendEmail: SendEmailFn,
  email: string,
  code: string
): Promise<EmailResult> {
  const { html, text } = generateEmailTemplate({
    title: 'Two-Factor Authentication Code',
    content: `
        <p>Your verification code for Postolio is:</p>
        <div style="background-color: #f3f4f6; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0; border-radius: 6px;">
          ${code}
        </div>
        <p>This code will expire in 5 minutes.</p>
      `,
    warning: "If you didn't request this code, please secure your account immediately.",
  });

  return sendEmail({
    to: email,
    subject: 'Your Postolio Verification Code',
    html,
    text,
  });
}

export async function sendWelcomeEmailImmediate(
  sendEmail: SendEmailFn,
  email: string,
  name?: string
): Promise<EmailResult> {
  const { html, text } = generateEmailTemplate({
    title: 'Welcome to Postolio! 🎉',
    greeting: `Hi${name ? ` ${name}` : ''},`,
    content: `
        <p>Welcome to Postolio - your AI-powered Instagram content management platform!</p>

        <p>Here's what you can do with Postolio:</p>
        <ul>
          <li>🤖 Generate AI-powered content that matches your brand</li>
          <li>📅 Schedule posts for optimal engagement</li>
          <li>📊 Track analytics and grow your audience</li>
          <li>🚀 Automate your scheduling with Autopilot</li>
        </ul>

        <p>Ready to get started? Create your first brand and let's grow your Instagram presence together!</p>
      `,
    buttonText: 'Go to Dashboard',
    buttonUrl: `${getFrontendBaseUrl()}/dashboard`,
  });

  return sendEmail({
    to: email,
    subject: 'Welcome to Postolio! 🎉',
    html,
    text,
  });
}

export async function sendDeletionConfirmationEmail(
  sendEmail: SendEmailFn,
  email: string,
  scheduledDeletionDate: Date
): Promise<EmailResult> {
  const formattedDate = formatDeletionDate(scheduledDeletionDate);
  const { html, text } = generateEmailTemplate({
    title: 'Account Deletion Scheduled',
    greeting: 'Your account has been scheduled for deletion',
    content: `Your Postolio account has been scheduled for permanent deletion on ${formattedDate}. You have 30 days to recover your account if you change your mind. After this date, all your data will be permanently deleted and cannot be recovered.`,
    buttonText: 'Recover Account',
    buttonUrl: `${getFrontendBaseUrl()}/account/recover`,
  });

  return sendEmail({
    to: email,
    subject: 'Postolio Account Deletion Scheduled',
    html,
    text,
  });
}
