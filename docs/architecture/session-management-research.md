# Session Management Research: Enterprise Best Practices

**Date:** October 2025
**Status:** Research Complete
**Next Steps:** Implementation Planning

## Executive Summary

This document provides comprehensive research on how major platforms (Google, Facebook, Twitter, LinkedIn) implement long-lived user sessions while maintaining enterprise-grade security. The research was conducted to upgrade Postolio's current JWT-only authentication to match industry standards.

### Key Findings

1. **Short-lived access tokens (15 min) + Long-lived refresh tokens (7-90 days)** is the industry standard
2. **Refresh token rotation** with family tracking prevents token theft
3. **HttpOnly cookies** are the gold standard for token storage (prevents XSS)
4. **Device fingerprinting** enables trusted device features and better security
5. **Absolute + Sliding timeouts** provide the right balance of security and UX

### Current Postolio Issues

- ✅ **Good:** Refresh token rotation already implemented
- ✅ **Good:** HttpOnly cookies for refresh tokens
- ❌ **Critical:** Access tokens stored in localStorage (XSS vulnerable)
- ❌ **Critical:** No automatic token refresh (causes 15-min logouts)
- ⚠️ **Important:** No absolute session timeout
- ⚠️ **Important:** No device management UI

---

## 1. How Major Platforms Handle Sessions

### 1.1 Google Workspace/Gmail

**Session Configuration:**

- Default web session: 14 days (configurable from 4 hours to infinite)
- Mobile native apps: Sessions don't expire unless triggered by security events
- Token structure: Firebase ID tokens (1 hour) + refresh tokens

**Security Features:**

- Device-bound tokens (can't be replayed on different devices)
- Risk-based authentication (step-up auth for sensitive operations)
- Continuous access evaluation (real-time session monitoring)

### 1.2 Facebook

**Unique Approach:**

- Single token type (no separate refresh tokens)
- Token exchange mechanism: Short-lived tokens exchanged for long-lived tokens
- Long-lived tokens: No default expiry for Marketing API
- Extended page tokens: Valid indefinitely until password change or permission revocation

**Token Lifecycle:**

```
1. Initial token (1 hour)
   ↓
2. Exchange for long-lived token (60 days)
   ↓
3. Refresh before expiry
   ↓
4. New long-lived token (60 days)
```

### 1.3 Twitter/X

**Session Strategy:**

- OAuth 2.0 with refresh token rotation
- Access tokens: ~2 hours
- Refresh tokens: No expiry (revocable)
- Automatic refresh in background

**Device Management:**

- Full device management UI
- "Active sessions" view with location/device info
- One-click revocation of sessions
- Email alerts for new logins

### 1.4 LinkedIn

**Enterprise Focus:**

- Access tokens: 60 days
- Refresh tokens: 1 year
- Sliding expiration on activity
- Strong device tracking

---

## 2. Technical Implementation Patterns

### 2.1 OAuth 2.0 Refresh Token Flow

**Standard Flow:**

```
┌──────────┐                                         ┌──────────────┐
│          │  1. Login (email + password)            │              │
│          │────────────────────────────────────────>│              │
│          │                                         │              │
│          │  2. Access Token + Refresh Token        │              │
│  Client  │<────────────────────────────────────────│   Server     │
│          │                                         │              │
│          │  3. API Request (Access Token)          │              │
│          │────────────────────────────────────────>│              │
│          │                                         │              │
│          │  4. Access Token Expired (401)          │              │
│          │<────────────────────────────────────────│              │
│          │                                         │              │
│          │  5. Refresh Token                       │              │
│          │────────────────────────────────────────>│              │
│          │                                         │              │
│          │  6. New Access + New Refresh Token      │              │
│          │<────────────────────────────────────────│              │
└──────────┘                                         └──────────────┘
```

**Key Points:**

- Access token is short-lived (15 minutes typical)
- Refresh token is long-lived (7-30 days typical)
- Refresh token is rotated on each use (security best practice)
- Old refresh token is invalidated after rotation

### 2.2 Token Rotation with Family Tracking

**Purpose:** Detect token theft and replay attacks

**Implementation:**

```typescript
interface TokenFamily {
  id: string; // Family identifier
  userId: string;
  currentGeneration: number; // Current token generation
  createdAt: Date;
  maxGenerations: 100; // Limit rotation chains
}

interface RefreshToken {
  token: string;
  family: string; // Links to family
  generation: number; // This token's generation
  userId: string;
  expiresAt: Date;
}

// On token rotation
async function rotateToken(oldToken) {
  const tokenData = await getToken(oldToken);
  const family = await getFamily(tokenData.family);

  // Check for reuse (security breach!)
  if (tokenData.generation !== family.currentGeneration) {
    // ALERT: Token reuse detected!
    await invalidateEntireFamily(family.id);
    await alertSecurity(tokenData.userId);
    return null;
  }

  // Generate new token
  const newToken = generateToken({
    family: tokenData.family,
    generation: tokenData.generation + 1,
    userId: tokenData.userId,
  });

  // Update family
  await updateFamily(family.id, {
    currentGeneration: tokenData.generation + 1,
  });

  // Delete old token
  await deleteToken(oldToken);

  return newToken;
}
```

**Security Benefit:**
If an attacker steals a refresh token and uses it, the legitimate user's next refresh attempt will detect the mismatch and invalidate ALL tokens in that family.

### 2.3 Token Storage Strategies

#### Client-Side Storage Comparison

| Storage Method      | XSS Vulnerable | CSRF Vulnerable | Survives Reload | Best For                    |
| ------------------- | -------------- | --------------- | --------------- | --------------------------- |
| **localStorage**    | ✅ Yes         | ❌ No           | ✅ Yes          | ❌ Never use for tokens     |
| **sessionStorage**  | ✅ Yes         | ❌ No           | ❌ No           | ❌ Never use for tokens     |
| **Memory Only**     | ❌ No          | ❌ No           | ❌ No           | Access tokens (short-lived) |
| **HttpOnly Cookie** | ❌ No          | ✅ Yes\*        | ✅ Yes          | ✅ **Recommended**          |

\*CSRF mitigated with SameSite=Strict + CSRF tokens

**Recommendation:** Use HttpOnly cookies exclusively for both access and refresh tokens.

#### Server-Side Storage

**Refresh Tokens:**

- Store in Redis (fast, distributed, auto-expiration)
- Index by user ID for bulk operations
- Index by family for security checks
- Store metadata (IP, user agent, device fingerprint)

**Sessions:**

- Store in PostgreSQL (persistent, queryable)
- Track device info, location, activity timestamps
- Enable device management features

### 2.4 Automatic Token Refresh

**Client-Side Implementation:**

```typescript
class AuthInterceptor {
  private static refreshInterval: NodeJS.Timer;
  private static readonly REFRESH_FREQUENCY = 12 * 60 * 1000; // 12 min

  static startAutoRefresh() {
    // Refresh every 12 minutes (token expires in 15)
    this.refreshInterval = setInterval(async () => {
      await this.refreshToken();
    }, this.REFRESH_FREQUENCY);

    // Also refresh when tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.refreshIfNeeded();
      }
    });
  }

  private static async refreshToken() {
    try {
      await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // Send HttpOnly cookies
      });
      console.log('Token refreshed');
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
  }
}
```

**Why This Works:**

- Tokens refresh every 12 minutes
- Access token expires in 15 minutes
- 3-minute buffer prevents expiration
- User never sees authentication errors

---

## 3. Security Best Practices

### 3.1 Token Expiration Recommendations

**By Application Type:**

| Application Type      | Access Token | Refresh Token | Absolute Timeout |
| --------------------- | ------------ | ------------- | ---------------- |
| **Banking/Finance**   | 5-10 min     | 7 days        | 4 hours          |
| **Healthcare**        | 10-15 min    | 7-14 days     | 8 hours          |
| **E-commerce**        | 15-30 min    | 14-30 days    | 24 hours         |
| **SaaS/Productivity** | 15-60 min    | 30-90 days    | 7-30 days        |
| **Social Media**      | 30-60 min    | 90-365 days   | None/Long        |

**Recommendation for Postolio (SaaS):**

- Access Token: **15 minutes**
- Refresh Token: **30 days**
- Absolute Timeout: **90 days**
- Sliding Timeout: **30 days inactivity**

### 3.2 Cookie Security Configuration

```typescript
// Production-ready cookie settings
reply.setCookie('auth_token', accessToken, {
  httpOnly: true, // Prevents JavaScript access (XSS protection)
  secure: true, // HTTPS only
  sameSite: 'strict', // CSRF protection
  domain: '.postolio.example', // Subdomain sharing
  path: '/', // All paths
  maxAge: 15 * 60, // 15 minutes
});

reply.setCookie('refresh_token', refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  domain: '.postolio.example',
  path: '/api/auth/refresh', // Restricted path (additional security)
  maxAge: 30 * 24 * 60 * 60, // 30 days
});
```

### 3.3 Device Fingerprinting

**Purpose:** Identify and track devices for:

- Trusted device features
- Suspicious activity detection
- Better user experience (skip 2FA on known devices)

**Implementation:**

```typescript
// Client-side fingerprinting
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const fp = await FingerprintJS.load();
const result = await fp.get();

const deviceFingerprint = {
  visitorId: result.visitorId,
  userAgent: navigator.userAgent,
  screenResolution: `${screen.width}x${screen.height}`,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  language: navigator.language,
  canvas: result.components.canvas.value,
  webgl: result.components.webglVendor.value,
};

// Send to backend on login
await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    email,
    password,
    deviceFingerprint,
  }),
});
```

**Server-Side Storage:**

```prisma
model Session {
  id                String   @id @default(cuid())
  userId            String
  deviceFingerprint String?
  deviceName        String?  // "iPhone 13", "Chrome on Mac"
  trusted           Boolean  @default(false)
  trustedUntil      DateTime?
  // ...
}
```

### 3.4 Absolute vs. Sliding Timeouts

**Absolute Timeout:**

- Maximum session duration (e.g., 90 days)
- Never extends, regardless of activity
- Forces re-authentication after X days

**Sliding Timeout:**

- Extends with each activity (e.g., 30 days)
- Resets on every API call
- Sessions expire after X days of inactivity

**Hybrid Approach (Recommended):**

```typescript
interface Session {
  createdAt: Date; // Never changes
  lastActivityAt: Date; // Updates on each request
  absoluteExpiresAt: Date; // createdAt + 90 days (never extends)
}

async function validateSession(session: Session): Promise<boolean> {
  const now = Date.now();

  // Check absolute timeout
  if (now > session.absoluteExpiresAt.getTime()) {
    return false; // Expired - must re-login
  }

  // Check sliding timeout (30 days inactivity)
  const idleMs = now - session.lastActivityAt.getTime();
  const maxIdleMs = 30 * 24 * 60 * 60 * 1000;

  if (idleMs > maxIdleMs) {
    return false; // Inactive too long
  }

  return true; // Valid session
}
```

---

## 4. User Experience Considerations

### 4.1 "Remember Me" Feature

**Implementation:**

```typescript
// Login with remember me option
interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean; // User checkbox
}

// Adjust refresh token expiry
const refreshTokenExpiry = rememberMe
  ? 30 * 24 * 60 * 60 // 30 days
  : 7 * 24 * 60 * 60; // 7 days

// Also mark device as trusted
if (rememberMe) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      trusted: true,
      trustedUntil: addDays(new Date(), 90),
    },
  });
}
```

### 4.2 Device Management UI

**Features Users Expect:**

1. **View Active Sessions**
   - Device name (editable)
   - Location (approximate)
   - IP address
   - Last activity time
   - Login time
   - Current device indicator

2. **Session Actions**
   - Revoke specific session
   - Revoke all other sessions
   - Rename device

3. **Security Dashboard**
   - Number of active sessions
   - Recent login attempts
   - Suspicious activity alerts
   - Last password change

**Reference: Twitter's Implementation**

Twitter provides excellent UX:

- Clear "Active sessions" page in settings
- Shows browser, OS, location for each session
- "Log out" button for each session
- "Log out of all other sessions" button
- Real-time updates when session revoked

### 4.3 Handling Token Expiration

**User Experience:**

```
Scenario 1: Auto-refresh succeeds
├─ User continues working
├─ No interruption
└─ Token refreshed in background

Scenario 2: Auto-refresh fails (token expired)
├─ Redirect to login page
├─ Show message: "Your session has expired. Please log in again."
├─ Preserve current URL in redirect
└─ After login, redirect back to original URL

Scenario 3: Auto-refresh fails (network error)
├─ Retry with exponential backoff
├─ Show warning: "Connection lost. Retrying..."
└─ If retry succeeds, continue normally
```

---

## 5. Monitoring and Security

### 5.1 Suspicious Activity Detection

**Signals to Monitor:**

1. **Location Changes**
   - Login from new country
   - Impossible travel (e.g., US to China in 1 hour)

2. **Device Changes**
   - New device fingerprint
   - Different browser/OS

3. **Behavioral Anomalies**
   - Rapid token rotation (potential attack)
   - Multiple failed login attempts
   - Login at unusual time

**Implementation:**

```typescript
async function detectSuspiciousActivity(
  userId: string,
  ipAddress: string,
  deviceFingerprint: string
): Promise<SecurityAlert[]> {
  const alerts: SecurityAlert[] = [];

  // Get recent sessions
  const recentSessions = await getRecentSessions(userId);

  // Check for new location
  const knownIPs = recentSessions.map((s) => s.ipAddress);
  if (!knownIPs.includes(ipAddress)) {
    alerts.push({
      type: 'new_location',
      severity: 'medium',
      message: 'Login from new IP address',
    });
  }

  // Check for new device
  const knownDevices = recentSessions.map((s) => s.deviceFingerprint);
  if (!knownDevices.includes(deviceFingerprint)) {
    alerts.push({
      type: 'new_device',
      severity: 'low',
      message: 'Login from new device',
    });
  }

  return alerts;
}
```

### 5.2 Metrics to Track

**CloudWatch Metrics:**

```typescript
const metrics = {
  // Token Usage
  ActiveRefreshTokens: count,
  TokenRotationsPerHour: rate,
  FailedRefreshAttempts: count,

  // Security
  TokenReuseDetections: count,
  SuspiciousLoginAttempts: count,
  SessionRevocations: count,

  // Performance
  TokenRefreshLatency: milliseconds,
  AuthenticationLatency: milliseconds,

  // User Experience
  AverageSessionDuration: hours,
  DevicesPerUser: average,
};
```

---

## 6. Comparison: Current vs. Target State

### Current Postolio Implementation

**What Works Well:**

- ✅ Refresh token rotation with family tracking
- ✅ HttpOnly cookies for refresh tokens
- ✅ Token reuse detection
- ✅ Comprehensive audit logging
- ✅ Redis-based token storage

**Critical Issues:**

- ❌ Access tokens returned in response body
- ❌ Frontend stores tokens in localStorage (XSS vulnerable)
- ❌ No automatic token refresh (causes 15-min logouts)
- ❌ No absolute session timeout
- ❌ Limited device tracking

**Missing Features:**

- ⚠️ No device management UI
- ⚠️ No session activity tracking
- ⚠️ No security dashboard
- ⚠️ No suspicious activity detection

### Target State (Industry Standard)

**Authentication Flow:**

1. User logs in → Receives tokens in HttpOnly cookies only
2. Frontend never sees tokens (no localStorage)
3. Automatic refresh every 12 minutes
4. Sessions last 30 days with activity, max 90 days absolute
5. Full device management in settings
6. Security alerts for suspicious activity

**Token Configuration:**

```typescript
const CONFIG = {
  accessToken: {
    expiresIn: '15m',
    storage: 'httpOnly-cookie',
    autoRefresh: true,
  },
  refreshToken: {
    expiresIn: '30d',
    storage: 'httpOnly-cookie',
    rotation: true,
    familyTracking: true,
  },
  session: {
    absoluteTimeout: '90d',
    slidingTimeout: '30d',
    deviceTracking: true,
  },
};
```

---

## 7. Recommendations

### Immediate (Week 1)

1. **Remove localStorage usage** - Critical XSS vulnerability
2. **Implement automatic token refresh** - Fix 15-min logout issue
3. **Access tokens in cookies only** - Stop returning in response body

### Short-term (Weeks 2-3)

4. **Implement absolute session timeout** - 90 days max
5. **Add device fingerprinting** - Better security
6. **Session tracking database** - Enable device management

### Medium-term (Weeks 4-6)

7. **Device management UI** - User-facing controls
8. **Security dashboard** - Visibility into sessions
9. **Suspicious activity detection** - Proactive security

### Long-term (Optional)

10. **Email alerts for new logins**
11. **"This wasn't me" security flow**
12. **Risk-based authentication**
13. **Compliance reporting**

---

## 8. Resources

### Specifications

- [RFC 6749: OAuth 2.0 Authorization Framework](https://tools.ietf.org/html/rfc6749)
- [RFC 8725: JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

### Libraries

- [@fastify/jwt](https://github.com/fastify/fastify-jwt) - Already in use
- [jose](https://github.com/panva/jose) - Modern JWT library
- [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) - Device fingerprinting

### Articles

- [Auth0: Refresh Token Rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation)
- [Okta: Token Best Practices](https://developer.okta.com/docs/guides/refresh-tokens/main/)
- [Google: Session Management](https://developers.google.com/identity/protocols/oauth2)

---

## Conclusion

Modern session management requires a balance of security and user experience. The research shows that:

1. **Short access tokens + Long refresh tokens** is the proven pattern
2. **Token rotation** with family tracking provides excellent security
3. **HttpOnly cookies** eliminate XSS vulnerabilities
4. **Automatic refresh** provides seamless UX
5. **Device management** gives users control and visibility

Postolio has a solid foundation with refresh token rotation already implemented. The main gaps are:

- Frontend token storage (critical security issue)
- Automatic refresh mechanism (UX issue)
- Device management features (user empowerment)

Next steps: Create detailed implementation plan with phased rollout strategy.
