# Quick Start: Session Management Upgrade

**Goal:** Fix the "logged out every 15 minutes" issue and improve security

**Time to implement Phase 1:** ~2 days

---

## TL;DR

Your users get logged out every 15 minutes because:

1. Access tokens expire in 15 minutes (good for security)
2. There's no automatic refresh mechanism (bad for UX)
3. Tokens are stored in localStorage (XSS vulnerability)

**Solution:** Implement automatic token refresh + HttpOnly cookies

---

## Phase 1: Critical Fixes (Start Here!)

### What You'll Get

After Phase 1:

- ✅ Users stay logged in for 30 days
- ✅ No more unexpected logouts
- ✅ XSS vulnerability eliminated
- ✅ Seamless authentication

### Files You'll Change

```
packages/
├── apps/
│   ├── api/
│   │   └── src/
│   │       └── routes/
│   │           └── auth.ts (3 changes)
│   └── web/
│       └── src/
│           ├── lib/
│           │   ├── api.ts (major refactor)
│           │   └── auth-interceptor.ts (NEW FILE)
│           ├── stores/
│           │   └── authStore.ts (cleanup)
│           └── main.tsx (add 1 line)
```

### Step-by-Step Instructions

#### Step 1: Backend Changes (30 minutes)

**File:** `packages/apps/api/src/routes/auth.ts`

Find these 3 locations and remove `token` from response:

```typescript
// Location 1: ~line 120 (register)
// Location 2: ~line 307 (login)
// Location 3: ~line 355 (refresh)

// CHANGE THIS:
return reply.code(201).send({
  token: accessToken, // ❌ DELETE THIS LINE
  user,
});

// TO THIS:
return reply.code(201).send({
  user,
  message: 'Login successful',
});
```

Also update cookie settings (all 3 locations):

```typescript
// Change sameSite from 'lax' to 'strict'
reply.setCookie('auth_token', accessToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict', // ✅ Change this
  // ... rest stays the same
});
```

**Test it:**

```bash
cd packages/apps/api
pnpm dev

# In another terminal:
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}' \
  -v | jq

# Verify: No "token" field in response
# Verify: "Set-Cookie" header in response
```

#### Step 2: Frontend Changes (1 hour)

**A. Create auto-refresh interceptor:**

```bash
# Create new file
touch packages/apps/web/src/lib/auth-interceptor.ts
```

Copy this code into the new file:

```typescript
import { apiClient } from './api';

export class AuthInterceptor {
  private static refreshTimer: NodeJS.Timeout | null = null;

  static startAutoRefresh() {
    console.log('[Auth] Auto-refresh enabled');

    // Refresh every 12 minutes (tokens expire in 15)
    this.refreshTimer = setInterval(
      async () => {
        try {
          await apiClient.refreshToken();
          console.log('[Auth] Token refreshed');
        } catch (error) {
          console.error('[Auth] Refresh failed:', error);
        }
      },
      12 * 60 * 1000
    );
  }

  static stopAutoRefresh() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }
}
```

**B. Update API client:**

File: `packages/apps/web/src/lib/api.ts`

Find the `request` method and update it:

```typescript
private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',  // ✅ ADD THIS - critical for cookies!
  });

  // Handle 401 errors
  if (response.status === 401 && endpoint !== '/api/auth/refresh') {
    // Try to refresh token
    const refreshed = await this.refreshToken().catch(() => false);
    if (refreshed) {
      // Retry original request
      return this.request(endpoint, options);
    }
    // Redirect to login
    window.location.href = '/login';
  }

  return response.json();
}
```

**Remove localStorage code:**

In the same file, find and delete:

```typescript
// DELETE these methods:
constructor() {
  this.token = localStorage.getItem('auth_token');  // ❌ DELETE
}

setToken(token: string) {
  this.token = token;  // ❌ DELETE
  localStorage.setItem('auth_token', token);  // ❌ DELETE
}

// In request method, DELETE this:
if (this.token) {
  headers.Authorization = `Bearer ${this.token}`;  // ❌ DELETE
}
```

**C. Update auth store:**

File: `packages/apps/web/src/stores/authStore.ts`

```typescript
// Remove localStorage references:

// BEFORE:
checkAuth: async () => {
  const token = localStorage.getItem('auth_token'); // ❌ DELETE
  if (!token) return;
  // ...
};

// AFTER:
checkAuth: async () => {
  try {
    const response = await apiClient.getProfile();
    set({ user: response.user, isAuthenticated: true });
  } catch {
    set({ user: null, isAuthenticated: false });
  }
};
```

**D. Initialize auto-refresh:**

File: `packages/apps/web/src/main.tsx`

Add one line:

```typescript
import { AuthInterceptor } from './lib/auth-interceptor';

// Add this before ReactDOM.render:
AuthInterceptor.startAutoRefresh();

ReactDOM.createRoot(document.getElementById('root')!)
  .render
  // ... rest of code
  ();
```

#### Step 3: Test It (30 minutes)

```bash
# Start backend
cd packages/apps/api
pnpm dev

# Start frontend (in another terminal)
cd packages/apps/web
pnpm dev
```

**Manual test:**

1. Go to http://localhost:5173
2. Login
3. Open browser DevTools → Application → Cookies
4. Verify you see `auth_token` and `refresh_token` cookies
5. Verify localStorage does NOT have `auth_token`
6. Wait 13 minutes
7. Check Console - should see "Token refreshed"
8. Navigate around - should still work!

**Automated test:**

```bash
cd packages/apps/api
pnpm test test/phase1-security.test.ts
```

#### Step 4: Deploy (1 hour)

```bash
# Build and deploy API
cd packages/apps/api
pnpm build
pnpm --filter=cdk deploy API-dev

# Build and deploy Web
cd packages/apps/web
pnpm build
pnpm --filter=cdk deploy Web-dev

# Verify
curl https://postolio.example/health
```

---

## Troubleshooting

### Issue: Still getting logged out after 15 minutes

**Cause:** Auto-refresh not working

**Fix:**

1. Check browser console for refresh errors
2. Verify `credentials: 'include'` in fetch calls
3. Check CORS settings allow credentials

### Issue: Cookies not being set

**Cause:** Domain mismatch or CORS issue

**Fix:**

```bash
# Check .env
COOKIE_DOMAIN=localhost  # dev
# COOKIE_DOMAIN=.postolio.example  # prod

# Update cors in api/src/app.ts
fastify.register(cors, {
  origin: 'http://localhost:5173',  # dev
  credentials: true,  # ✅ Required for cookies
});
```

### Issue: 401 errors on API calls

**Cause:** Cookies not being sent

**Fix:**
Make sure ALL fetch calls have `credentials: 'include'`:

```typescript
fetch('/api/brands', {
  credentials: 'include', // ✅ Add this
});
```

---

## What's Next?

After Phase 1 is working:

### Phase 2: Enhanced Security (optional but recommended)

- Absolute session timeout (90 days max)
- Device fingerprinting
- Better session tracking

### Phase 3: Device Management UI (nice to have)

- View active devices
- Revoke sessions
- Security dashboard

See full plan: `docs/guides/session-management-implementation-plan.md`

---

## Quick Reference

### Key Files

| File                              | Purpose        | Changes                      |
| --------------------------------- | -------------- | ---------------------------- |
| `api/src/routes/auth.ts`          | Auth endpoints | Remove token from response   |
| `web/src/lib/api.ts`              | API client     | Add `credentials: 'include'` |
| `web/src/lib/auth-interceptor.ts` | Auto-refresh   | NEW FILE                     |
| `web/src/main.tsx`                | App entry      | Call `startAutoRefresh()`    |

### Key Concepts

- **Access token:** Short-lived (15 min), in HttpOnly cookie
- **Refresh token:** Long-lived (30 days), also in HttpOnly cookie
- **Auto-refresh:** Runs every 12 minutes in background
- **HttpOnly:** Cookie not accessible to JavaScript (prevents XSS)

### Verification Checklist

- [ ] Backend doesn't return token in response body
- [ ] Frontend doesn't use localStorage
- [ ] Cookies are HttpOnly + Secure + SameSite=Strict
- [ ] Auto-refresh runs every 12 minutes
- [ ] Users stay logged in for 30 days
- [ ] All tests passing

---

## Get Help

- Full research: `docs/architecture/session-management-research.md`
- Implementation plan: `docs/guides/session-management-implementation-plan.md`
- Testing guide: `docs/guides/testing-strategy.md`

**Questions?** Review the full documentation above or check the implementation plan for detailed examples.
