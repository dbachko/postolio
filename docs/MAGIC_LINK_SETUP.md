# Magic Link Authentication Setup Guide

## Overview

Magic Link authentication provides a passwordless sign-in experience for your users. Instead of remembering passwords, users receive a secure, time-limited link via email that logs them in directly.

## Prerequisites

1. An SMTP server or email service provider
2. Valid SMTP credentials
3. A "from" email address for sending magic links

## Environment Variables

Add the following environment variables to your `.env` file:

```bash
# SMTP Configuration for Magic Links
SMTP_HOST=smtp.gmail.com              # Your SMTP server host
SMTP_PORT=587                          # SMTP port (587 for TLS, 465 for SSL)
SMTP_SECURE=false                      # true for port 465, false for other ports
SMTP_USER=your-email@gmail.com        # SMTP username/email
SMTP_PASS=your-app-password           # SMTP password or app-specific password
SMTP_FROM="Postolio <noreply@postolio.example>"  # From address for emails

# Frontend URL (for magic link generation)
FRONTEND_URL=http://localhost:5173     # Change to your production URL in production
```

## Email Service Setup

### Option 1: Gmail/Google Workspace

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate an App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" as the app
   - Generate a 16-character app password
   - Use this password as `SMTP_PASS`

3. **Configure your .env**:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
```

### Option 2: SendGrid

1. **Create a SendGrid account** at https://sendgrid.com
2. **Generate an API key** in Settings > API Keys
3. **Configure your .env**:

```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

### Option 3: Amazon SES

1. **Verify your domain** in AWS SES console
2. **Create SMTP credentials** in SES > SMTP Settings
3. **Configure your .env**:

```bash
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-ses-smtp-username
SMTP_PASS=your-ses-smtp-password
```

### Option 4: Mailgun

1. **Create a Mailgun account** at https://mailgun.com
2. **Verify your domain**
3. **Get SMTP credentials** from Domain Settings
4. **Configure your .env**:

```bash
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@your-domain.mailgun.org
SMTP_PASS=your-mailgun-password
```

## Testing Your Configuration

1. **Start the development server**:

```bash
npm run dev
```

2. **Check configuration status**:

```bash
curl http://localhost:3000/api/auth/magic-link/status
```

You should see:

```json
{
  "configured": true,
  "message": "Magic link authentication is available"
}
```

### Logging Fallback (for non-email environments)

If you don't have SMTP/SES configured in a given environment, you can enable a logging fallback so magic links still work. The API will log the magic link URL to the server console instead of sending an email.

- Enable: set `AUTH_MAGIC_LINK_ENABLED=true` in the API environment
- Works regardless of `NODE_ENV`
- Where to find the link: Look in the API terminal output for a block like:

```
[DEV] Magic link email service not configured. Logging link instead.
Email: user@example.com
Mode: signin
Magic link: http://localhost:5173/auth/magic-link?token=...
```

Use that URL to complete the flow during local testing.

3. **Test sending a magic link**:
   - Go to http://localhost:5173/register or http://localhost:5173/login
   - Click "Or sign in with magic link (no password)"
   - Enter your email address
   - Click "Send magic link"
   - Check your email for the magic link
   - Click the link to sign in

## Security Features

### Rate Limiting

- Maximum 5 magic link requests per email per hour
- Prevents abuse and spam

### Token Security

- Tokens are 32-character random strings using nanoid
- Stored in Redis with automatic expiration
- One-time use only (deleted immediately after verification)

### Email Verification

- Magic links automatically verify email addresses
- No separate email verification step needed

### Time Limits

- Magic links expire after 15 minutes
- Expired links return an error message
- Users can request a new link immediately

## User Experience

### Sign Up Flow

1. User enters email address
2. System sends magic link
3. User clicks link in email
4. Account is created (if new) and user is logged in
5. Email is automatically verified

### Sign In Flow

1. User enters email address
2. System sends magic link (only if account exists)
3. User clicks link in email
4. User is logged in immediately

### Security Messages

- Sign-in attempts for non-existent emails show generic success message
- Prevents email enumeration attacks
- All error messages are user-friendly and non-revealing

## Troubleshooting

### Magic Link Not Sending

1. **Check SMTP configuration**:

```bash
# Verify all SMTP variables are set
grep SMTP .env
```

2. **Test SMTP connection**:

```javascript
// Add this test script as test-email.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.log('SMTP Error:', error);
  } else {
    console.log('SMTP Ready');
  }
});
```

### Common Issues

1. **Gmail: "Less secure app" error**
   - Use App Password instead of regular password
   - Enable 2FA first

2. **Port blocked by firewall**
   - Try port 2525 as alternative
   - Check with your hosting provider

3. **Email going to spam**
   - Add SPF/DKIM records to your domain
   - Use a verified sending domain
   - Ensure FROM address matches domain

4. **Redis connection issues**
   - Verify Redis is running: `redis-cli ping`
   - Check REDIS_URL in .env

## Production Considerations

1. **Use a production email service** (SendGrid, SES, Mailgun)
2. **Set up domain authentication** (SPF, DKIM, DMARC)
3. **Monitor email delivery rates**
4. **Implement email templates** for branding
5. **Use HTTPS** for production FRONTEND_URL
6. **Consider backup SMTP providers**
7. **Log email sending attempts** for debugging
8. **Set up bounce/complaint handling**

## API Reference

### Send Magic Link

```http
POST /api/auth/magic-link/send
Content-Type: application/json

{
  "email": "user@example.com",
  "isSignUp": false  // true for registration, false for sign-in
}
```

### Verify Magic Link

```http
POST /api/auth/magic-link/verify
Content-Type: application/json

{
  "token": "32-character-token-from-email"
}
```

### Check Configuration Status

```http
GET /api/auth/magic-link/status
```

## Support

For issues or questions:

1. Check server logs for SMTP errors
2. Verify environment variables are loaded
3. Test with different email providers
4. Contact support with error messages
