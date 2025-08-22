# Postolio Authentication System Documentation

## Overview

Postolio implements a comprehensive, enterprise-grade authentication system with multiple authentication methods, security features, and user convenience options. This guide covers all authentication features and their implementation.

## Table of Contents

1. [Authentication Methods](#authentication-methods)
2. [Security Features](#security-features)
3. [Setup and Configuration](#setup-and-configuration)
4. [API Reference](#api-reference)
5. [Frontend Integration](#frontend-integration)
6. [Best Practices](#best-practices)

## Authentication Methods

### 1. Email & Password Authentication

Traditional authentication with enhanced security features:

- **Password Requirements** (NIST 2024 Guidelines):
  - Minimum 15 characters
  - Must contain uppercase, lowercase, and numbers
  - Maximum 128 characters
  - Real-time strength indicator

**Registration Flow:**
```javascript
// Frontend
const response = await apiClient.register({
  email: 'user@example.com',
  password: 'SecurePassword123!',
  name: 'John Doe' // Optional
})

// Backend validation with Zod
const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().optional()
})
```

### 2. OAuth Integration

#### Google OAuth

**Setup Requirements:**
1. Create a Google Cloud Project
2. Enable Google+ API
3. Configure OAuth consent screen
4. Create OAuth 2.0 credentials

**Environment Variables:**
```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

**Implementation:**
```javascript
// Frontend component
<GoogleSignIn mode="signin" />

// Handles the OAuth flow automatically
```

#### Facebook/Meta OAuth

**Setup Requirements:**
1. Create Meta App at developers.facebook.com
2. Add Facebook Login product
3. Configure OAuth redirect URIs

**Environment Variables:**
```bash
FACEBOOK_APP_ID=your-app-id
FACEBOOK_APP_SECRET=your-app-secret
```

### 3. Magic Link (Passwordless)

Email-based passwordless authentication:

**Flow:**
1. User enters email
2. System sends secure link
3. Link valid for 15 minutes
4. Clicking link logs user in

**Implementation:**
```javascript
// Request magic link
await apiClient.requestMagicLink({
  email: 'user@example.com',
  isSignUp: false // or true for registration
})

// Verify magic link
await apiClient.verifyMagicLink({
  token: 'secure-32-char-token'
})
```

### 4. Two-Factor Authentication (2FA)

Supports multiple 2FA methods:

#### TOTP (Time-based One-Time Password)
- Compatible with Google Authenticator, Authy, etc.
- QR code generation for easy setup
- 30-second time windows

#### Email-based 2FA
- 6-digit codes sent via email
- 5-minute expiration
- Rate-limited to prevent abuse

#### Setup Flow:
```javascript
// Enable 2FA
const { qrCode, backupCodes } = await apiClient.setup2FA({
  type: 'totp' // or 'email'
})

// Verify setup
await apiClient.verify2FASetup({
  code: '123456'
})
```

## Security Features

### 1. Rate Limiting

Tiered rate limiting based on subscription level:

```javascript
// Configuration
const rateLimits = {
  register: { windowMs: 15 * 60 * 1000, maxRequests: 5 },
  login: { windowMs: 15 * 60 * 1000, maxRequests: 10 },
  passwordReset: { windowMs: 60 * 60 * 1000, maxRequests: 3 },
  emailVerification: { windowMs: 60 * 60 * 1000, maxRequests: 5 }
}

// Tier multipliers
const tierMultipliers = {
  free: 1,
  basic: 2,
  premium: 5,
  custom: 10
}
```

### 2. Audit Logging

Comprehensive audit trail for all authentication events:

```javascript
// Logged events
enum AuditEventType {
  USER_REGISTER,
  USER_LOGIN,
  USER_LOGIN_FAILED,
  USER_LOGOUT,
  PASSWORD_RESET_REQUESTED,
  PASSWORD_RESET_COMPLETED,
  TWO_FACTOR_ENABLED,
  TWO_FACTOR_VERIFIED,
  ACCOUNT_LOCKED
}

// Query audit logs
const logs = await AuditLogger.query({
  userId: 'user-id',
  eventType: AuditEventType.USER_LOGIN,
  startDate: new Date('2024-01-01'),
  limit: 100
})
```

### 3. Account Lockout

Automatic account lockout after failed attempts:

- 5 failed attempts within 15 minutes triggers lockout
- Account locked for 30 minutes
- Email notification sent to user
- Admin can manually unlock

### 4. Session Management

JWT-based authentication with secure cookie storage:

```javascript
// Token configuration
const tokenOptions = {
  standard: '7d',      // Normal session
  rememberMe: '30d',   // Remember me enabled
  shortLived: '1h'     // Sensitive operations
}

// Cookie settings
const cookieOptions = {
  httpOnly: true,
  secure: true,        // HTTPS only in production
  sameSite: 'lax',
  path: '/'
}
```

### 5. Password Reset

Secure password reset flow:

1. User requests reset
2. Token sent via email (1-hour expiration)
3. User clicks link and sets new password
4. All sessions invalidated
5. Notification email sent

### 6. Email Verification

Non-blocking email verification:

- Users can access app immediately
- Verification reminder emails
- Some features may require verification
- 24-hour token expiration

## Setup and Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/postolio

# JWT
JWT_SECRET=your-secure-random-string

# Email (Development - SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email (Production - AWS SES)
USE_AWS_SES=true
AWS_REGION=us-east-1
SES_FROM_EMAIL=noreply@postolio.example

# OAuth
VITE_GOOGLE_CLIENT_ID=your-google-client-id
FACEBOOK_APP_ID=your-facebook-app-id
FACEBOOK_APP_SECRET=your-facebook-app-secret

# Security
COOKIE_SECRET=your-cookie-secret
```

### Database Schema

```prisma
model User {
  id                   String    @id @default(cuid())
  email                String    @unique
  password             String
  name                 String?
  
  // OAuth
  googleId             String?   @unique
  facebookId           String?   @unique
  profilePicture       String?
  emailVerified        Boolean   @default(false)
  
  // Two-factor authentication
  twoFactorEnabled     Boolean   @default(false)
  twoFactorMethod      String?   // 'totp', 'email', 'sms'
  twoFactorSecret      String?
  twoFactorBackupCodes Json?
  twoFactorPhoneNumber String?
  
  // Timestamps
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}

model AuditLog {
  id          String   @id @default(cuid())
  userId      String?
  email       String?
  eventType   String
  ipAddress   String?
  userAgent   String?
  metadata    Json?
  success     Boolean
  errorMessage String?
  createdAt   DateTime @default(now())
}
```

## API Reference

### Authentication Endpoints

#### Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "rememberMe": true
}
```

#### Logout
```http
POST /api/auth/logout
Authorization: Bearer <token>
```

#### Get Profile
```http
GET /api/auth/me
Authorization: Bearer <token>
```

### OAuth Endpoints

#### Google OAuth
```http
POST /api/auth/google/callback
Content-Type: application/json

{
  "credential": "google-jwt-token"
}
```

#### Facebook OAuth
```http
POST /api/auth/facebook/callback
Content-Type: application/json

{
  "code": "authorization-code",
  "redirectUri": "http://localhost:5173"
}
```

### Magic Link Endpoints

#### Request Magic Link
```http
POST /api/auth/magic-link/request
Content-Type: application/json

{
  "email": "user@example.com",
  "isSignUp": false
}
```

#### Verify Magic Link
```http
POST /api/auth/magic-link/verify
Content-Type: application/json

{
  "token": "32-character-token"
}
```

### Two-Factor Authentication Endpoints

#### Setup 2FA
```http
POST /api/auth/2fa/setup
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "totp",
  "phoneNumber": "+1234567890"  // Optional, for SMS
}
```

#### Verify 2FA Setup
```http
POST /api/auth/2fa/verify-setup
Authorization: Bearer <token>
Content-Type: application/json

{
  "code": "123456"
}
```

#### Verify 2FA Code (Login)
```http
POST /api/auth/2fa/verify
Content-Type: application/json

{
  "code": "123456",
  "trustDevice": true
}
```

#### Disable 2FA
```http
POST /api/auth/2fa/disable
Authorization: Bearer <token>
Content-Type: application/json

{
  "password": "current-password"
}
```

### Password Reset Endpoints

#### Request Reset
```http
POST /api/auth/password/reset-request
Content-Type: application/json

{
  "email": "user@example.com"
}
```

#### Reset Password
```http
POST /api/auth/password/reset
Content-Type: application/json

{
  "token": "reset-token",
  "password": "NewSecurePassword123!",
  "confirmPassword": "NewSecurePassword123!"
}
```

## Frontend Integration

### React Components

#### Login Component
```jsx
import { Login } from './pages/Login'

// Features:
// - Email/password login
// - OAuth providers (Google, Facebook)
// - Magic link option
// - Remember me checkbox
// - Forgot password link
```

#### Register Component
```jsx
import { Register } from './pages/Register'

// Features:
// - Email/password registration
// - Real-time password strength meter
// - OAuth registration
// - Terms acceptance
// - Auto-login after registration
```

#### Password Reset Component
```jsx
import { PasswordReset } from './pages/PasswordReset'

// Features:
// - Request reset by email
// - Token validation
// - Password strength requirements
// - Auto-redirect to login
```

### Auth Store (Zustand)

```javascript
import { useAuthStore } from './stores/authStore'

const authStore = useAuthStore()

// Available methods
authStore.login(email, password, rememberMe)
authStore.register(email, password, name)
authStore.logout()
authStore.checkAuth()
authStore.getToken()
```

### Protected Routes

```jsx
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  
  if (isLoading) return <LoadingSpinner />
  
  return isAuthenticated ? children : <Navigate to="/login" />
}

// Usage
<Route path="/dashboard" element={
  <ProtectedRoute>
    <Dashboard />
  </ProtectedRoute>
} />
```

## Best Practices

### 1. Security Best Practices

- **Never store passwords in plain text**
- **Use HTTPS in production**
- **Implement CSRF protection**
- **Regular security audits**
- **Keep dependencies updated**
- **Use environment variables for secrets**
- **Implement proper error handling**
- **Don't expose sensitive information in errors**

### 2. User Experience Best Practices

- **Provide clear error messages**
- **Show password requirements upfront**
- **Implement loading states**
- **Auto-focus first input field**
- **Remember user preferences**
- **Provide multiple auth options**
- **Clear success feedback**
- **Accessible form design**

### 3. Performance Best Practices

- **Implement rate limiting**
- **Use caching where appropriate**
- **Lazy load auth components**
- **Optimize JWT payload size**
- **Use connection pooling**
- **Implement request debouncing**
- **Background email sending**

### 4. Monitoring & Maintenance

- **Monitor failed login attempts**
- **Track authentication metrics**
- **Regular audit log reviews**
- **Automated security scanning**
- **User feedback collection**
- **Performance monitoring**
- **Error tracking and alerting**

## Troubleshooting

### Common Issues

#### 1. OAuth Not Working
- Check redirect URIs match exactly
- Verify app credentials are correct
- Ensure OAuth provider app is published
- Check CORS configuration

#### 2. Emails Not Sending
- Verify SMTP/SES credentials
- Check email service configuration
- Review email bounce logs
- Ensure sender email is verified (SES)

#### 3. 2FA Issues
- Verify server time is synchronized
- Check TOTP window settings
- Ensure Redis is running
- Review backup code generation

#### 4. Rate Limiting Too Strict
- Adjust rate limit windows
- Implement tier-based limits
- Add IP whitelisting for testing
- Consider geographical distribution

## Migration Guide

### From Basic Auth to Enhanced Auth

1. **Database Migration**
```bash
npx prisma migrate dev --name enhanced-auth
```

2. **Update Environment Variables**
```bash
# Add new required variables
JWT_SECRET=...
COOKIE_SECRET=...
```

3. **Update Frontend Components**
```javascript
// Replace old login form with new components
import { Login } from './pages/Login'
```

4. **Test Authentication Flow**
- Register new user
- Login with remember me
- Test OAuth providers
- Verify 2FA setup
- Test password reset

## Support

For issues or questions:
- GitHub Issues: https://github.com/postolio/postolio
- Email: support@postolio.example
- Documentation: https://postolio.example

---

Last Updated: January 2025
Version: 2.0.0