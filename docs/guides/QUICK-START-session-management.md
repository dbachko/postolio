# Quick Start: Session Management Upgrade

**Goal:** Verify cookie-only auth and prevent regressions

**Time to verify Phase 1:** ~1 hour

---

## TL;DR

Users were getting logged out every 15 minutes because:

1. Access tokens expire in 15 minutes (good for security)
2. There was no automatic refresh mechanism (bad for UX, now fixed)
3. Access tokens were stored in localStorage (XSS vulnerability, now removed)

**Solution:** Automatic token refresh + HttpOnly cookies (already implemented)

---

## Phase 1: Critical Fixes (Implemented)

### What You'll Get

After Phase 1:

- ✅ Users stay logged in for 30 days
- ✅ No more unexpected logouts
- ✅ XSS vulnerability eliminated
- ✅ Seamless authentication

### Files to Review

```
packages/
├── apps/
│   ├── api/
│   │   └── src/
│   │       └── routes/
│   │           └── auth.ts
│   └── web/
│       └── src/
│           ├── App.tsx
│           ├── lib/
│           │   ├── auth-interceptor.ts
│           │   └── http/
│           │       └── http.ts
│           └── stores/
│               └── authStore.ts
```

### Step-by-Step Instructions

#### Step 1: Backend verification (10 minutes)

- Confirm `packages/apps/api/src/routes/auth.ts` does not return access tokens in JSON responses.
- Confirm `auth_token` and `refresh_token` cookies are HttpOnly and `SameSite=Lax`.
- Confirm `/api/auth/refresh` relies on cookies (no token response body).

#### Step 2: Frontend verification (15 minutes)

- `packages/apps/web/src/lib/http/http.ts` uses `credentials: 'include'` and handles 401 refresh via `AuthInterceptor`.
- `packages/apps/web/src/lib/auth-interceptor.ts` performs refresh without storing auth tokens in localStorage.
- `packages/apps/web/src/stores/authStore.ts` does not read or write auth tokens in localStorage.
- `packages/apps/web/src/App.tsx` starts/stops auto-refresh on mount/unmount.

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

```typescript
// Update cors in packages/apps/api/src/app.ts
fastify.register(cors, {
  origin: 'http://localhost:5173', // dev
  credentials: true, // ✅ Required for cookies
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

After Phase 1 is verified:

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

| File                                            | Purpose        | Notes                        |
| ----------------------------------------------- | -------------- | ---------------------------- |
| `packages/apps/api/src/routes/auth.ts`          | Auth endpoints | No token in response body    |
| `packages/apps/web/src/lib/http/http.ts`        | HTTP client    | `credentials: 'include'`     |
| `packages/apps/web/src/lib/auth-interceptor.ts` | Auto-refresh   | Refresh without localStorage |
| `packages/apps/web/src/stores/authStore.ts`     | Auth state     | No localStorage token access |
| `packages/apps/web/src/App.tsx`                 | App entry      | Starts/stops auto-refresh    |

### Key Concepts

- **Access token:** Short-lived (15 min), in HttpOnly cookie
- **Refresh token:** Long-lived (30 days), also in HttpOnly cookie
- **Auto-refresh:** Runs every 12 minutes in background
- **HttpOnly:** Cookie not accessible to JavaScript (prevents XSS)

### Verification Checklist

- [ ] Backend doesn't return token in response body
- [ ] Frontend doesn't use localStorage
- [ ] Cookies are HttpOnly + Secure + SameSite=Lax
- [ ] Auto-refresh runs every 12 minutes
- [ ] Users stay logged in for 30 days
- [ ] All tests passing

---

## Get Help

- Full research: `docs/architecture/session-management-research.md`
- Implementation plan: `docs/guides/session-management-implementation-plan.md`
- Testing guide: `docs/guides/testing-strategy.md`

**Questions?** Review the full documentation above or check the implementation plan for detailed examples.
