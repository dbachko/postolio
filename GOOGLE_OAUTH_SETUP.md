# Google Auth Platform setup (Sign in with Google) for Postolio

This guide updates our setup to the current Google Auth Platform flow. Reference: "Get started with the Google Auth Platform" ([support article](https://support.google.com/cloud/answer/15544987)).

## What we use in Postolio

- Frontend: `@react-oauth/google` renders the Google button and gets an ID token using Google Identity Services.
- Backend: verifies the ID token at `POST /api/auth/google/verify` (see `src/routes/google-oauth.ts`).
- We do NOT use an OAuth redirect/callback flow in this app today.

## Prerequisites

- A Google Cloud account
- Ability to create/manage projects in Google Cloud

## 1) Create or select a Google Cloud project

1. Open the Google Auth Platform overview: <https://console.developers.google.com/auth/overview>
2. Select an existing project or click "New Project", name it (e.g., "Postolio"), and create it.

## 2) Initialize your application in Google Auth Platform

From the Auth Platform overview, click "Get started" and provide:

- Branding: App name (e.g., Postolio) and user support email
- Audience: choose External (unless you're using Google Workspace and want Internal)
- Contact information: add one or more emails to receive important notices

You can come back later to update these under:

- Branding: [Manage OAuth App Branding](https://support.google.com/cloud/answer/15549049)
- Audience: [Manage App Audience](https://support.google.com/cloud/answer/15549945)

## 3) Create an OAuth client (Web)

1. Go to the Clients page ([Manage OAuth Clients](https://support.google.com/cloud/answer/15549257)) and create a new OAuth client (type: Web).
2. Set Authorized JavaScript origins to match where your frontend runs:
   - <http://localhost:5173>
   - <http://localhost:3000>
   - <https://localhost:5173> (only if you run HTTPS locally)
   - <https://localhost:3000> (only if you run HTTPS locally)
3. Redirect URIs: Not required for our current "Sign in with Google" ID token flow.
   - Optional (future): If you later implement the OAuth code flow, add e.g. `http://localhost:3000/api/auth/google/callback`.
4. Save and copy the Client ID and Client Secret.

Notes

- The "Authorized JavaScript origins" must exactly match your frontend scheme, host, and port.
- No APIs need to be enabled for basic Sign in with Google.

## 4) Data Access (scopes)

We only need the basic profile information provided by the ID token (openid, email, profile). You don't need to add sensitive/restricted scopes unless you call other Google APIs. Manage scopes later here if needed: [Manage App Data Access](https://support.google.com/cloud/answer/15549135)

## 5) Verification Center (going to production)

All production apps must complete OAuth app verification, especially if requesting sensitive/restricted scopes. Track status in the Verification Center: <https://support.google.com/cloud/answer/13463073>

- During development, keep the app in testing and add test users if prompted.

## 6) Configure environment variables

### Backend (.env)

Add these to your backend `.env`:

```bash
# Google Auth Platform
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"   # kept server-side; not used for ID token verification
# Optional: only needed if you later use the OAuth code flow
GOOGLE_REDIRECT_URI="http://localhost:3000/api/auth/google/callback"
```

### Frontend (frontend/.env)

Add this to `frontend/.env`:

```bash
# Used by @react-oauth/google
VITE_GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
```

## 7) Restart your dev servers

After setting env vars, restart both:

```fish
# backend (from repo root)
npm run dev

# frontend
cd frontend; npm run dev
```

## Important notes

- Client ID can be exposed in the frontend; Client Secret must remain server-only.
- Our backend verifies tokens at `/api/auth/google/verify`; no callback route is required.
- If you add the OAuth code flow later, ensure redirect URIs match exactly (scheme, host, port, path).

## Troubleshooting

- "Missing required parameter: client_id": ensure `VITE_GOOGLE_CLIENT_ID` is set and restart the frontend.
- "Origin mismatch" or button fails to load: confirm the frontend origin is listed under Authorized JavaScript origins.
- "Invalid client": verify the Client ID ends with `.apps.googleusercontent.com` and matches the one configured in Google.

## Production setup

Add your production domain under Authorized JavaScript origins, e.g.:

- <https://postolio.example>

Optional (only if you implement OAuth code flow in the future):

- Authorized redirect URIs: `https://postolio.example/api/auth/google/callback`
