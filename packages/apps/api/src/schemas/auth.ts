import { z } from 'zod';

/**
 * NIST 2024 Password Guidelines
 * - Minimum 15 characters
 * - Maximum 128 characters
 * - Must contain uppercase, lowercase, and numbers
 * - Special characters recommended but not required
 */
const passwordSchema = z
  .string()
  .min(15, 'Password must be at least 15 characters long')
  .max(128, 'Password must be less than 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

/**
 * Email validation with common rules
 */
const emailSchema = z
  .string()
  .email('Invalid email address')
  .toLowerCase()
  .trim()
  .max(255, 'Email must be less than 255 characters');

/**
 * Registration schema
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  // Optional on the signup form, which submits an empty string when left blank.
  name: z
    .string()
    .trim()
    .max(100, 'Name must be less than 100 characters')
    .transform((name) => name || undefined)
    .optional(),
  timezone: z.string().optional(), // Browser-detected timezone (e.g., 'America/New_York')
  deviceFingerprint: z.string().optional(), // Device fingerprint for session tracking
  deviceName: z.string().optional(), // Human-readable device name (e.g., 'Chrome on macOS')
});

/**
 * Login schema
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
  deviceFingerprint: z.string().optional(), // Device fingerprint for session tracking
  deviceName: z.string().optional(), // Human-readable device name (e.g., 'Chrome on macOS')
});

/**
 * Magic link request schema
 */
export const magicLinkRequestSchema = z.object({
  email: emailSchema,
  isSignUp: z.boolean().optional().default(false),
});

/**
 * Magic link verification schema
 */
export const magicLinkVerifySchema = z.object({
  token: z
    .string()
    .length(32, 'Invalid token format')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid token characters'),
});

/**
 * Email verification schema
 */
export const emailVerifySchema = z.object({
  token: z
    .string()
    .length(32, 'Invalid token format')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid token characters'),
});

/**
 * Password reset request schema
 */
export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

/**
 * Password reset confirmation schema
 */
export const passwordResetSchema = z
  .object({
    token: z
      .string()
      .length(32, 'Invalid token format')
      .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid token characters'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

/**
 * OAuth callback schema
 */
export const oauthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  redirectUri: z.string().url().optional(),
});

/**
 * Google OAuth token schema
 */
export const googleTokenSchema = z.object({
  credential: z.string().min(1, 'Google credential is required'),
});

/**
 * Facebook OAuth token schema
 */
export const facebookTokenSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirectUri: z.string().url().optional(),
});

/**
 * Two-factor authentication setup schema
 */
export const twoFactorSetupSchema = z.object({
  type: z.enum(['totp', 'sms', 'email']),
  phoneNumber: z
    .string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
    .optional(),
});

/**
 * Two-factor authentication verification schema
 */
export const twoFactorVerifySchema = z.object({
  code: z
    .string()
    .length(6, 'Code must be 6 digits')
    .regex(/^\d+$/, 'Code must contain only numbers'),
  trustDevice: z.boolean().optional().default(false),
});

/**
 * Change password schema
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

/**
 * Update profile schema
 */
export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters')
    .optional(),
  email: emailSchema.optional(),
  profilePicture: z.string().url('Invalid URL format').optional().nullable(),
});

// Type exports
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MagicLinkRequestInput = z.infer<typeof magicLinkRequestSchema>;
export type MagicLinkVerifyInput = z.infer<typeof magicLinkVerifySchema>;
export type EmailVerifyInput = z.infer<typeof emailVerifySchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export type OAuthCallbackInput = z.infer<typeof oauthCallbackSchema>;
export type GoogleTokenInput = z.infer<typeof googleTokenSchema>;
export type FacebookTokenInput = z.infer<typeof facebookTokenSchema>;
export type TwoFactorSetupInput = z.infer<typeof twoFactorSetupSchema>;
export type TwoFactorVerifyInput = z.infer<typeof twoFactorVerifySchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
