# Facebook OAuth Setup Guide for Postolio

This guide covers setting up Facebook OAuth for user registration/login. Since Postolio already uses Meta App for Instagram integration, you'll use the same app but configure it for Facebook Login.

## Prerequisites
- A Facebook Developer account
- A Meta App (already created if you've set up Instagram integration)

## Step 1: Access Facebook Developers

1. Go to [Facebook Developers](https://developers.facebook.com/)
2. Click "My Apps" in the top navigation
3. Select your existing Postolio app or create a new one

## Step 2: Add Facebook Login Product

1. In your app dashboard, click "Add Product"
2. Find "Facebook Login" and click "Set Up"
3. Choose "Web" as the platform
4. Enter your site URL: `http://localhost:3000` for development

## Step 3: Configure Facebook Login Settings

1. Go to "Facebook Login" → "Settings" in the left sidebar
2. Configure the following:

   **Valid OAuth Redirect URIs:**
   ```
   http://localhost:3000/api/auth/facebook/callback
   http://localhost:5173/api/auth/facebook/callback
   https://localhost:3000/api/auth/facebook/callback
   https://localhost:5173/api/auth/facebook/callback
   ```

3. Enable these settings:
   - Client OAuth Login: **Yes**
   - Web OAuth Login: **Yes**
   - Enforce HTTPS: **No** (for development only)
   - Use Strict Mode for Redirect URIs: **Yes**

4. Save Changes

## Step 4: Configure App Settings

1. Go to "Settings" → "Basic" in the left sidebar
2. Note your:
   - **App ID**: This is your `FACEBOOK_APP_ID`
   - **App Secret**: Click "Show" to reveal (this is your `FACEBOOK_APP_SECRET`)

3. Add App Domains:
   ```
   localhost
   ```

4. Add Platform (if not already added):
   - Click "Add Platform" → "Website"
   - Site URL: `http://localhost:3000`

5. Save Changes

## Step 5: Configure OAuth Scopes

1. Go to "App Review" → "Permissions and Features"
2. Ensure these permissions are enabled for development:
   - `email` - Access user's email
   - `public_profile` - Access user's public profile

Note: These are automatically available in development mode.

## Step 6: Configure Environment Variables

### Backend (.env)
```bash
# Meta App Configuration (same for Instagram and Facebook)
FACEBOOK_APP_ID=your-app-id-here
FACEBOOK_APP_SECRET=your-app-secret-here

# Facebook OAuth specific redirect
FACEBOOK_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/facebook/callback
```

### Frontend (frontend/.env)
```bash
# Facebook App ID (same as backend but without secret)
VITE_FACEBOOK_APP_ID=your-app-id-here
```

## Step 7: Test Configuration

1. Restart both backend and frontend servers
2. Visit the registration or login page
3. You should see "Sign up with Facebook" button
4. Click it to test the OAuth flow

## Development vs Production

### Development Mode
- Works immediately with test users
- No app review required
- Limited to app developers and testers

### Production Mode
1. Complete "Data Use Checkup"
2. Submit for App Review if needed
3. Update redirect URIs with production domain:
   ```
   https://yourdomain.com/api/auth/facebook/callback
   ```
4. Enable "Enforce HTTPS" in Facebook Login settings

## Adding Test Users

1. Go to "Roles" → "Test Users" in your app
2. Click "Add Test Users"
3. Create test accounts for development testing

## Troubleshooting

### "URL Blocked" Error
- Check that redirect URI matches exactly in:
  - Facebook app settings
  - Backend environment variable
  - Frontend code

### "App Not Set Up" Error
- Ensure Facebook Login product is added to your app
- Check that app is not in development mode for production use

### "Invalid OAuth redirect URI"
- URIs must match exactly (including protocol and port)
- Add both http and https variants for local development
- Check for trailing slashes

### "Missing Permissions"
- In development: Permissions are auto-granted
- In production: May need app review for extended permissions

## Security Best Practices

1. **Never expose App Secret in frontend code**
2. **Use HTTPS in production**
3. **Implement rate limiting for OAuth endpoints**
4. **Validate the state parameter** (if implementing CSRF protection)
5. **Keep App Secret secure** - rotate if compromised

## Integration with Instagram

Since you're using the same Meta App for both Facebook Login and Instagram Graph API:
- Use the same `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`
- Different redirect URIs for different OAuth flows:
  - Facebook Login: `/api/auth/facebook/callback`
  - Instagram OAuth: `/api/auth/instagram/callback`

## Next Steps

After successful setup:
1. Test login flow with test users
2. Implement account linking for existing users
3. Add profile picture import from Facebook
4. Consider implementing Facebook-based social features