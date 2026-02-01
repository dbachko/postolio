# Authentication Comparison: JWT vs Session Cookies

**Last Reviewed:** January 31, 2026

## Executive Summary

For Postolio's use case (a traditional web application with long-lived user sessions), **session cookies are the superior choice**. This matches what major platforms like Google, Facebook, and Instagram use.

---

## Current State Analysis

### What Postolio Currently Has:

- ✅ JWT-based authentication
- ✅ Refresh token rotation (database-backed)
- ✅ HTTP-only cookies for token storage
- ✅ Automatic refresh in the web app
- ✅ Cookie-only auth flow (no localStorage tokens)
- ❌ Short 1-hour JWT expiration causing frequent logouts (if refresh disabled)

---

## Detailed Comparison

### 1. Session Cookies (What Google/Facebook Use)

#### How It Works:

```
User logs in → Server creates session in DB/Redis → Returns session ID in HTTP-only cookie
Every request → Cookie sent automatically → Server validates session ID → Returns data
User logs out → Server deletes session → Cookie cleared
```

#### Pros:

- ✅ **Instant Revocation**: Delete session from database = immediate logout
- ✅ **Simple Implementation**: No token refresh logic needed
- ✅ **Long-lived Sessions**: Set cookie expiration to 1 year, users stay logged in
- ✅ **"Logout All Devices"**: Easy to implement - just delete all user sessions
- ✅ **Better Security**: Can store sensitive data server-side, not in token
- ✅ **Smaller Payload**: Only session ID travels with each request
- ✅ **CSRF Protection**: Built-in with proper cookie settings
- ✅ **Activity Tracking**: Server knows exactly when user was last active
- ✅ **No Token Expiration Issues**: Session validity controlled entirely server-side

#### Cons:

- ❌ **Database Lookup**: Every request requires a DB/Redis query
- ❌ **Statefulness**: Server must maintain session store
- ❌ **Scalability**: All servers need access to shared session store
- ❌ **CORS Complexity**: Requires careful cookie configuration for cross-origin requests

#### Performance:

- Redis lookup: ~1-5ms per request
- With proper caching and Redis, can handle 10,000+ req/sec per server

---

### 2. JWT (What Postolio Currently Uses)

#### How It Works:

```
User logs in → Server signs JWT with user info → Returns JWT
Every request → JWT sent in header/cookie → Server verifies signature → Returns data
Token expires → Frontend requests refresh → New JWT issued
```

#### Pros:

- ✅ **Stateless**: No database lookup needed for verification
- ✅ **Microservices Friendly**: Each service can verify token independently
- ✅ **Scalability**: No shared session store required
- ✅ **Mobile Apps**: Works great for SPAs and mobile clients
- ✅ **Cross-Domain**: Easier to share authentication across subdomains

#### Cons:

- ❌ **Cannot Revoke**: Once issued, valid until expiration (unless maintaining a blacklist = database lookup anyway)
- ❌ **"Logout All Devices" is Hard**: Need to maintain revocation list or short expiration times
- ❌ **Token Size**: JWT contains user data, larger than session ID (500-1000 bytes vs 32 bytes)
- ❌ **Security Risk if Stolen**: Valid until expiration, no server-side control
- ❌ **Complex Refresh Logic**: Need refresh tokens + rotation + frontend retry logic
- ❌ **Clock Sync Issues**: Token expiration depends on server/client time agreement
- ❌ **Cannot Update Permissions**: User permissions in token can't change until refresh

#### Performance:

- JWT verification: ~0.1-0.5ms per request (faster than DB lookup)
- But requires refresh token flow every 15-60 minutes = additional overhead

---

## Real-World Examples

### Platforms Using Session Cookies:

- **Google**: Session cookies with 1-2 year expiration
- **Facebook**: Session cookies with auto-refresh on activity
- **Instagram**: Session cookies with 1 year expiration
- **Twitter/X**: Session cookies with 30 days expiration
- **LinkedIn**: Session cookies with "remember me" for 1 year
- **Netflix**: Session cookies with persistent login
- **Amazon**: Session cookies with very long expiration

### Why They Choose Sessions:

1. **User Experience**: "Log out all devices" is critical for security
2. **Control**: Can immediately terminate compromised sessions
3. **Simplicity**: No complex token refresh flows
4. **Activity Tracking**: Know exactly when users are active

---

## Best Practices Comparison

### JWT Best Practices:

```javascript
// ❌ Bad: Long-lived JWT
expiresIn: '7d' // Cannot revoke if compromised

// ✅ Good: Short-lived JWT + Refresh Token
accessToken: { expiresIn: '15m' }
refreshToken: { expiresIn: '30d', stored: 'database' }

// But this adds complexity:
- Frontend must handle token refresh
- Need retry logic for expired tokens
- Need refresh token rotation
- Still need database for refresh tokens
```

### Session Cookie Best Practices:

```javascript
// ✅ Simple and secure
cookie: {
  httpOnly: true,      // Prevent XSS
  secure: true,        // HTTPS only
  sameSite: 'lax',     // CSRF protection
  maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
}

// Session management:
- Store in Redis for speed
- Include user ID, roles, last activity
- Extend expiration on each request
- Easy to invalidate anytime
```

---

## Postolio Specific Analysis

### Current Pain Points:

1. **Users logging out after 15 minutes** - JWT expires too fast
2. **Complex refresh logic** - Frontend has multiple strategies to refresh tokens
3. **Token in localStorage (resolved)** - Cookie-only auth now in place
4. **Can't implement "logout all devices"** - Would need JWT blacklist = database anyway

### What Users Expect:

- ✅ Stay logged in for weeks/months (like Google/Facebook)
- ✅ "Remember me" checkbox for persistent login
- ✅ "Logout all devices" for security
- ✅ Instant logout when clicking logout button
- ✅ No weird "token expired" messages

### Database Impact:

**Current (JWT with refresh tokens):**

- Every login: Write refresh token to database
- Every refresh (every 15-60 min): Database query + write
- Database queries: ~100-200 per user per day

**With Sessions:**

- Every login: Write session to Redis
- Every request: Redis lookup (~1ms)
- No refresh needed
- Database queries: Same or fewer

**Verdict**: Negligible performance difference, Redis is extremely fast

---

## Recommendation for Postolio

### Switch to Session Cookies Because:

1. **Better User Experience**
   - Users stay logged in indefinitely (like Google/Facebook)
   - No "token expired" interruptions
   - No complex refresh logic

2. **Better Security**
   - Instant revocation on logout
   - "Logout all devices" feature
   - Can detect suspicious sessions
   - Activity tracking

3. **Simpler Codebase**
   - Remove 280 lines of token refresh logic (`useTokenRefresh.ts`)
   - Remove refresh token rotation complexity
   - LocalStorage token management already removed; keep cookie-only flow
   - No token expiration edge cases

4. **Production Ready**
   - You already have Redis infrastructure
   - Fastify has excellent session support (`@fastify/session`)
   - Proven pattern used by all major platforms

### Migration Effort:

- **Backend**: 4-6 hours (replace JWT plugin with session plugin)
- **Frontend**: 2-3 hours (remove token refresh hook, simplify API client)
- **Testing**: 2-3 hours
- **Total**: 1 developer day

---

## Implementation Comparison

### Current JWT Implementation (Complex):

```typescript
// Backend: 138 lines in auth.ts
- JWT plugin configuration
- Token signing logic
- Refresh token rotation
- Token verification with fallbacks
- Cookie + Bearer token handling

// Frontend: 284 lines in useTokenRefresh.ts
- Token expiration detection
- Scheduled refresh logic
- Visibility change handling
- User activity listeners
- Periodic check intervals
- Retry logic with backoff

// Total: ~500+ lines of auth-specific code
```

### Proposed Session Implementation (Simple):

```typescript
// Backend: ~50 lines
- Session plugin configuration
- Session creation on login
- Session validation middleware
- Session deletion on logout

// Frontend: ~20 lines
- Login: Store user state
- Logout: Clear user state
- Auth check: Call /api/auth/me
- No refresh logic needed

// Total: ~70 lines of auth-specific code
```

**Code Reduction**: 85% less authentication code

---

## Security Comparison

### JWT Vulnerabilities:

1. **XSS**: If stored in localStorage (pre-Phase 1 issue)
2. **Cannot Revoke**: Compromised token valid until expiration
3. **Token Theft**: If stolen, attacker has access until expiration
4. **Refresh Token Rotation Complexity**: Easy to mess up

### Session Cookie Security:

1. **XSS Protected**: HTTP-only cookies
2. **CSRF Protected**: SameSite attribute + CSRF tokens
3. **Instant Revocation**: Delete session on suspicious activity
4. **IP/User-Agent Validation**: Easy to implement
5. **Activity Monitoring**: Track all session activity

### Both Support:

- ✅ Two-factor authentication
- ✅ "Remember me" functionality
- ✅ Device fingerprinting
- ✅ Rate limiting
- ✅ Audit logging

---

## Performance Benchmark

### JWT Approach:

```
Request Flow:
1. Receive request with JWT (~800 bytes)
2. Verify JWT signature (~0.3ms)
3. Decode payload (~0.1ms)
4. Process request
Total overhead: ~0.4ms per request

Refresh Flow (every 15-60 min):
1. Frontend detects expiration
2. Call /refresh endpoint
3. Database lookup + write (~10ms)
4. Generate new JWT (~0.5ms)
5. Update frontend state
Total: ~15ms every hour
```

### Session Cookie Approach:

```
Request Flow:
1. Receive request with session ID (32 bytes)
2. Redis lookup (~1.5ms with network)
3. Process request
Total overhead: ~1.5ms per request

No refresh needed ever
Activity updates: Async, don't block response
```

**Performance Winner**: JWT by ~1ms per request, but session approach has no refresh overhead and better UX.

---

## Final Verdict

### Choose Sessions If:

- ✅ Building a traditional web application (like Postolio)
- ✅ Need long-lived user sessions (weeks/months)
- ✅ Need "logout all devices" functionality
- ✅ Need instant session revocation
- ✅ Want simpler codebase
- ✅ User experience is priority
- ✅ Have Redis or similar available

### Choose JWT If:

- ✅ Building microservices architecture
- ✅ Need completely stateless backend
- ✅ Building mobile apps with offline support
- ✅ Need to share auth across many independent services
- ✅ Don't need instant revocation
- ✅ Performance is absolute priority (>10k req/sec per server)

### For Postolio:

**Session cookies are the clear winner.** They match the use case, provide better UX, offer better security controls, and simplify the codebase significantly.

---

## Migration Plan

### Phase 1: Backend (4-6 hours)

1. Install `@fastify/session` and `connect-redis`
2. Configure session middleware
3. Replace JWT logic in `/api/auth/*` endpoints
4. Update authentication middleware
5. Add session cleanup job

### Phase 2: Frontend (2-3 hours)

1. Remove `useTokenRefresh.ts` hook
2. Simplify API client (remove refresh logic)
3. Update auth store
4. Remove localStorage token management (done in current web app)

### Phase 3: Testing (2-3 hours)

1. Test login/logout flows
2. Test "remember me" functionality
3. Test session expiration
4. Test concurrent sessions
5. Load testing

### Phase 4: Deployment

1. Deploy backend changes
2. Clear existing user sessions (users need to re-login once)
3. Deploy frontend changes
4. Monitor for issues

---

## Conclusion

While JWT is a valid authentication approach for certain architectures, **session cookies are objectively better for Postolio's use case**. They provide:

- ✅ Better user experience (no unexpected logouts)
- ✅ Better security (instant revocation)
- ✅ Simpler implementation (85% less code)
- ✅ Industry-proven pattern (used by Google, Facebook, Instagram)
- ✅ Better developer experience (less complexity)

The only trade-off is ~1ms additional latency per request for Redis lookup, which is negligible compared to typical API response times (50-200ms).

**Recommendation: Migrate to session cookies.**
