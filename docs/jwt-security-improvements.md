# JWT Security Improvements

**Last Reviewed:** January 31, 2026

## Overview

This document outlines the comprehensive JWT security improvements implemented in the Postolio API.

## Key Improvements

### 1. ✅ Refresh Token Implementation

- **Secure Storage**: Refresh tokens stored in Redis with proper expiration
- **Token Rotation**: Automatic rotation on each use to prevent replay attacks
- **Token Families**: Tracking token generations to detect reuse
- **Security Breach Detection**: Automatic invalidation of entire token family on reuse detection
- **Audit Logging**: All token operations logged for security monitoring

### 2. ✅ Rate Limiting on Auth Endpoints

Enhanced rate limiting for all authentication endpoints:

| Endpoint                   | Limit      | Window     | Purpose                 |
| -------------------------- | ---------- | ---------- | ----------------------- |
| `/api/auth/login`          | 5 requests | 1 minute   | Prevent brute force     |
| `/api/auth/register`       | 2 requests | 15 minutes | Prevent spam accounts   |
| `/api/auth/refresh`        | 5 requests | 1 minute   | Prevent token abuse     |
| `/api/auth/password-reset` | 3 requests | 15 minutes | Prevent abuse           |
| `/api/magic-link/*`        | 5 requests | 1 minute   | Prevent magic link spam |

### 3. ✅ Removed Dev JWT Fallback

- **No More Fallback**: Removed hardcoded development JWT secret
- **Required in All Environments**: JWT_SECRET must be explicitly set
- **Minimum Length Validation**: Enforces 32+ character secrets
- **Setup Helper**: Added `pnpm generate-secret` command for easy setup

## Security Features

### Token Configuration

```typescript
{
  algorithm: 'HS256',        // Single algorithm to prevent confusion attacks
  expiresIn: '15m',          // Short-lived access tokens
  clockTolerance: 30,        // Allow 30 seconds clock skew
}
```

### Refresh Token Features

- **30-day expiry** for refresh tokens
- **Token rotation** on each use
- **Family tracking** for 90 days
- **Max 100 rotations** per family
- **Automatic cleanup** of expired tokens

### Rate Limiting Headers

All auth endpoints return standard rate limit headers:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining
- `X-RateLimit-Reset`: When the limit resets
- `Retry-After`: Seconds to wait when rate limited

## Setup Guide

### 1. Generate JWT Secret

```bash
# Generate a secure JWT secret
pnpm --filter=api generate-secret

# Or manually with OpenSSL
openssl rand -hex 32
```

### 2. Configure Environment

Create `.env` file from example:

```bash
cp packages/apps/api/.env.example packages/apps/api/.env
```

Update with your generated secret:

```env
JWT_SECRET=your-64-character-hex-string-here
```

### 3. Start Services

```bash
# Start Redis (required for refresh tokens and rate limiting)
docker compose up -d

# Start API
pnpm dev --filter=api
```

## API Usage

### Login with Refresh Token

```typescript
// POST /api/auth/login
const response = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
  credentials: 'include', // Important for cookies
});

const { user } = await response.json();
// Access token is not returned in the response body
// auth_token + refresh_token are set as HttpOnly cookies
```

### Refresh Access Token

```typescript
// POST /api/auth/refresh
const response = await fetch('/api/auth/refresh', {
  method: 'POST',
  credentials: 'include', // Sends refresh token cookie
});

const { message } = await response.json();
// New access token is set as HttpOnly cookie
// New refresh token set as HttpOnly cookie (rotation)
```

### Logout

```typescript
// POST /api/auth/logout
await fetch('/api/auth/logout', {
  method: 'POST',
  credentials: 'include',
});
// Invalidates refresh token and clears cookies
```

## Security Best Practices

### For Development

1. Generate unique JWT secret for development
2. Never commit `.env` files to version control
3. Use different secrets for each developer
4. Test rate limiting locally

### For Production

1. Use AWS Secrets Manager or similar for JWT_SECRET
2. Generate strong 64+ character secrets
3. Rotate secrets periodically
4. Monitor rate limit violations
5. Review audit logs regularly
6. Implement IP-based blocking for repeated violations

## Migration from Old System

### Breaking Changes

1. **JWT_SECRET Required**: No more fallback secret
   - Action: Set JWT_SECRET in environment before starting

2. **Rate Limiting Active**: Auth endpoints now rate limited
   - Action: Implement retry logic in clients

3. **Refresh Token Rotation**: Tokens rotate on each use
   - Action: Update clients to handle new tokens

### Backward Compatibility

- Existing JWT tokens continue to work until expiry
- Cookie-based auth is the default for the web app
- Bearer tokens remain optional for non-browser clients where enabled

## Monitoring & Debugging

### Check Rate Limit Status

```bash
# View rate limit headers
curl -I http://localhost:3000/api/auth/login
```

### Monitor Redis Keys

```bash
# Connect to Redis
redis-cli

# View rate limit keys
KEYS ratelimit:*

# View refresh tokens
KEYS refresh-token:*

# View token families
KEYS token-family:*
```

### Audit Logs

Check application logs for:

- `REFRESH_TOKEN_GENERATED`
- `REFRESH_TOKEN_ROTATED`
- `REFRESH_TOKEN_REUSE_DETECTED`
- `REFRESH_TOKEN_FAMILY_INVALIDATED`

## Troubleshooting

### "JWT_SECRET environment variable is required"

**Solution**: Generate and set JWT secret

```bash
pnpm --filter=api generate-secret
```

### "Rate limit exceeded"

**Solution**: Wait for the time specified in `Retry-After` header

### "Invalid or expired refresh token"

**Causes**:

- Token expired (30 days)
- Token already rotated
- Token family invalidated (security breach)

**Solution**: User must login again

## Future Enhancements

- [ ] Add JWT key rotation mechanism
- [ ] Implement JWK (JSON Web Key) sets
- [ ] Add device tracking for refresh tokens
- [ ] Implement progressive rate limiting
- [ ] Add CAPTCHA for repeated failures
- [ ] Implement account lockout policies
