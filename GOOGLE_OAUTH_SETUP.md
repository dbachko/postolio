# Google OAuth Setup Guide for Postolio

## Prerequisites
You need a Google Cloud Console account to set up OAuth 2.0 credentials.

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it "Postolio" (or your preferred name)
4. Click "Create"

## Step 2: Enable Google+ API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google+ API" or "Google Identity"
3. Click on it and press "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" user type (unless you have Google Workspace)
3. Fill in the required fields:
   - App name: `Postolio`
   - User support email: Your email
   - Developer contact: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
5. Add test users if in development
6. Save and continue

## Step 4: Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Choose "Web application" as the application type
4. Name: `Postolio Web Client`
5. Add Authorized JavaScript origins:
   ```
   http://localhost:3000
   http://localhost:5173
   https://localhost:3000
   https://localhost:5173
   ```
6. Add Authorized redirect URIs:
   ```
   http://localhost:3000/api/auth/google/callback
   http://localhost:5173/api/auth/google/callback
   https://localhost:3000/api/auth/google/callback
   https://localhost:5173/api/auth/google/callback
   ```
7. Click "Create"
8. Copy the Client ID and Client Secret

## Step 5: Configure Environment Variables

### Backend (.env)
Add these to your backend `.env` file:
```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
```

### Frontend (frontend/.env)
Add this to your frontend `.env` file:
```bash
# Google OAuth Client ID (same as backend but without secret)
VITE_GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
```

## Step 6: Restart Your Development Servers

After adding the environment variables:

1. Stop both frontend and backend servers (Ctrl+C)
2. Restart the backend:
   ```bash
   npm run dev
   ```
3. Restart the frontend:
   ```bash
   cd frontend && npm run dev
   ```

## Important Notes

- The Client ID is safe to expose in frontend code
- NEVER expose the Client Secret in frontend code
- The Client ID must be the same in both backend and frontend
- Make sure the redirect URIs match exactly (including http/https and port)

## Troubleshooting

### "Missing required parameter: client_id"
- Ensure `VITE_GOOGLE_CLIENT_ID` is set in `frontend/.env`
- Restart the frontend dev server after adding the env variable

### "Redirect URI mismatch"
- Check that your redirect URI in Google Console matches exactly
- Include both http and https variants for local development

### "Invalid client"
- Verify the Client ID is correct (ends with `.apps.googleusercontent.com`)
- Ensure the Client Secret is only in backend, not frontend

## Production Setup

For production, add your production domain to:
- Authorized JavaScript origins: `https://yourdomain.com`
- Authorized redirect URIs: `https://yourdomain.com/api/auth/google/callback`