# Postolio API Reference

## Base URL

```
Development: http://localhost:3000/api
Production: https://postolio.example/api
```

## Authentication

All authenticated endpoints require a JWT token in one of these formats:

1. **Authorization Header** (Recommended)
```http
Authorization: Bearer <jwt-token>
```

2. **HTTP-Only Cookie** (Automatically set on login)
```http
Cookie: auth_token=<jwt-token>
```

## Response Format

All API responses follow this format:

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

### Error Response
```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

## Rate Limiting

Rate limits are returned in response headers:

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-10T12:00:00Z
Retry-After: 3600
```

## Authentication Endpoints

### Register User

Creates a new user account.

```http
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe"
}
```

**Response:** `201 Created`
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-10T10:00:00Z"
  }
}
```

**Validation Rules:**
- Email: Valid email format, max 255 characters
- Password: Min 15 chars, must contain uppercase, lowercase, number
- Name: Optional, max 100 characters

---

### Login

Authenticates a user and returns a JWT token.

```http
POST /auth/login
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "rememberMe": true
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt-token",
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe",
    "subscriptionTier": "free"
  }
}
```

**2FA Required Response:** `200 OK`
```json
{
  "requiresTwoFactor": true,
  "method": "totp",
  "message": "Two-factor authentication required"
}
```

---

### Logout

Invalidates the current session.

```http
POST /auth/logout
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### Get Current User

Returns the authenticated user's profile.

```http
GET /auth/me
```

**Response:** `200 OK`
```json
{
  "user": {
    "id": "user-id",
    "email": "user@example.com",
    "name": "John Doe",
    "instagramUsername": "@johndoe",
    "subscriptionTier": "premium",
    "timezone": "America/New_York",
    "createdAt": "2024-01-10T10:00:00Z"
  }
}
```

---

### Refresh Token

Generates a new JWT token from existing valid token.

```http
POST /auth/refresh
```

**Response:** `200 OK`
```json
{
  "token": "new-jwt-token"
}
```

## OAuth Endpoints

### Google OAuth Callback

Handles Google OAuth authentication.

```http
POST /auth/google/callback
```

**Request Body:**
```json
{
  "credential": "google-id-token"
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt-token",
  "user": { ... },
  "isNewUser": false
}
```

---

### Facebook OAuth Callback

Handles Facebook OAuth authentication.

```http
POST /auth/facebook/callback
```

**Request Body:**
```json
{
  "code": "facebook-auth-code",
  "redirectUri": "http://localhost:5173"
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt-token",
  "user": { ... },
  "isNewUser": false
}
```

## Magic Link (Passwordless) Endpoints

### Request Magic Link

Sends a magic link to the user's email.

```http
POST /auth/magic-link/request
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "isSignUp": false
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Magic link sent to your email"
}
```

---

### Verify Magic Link

Verifies the magic link token and logs the user in.

```http
POST /auth/magic-link/verify
```

**Request Body:**
```json
{
  "token": "32-character-secure-token"
}
```

**Response:** `200 OK`
```json
{
  "token": "jwt-token",
  "user": { ... }
}
```

## Two-Factor Authentication Endpoints

### Setup 2FA

Initiates two-factor authentication setup.

```http
POST /auth/2fa/setup
```

**Request Body:**
```json
{
  "type": "totp",
  "phoneNumber": "+1234567890"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "qrCode": "data:image/png;base64,...",
  "secret": "base32-secret",
  "backupCodes": [
    "ABCD1234",
    "EFGH5678",
    ...
  ]
}
```

---

### Verify 2FA Setup

Completes the 2FA setup process.

```http
POST /auth/2fa/verify-setup
```

**Request Body:**
```json
{
  "code": "123456"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Two-factor authentication enabled successfully"
}
```

---

### Verify 2FA Code

Verifies 2FA code during login.

```http
POST /auth/2fa/verify
```

**Request Body:**
```json
{
  "code": "123456",
  "trustDevice": true
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Authentication complete"
}
```

---

### Get 2FA Status

Returns current 2FA configuration.

```http
GET /auth/2fa/status
```

**Response:** `200 OK`
```json
{
  "enabled": true,
  "method": "totp",
  "phoneNumber": "***1234"
}
```

---

### Disable 2FA

Disables two-factor authentication.

```http
POST /auth/2fa/disable
```

**Request Body:**
```json
{
  "password": "current-password"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Two-factor authentication disabled"
}
```

## Password Management Endpoints

### Request Password Reset

Initiates password reset process.

```http
POST /auth/password/reset-request
```

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Password reset link sent"
}
```

---

### Reset Password

Completes password reset with token.

```http
POST /auth/password/reset
```

**Request Body:**
```json
{
  "token": "reset-token",
  "password": "NewSecurePassword123!",
  "confirmPassword": "NewSecurePassword123!"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Password reset successfully"
}
```

---

### Validate Reset Token

Checks if a password reset token is valid.

```http
GET /auth/password/reset-validate/:token
```

**Response:** `200 OK`
```json
{
  "valid": true,
  "email": "us***@example.com"
}
```

## Email Verification Endpoints

### Request Verification Email

Sends a verification email to the user.

```http
POST /auth/email/send-verification
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Verification email sent"
}
```

---

### Verify Email

Verifies the user's email address.

```http
POST /auth/email/verify
```

**Request Body:**
```json
{
  "token": "verification-token"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Email verified successfully"
}
```

## Brand Management Endpoints

### List Brands

Returns all brands for the authenticated user.

```http
GET /brands/list
```

**Response:** `200 OK`
```json
{
  "brands": [
    {
      "id": "brand-id",
      "name": "My Brand",
      "description": "Brand description",
      "createdAt": "2024-01-10T10:00:00Z"
    }
  ]
}
```

---

### Create Brand

Creates a new brand.

```http
POST /brands/create
```

**Request Body:**
```json
{
  "name": "My Brand",
  "description": "Brand description"
}
```

**Response:** `201 Created`
```json
{
  "brand": {
    "id": "brand-id",
    "name": "My Brand",
    "description": "Brand description",
    "createdAt": "2024-01-10T10:00:00Z"
  }
}
```

---

### Update Brand

Updates an existing brand.

```http
PATCH /brands/:id
```

**Request Body:**
```json
{
  "name": "Updated Brand Name",
  "description": "Updated description"
}
```

**Response:** `200 OK`
```json
{
  "brand": { ... }
}
```

---

### Delete Brand

Deletes a brand and all associated content.

```http
DELETE /brands/:id
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Brand deleted successfully"
}
```

## Content Management Endpoints

### Generate Content

Generates AI-powered content for a brand.

```http
POST /content/generate
```

**Request Body:**
```json
{
  "brandId": "brand-id",
  "theme": "lifestyle",
  "count": 3
}
```

**Response:** `201 Created`
```json
{
  "content": [
    {
      "id": "content-id",
      "caption": "Generated caption",
      "hashtags": ["#lifestyle", "#inspiration"],
      "imageUrl": "https://postolio.example/images/...",
      "status": "draft"
    }
  ]
}
```

---

### Get Pending Content

Returns content awaiting approval.

```http
GET /content/pending/:brandId
```

**Response:** `200 OK`
```json
{
  "content": [ ... ]
}
```

---

### Approve Content

Approves content for publishing.

```http
POST /content/approve/:contentId
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Content approved"
}
```

---

### Edit Content

Updates content details.

```http
PATCH /content/:contentId/edit
```

**Request Body:**
```json
{
  "caption": "Updated caption",
  "hashtags": ["#new", "#hashtags"]
}
```

**Response:** `200 OK`
```json
{
  "content": { ... }
}
```

## Campaign Management Endpoints

### List Campaigns

Returns all campaigns for a brand.

```http
GET /campaign/:brandId
```

**Response:** `200 OK`
```json
{
  "campaigns": [
    {
      "id": "campaign-id",
      "name": "Holiday Campaign",
      "status": "active",
      "progress": 75,
      "content": [ ... ]
    }
  ]
}
```

---

### Create Campaign

Creates a new campaign.

```http
POST /campaign/create
```

**Request Body:**
```json
{
  "name": "Holiday Campaign",
  "brandId": "brand-id",
  "config": {
    "duration": {
      "start": "2024-12-01",
      "end": "2024-12-31"
    },
    "frequency": "daily",
    "themes": ["holiday", "sale"],
    "style": "festive",
    "postingTime": "10:00",
    "priority": 1
  }
}
```

**Response:** `201 Created`
```json
{
  "campaignId": "campaign-id",
  "message": "Campaign created successfully"
}
```

---

### Start Campaign

Starts campaign execution.

```http
POST /campaign/:campaignId/start
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Campaign started"
}
```

---

### Pause Campaign

Pauses an active campaign.

```http
POST /campaign/:campaignId/pause
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Campaign paused"
}
```

## Instagram Integration Endpoints

### Connect Instagram

Initiates Instagram OAuth flow.

```http
GET /auth/instagram/authorize?brandId=brand-id
```

**Response:** Redirect to Instagram OAuth

---

### Instagram Callback

Handles Instagram OAuth callback.

```http
POST /auth/instagram/callback
```

**Request Body:**
```json
{
  "code": "instagram-auth-code",
  "brandId": "brand-id"
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Instagram connected successfully"
}
```

---

### Get Instagram Profile

Returns connected Instagram profile.

```http
GET /instagram/profile
```

**Query Parameters:**
- `brandId`: Brand ID

**Response:** `200 OK`
```json
{
  "profile": {
    "username": "brand_account",
    "followersCount": 10000,
    "mediaCount": 500,
    "profilePictureUrl": "..."
  }
}
```

---

### Publish to Instagram

Publishes content to Instagram.

```http
POST /instagram/publish
```

**Request Body:**
```json
{
  "contentId": "content-id",
  "publishNow": true
}
```

**Response:** `200 OK`
```json
{
  "success": true,
  "instagramPostId": "instagram-post-id",
  "permalink": "https://instagram.com/p/..."
}
```

## Analytics Endpoints

### Get Analytics Report

Returns comprehensive analytics for a brand.

```http
GET /analytics/report/:brandId
```

**Query Parameters:**
- `startDate`: ISO date string
- `endDate`: ISO date string
- `metrics`: Comma-separated metrics

**Response:** `200 OK`
```json
{
  "analytics": {
    "followers": 10000,
    "engagement": 5.2,
    "reach": 50000,
    "impressions": 100000,
    "posts": [
      {
        "id": "post-id",
        "likes": 500,
        "comments": 50,
        "shares": 20,
        "saves": 30
      }
    ]
  }
}
```

---

### Get Optimal Posting Times

Returns optimal times to post content.

```http
GET /analytics/optimal-times/:brandId
```

**Response:** `200 OK`
```json
{
  "optimalTimes": [
    {
      "dayOfWeek": "Monday",
      "times": ["09:00", "18:00"]
    },
    {
      "dayOfWeek": "Tuesday",
      "times": ["10:00", "19:00"]
    }
  ]
}
```

## Monitoring Endpoints

### Health Check

Returns service health status.

```http
GET /health
```

**Response:** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2024-01-10T10:00:00Z"
}
```

---

### System Metrics

Returns system performance metrics.

```http
GET /monitoring/metrics
```

**Response:** `200 OK`
```json
{
  "metrics": {
    "uptime": 86400,
    "memory": {
      "used": 512000000,
      "total": 1024000000
    },
    "requests": {
      "total": 10000,
      "errors": 10
    }
  }
}
```

## Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication required |
| `INVALID_CREDENTIALS` | Invalid email or password |
| `USER_EXISTS` | User already exists |
| `TOKEN_EXPIRED` | JWT token has expired |
| `TOKEN_INVALID` | Invalid JWT token |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `ACCOUNT_LOCKED` | Account temporarily locked |
| `TWO_FACTOR_REQUIRED` | 2FA verification needed |
| `BRAND_NOT_FOUND` | Brand does not exist |
| `CONTENT_NOT_FOUND` | Content does not exist |
| `INSTAGRAM_NOT_CONNECTED` | Instagram account not connected |
| `INSUFFICIENT_PERMISSIONS` | User lacks required permissions |
| `VALIDATION_ERROR` | Request validation failed |
| `SERVER_ERROR` | Internal server error |

## Webhook Events

Postolio can send webhooks for the following events:

| Event | Description |
|-------|-------------|
| `user.created` | New user registered |
| `user.deleted` | User account deleted |
| `brand.created` | New brand created |
| `content.published` | Content published to Instagram |
| `campaign.completed` | Campaign finished |
| `instagram.disconnected` | Instagram connection lost |

## SDK Examples

### JavaScript/TypeScript

```typescript
import { PostolioClient } from '@postolio/sdk'

const client = new PostolioClient({
  apiKey: 'your-api-key',
  baseUrl: 'https://postolio.example'
})

// Authentication
const { user, token } = await client.auth.login({
  email: 'user@example.com',
  password: 'password'
})

// Brand management
const brands = await client.brands.list()
const newBrand = await client.brands.create({
  name: 'My Brand'
})

// Content generation
const content = await client.content.generate({
  brandId: brand.id,
  theme: 'lifestyle',
  count: 3
})
```

### Python

```python
from postolio import PostolioClient

client = PostolioClient(
    api_key='your-api-key',
    base_url='https://postolio.example'
)

# Authentication
auth = client.auth.login(
    email='user@example.com',
    password='password'
)

# Brand management
brands = client.brands.list()
new_brand = client.brands.create(name='My Brand')

# Content generation
content = client.content.generate(
    brand_id=brand.id,
    theme='lifestyle',
    count=3
)
```

## Support

For API support and questions:
- Documentation: https://postolio.example/api
- Email: api-support@postolio.example
- GitHub: https://github.com/postolio/api-docs

---

Last Updated: January 2025
API Version: 2.0.0