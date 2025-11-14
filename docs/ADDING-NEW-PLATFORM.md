# Adding a New Social Network to Postolio

This guide shows how to add a new social network platform to Postolio after the extensibility refactoring is complete. Thanks to the platform-agnostic architecture, adding a new platform is straightforward and takes approximately 2-3 days.

## Prerequisites

Before adding a new platform, ensure you have:

- ✅ Platform API credentials (OAuth app ID and secret)
- ✅ Understanding of the platform's OAuth 2.0 flow
- ✅ Platform API documentation
- ✅ Test account for the platform
- ✅ Completed the extensibility refactoring (see `REFACTORING-PLAN.md`)

## Overview

Adding a new platform involves 4 main steps:

1. **Implement the Connector** (4-6 hours) - Integrate with platform's API
2. **Add OAuth Flow** (2-3 hours) - Handle user authentication
3. **Configure UI** (30 minutes) - Add platform branding and icons
4. **Enable Platform** (5 minutes) - Turn on the feature

**Total Time: ~2-3 days**

---

## Step 1: Implement the Platform Connector (4-6 hours)

### 1.1 Create Connector File

Create a new file in the shared connectors library:  
`packages/libs/connectors/src/platforms/{platform}.ts`

Example for LinkedIn:

```typescript
import {
  Connector,
  PublishRequest,
  PublishResult,
  Credentials,
  SocialAccount,
  ListPostsResult,
  AccountMetrics,
  MediaMetrics,
} from '@postolio/connectors';

export class LinkedInConnector implements Connector {
  readonly platform = 'linkedin' as const;

  readonly capabilities = {
    publishing: true,
    scheduling: true,
    analytics: true,
    comments: false,
    directMessages: false,
  };

  /**
   * Publish content to LinkedIn
   */
  async publish(request: PublishRequest, creds: Credentials): Promise<PublishResult> {
    try {
      // 1. Prepare the post content
      const ugcPost = {
        author: `urn:li:person:${creds.userId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: this.formatCaption(request.caption, request.hashtags),
            },
            shareMediaCategory: request.imageUrl ? 'IMAGE' : 'NONE',
            ...(request.imageUrl && {
              media: [
                {
                  status: 'READY',
                  description: { text: request.caption },
                  media: request.imageUrl,
                  title: { text: 'Post' },
                },
              ],
            }),
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      // 2. Make API request
      const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcPost),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`LinkedIn API error: ${error.message}`);
      }

      const data = await response.json();

      // 3. Return standardized result
      return {
        platform: 'linkedin',
        postId: data.id,
        permalink: `https://www.linkedin.com/feed/update/${data.id}`,
        publishedAt: new Date().toISOString(),
        metrics: {
          impressions: 0,
          likes: 0,
          comments: 0,
          shares: 0,
        },
      };
    } catch (error) {
      // Map LinkedIn errors to platform error codes
      throw mapLinkedInError(error);
    }
  }

  /**
   * List recent posts from LinkedIn
   */
  async listRecentPosts(
    creds: Credentials,
    account: SocialAccount,
    limit: number = 25,
    cursor?: string
  ): Promise<ListPostsResult> {
    try {
      const params = new URLSearchParams({
        author: `urn:li:person:${account.externalAccountId}`,
        count: limit.toString(),
        ...(cursor && { start: cursor }),
      });

      const response = await fetch(`https://api.linkedin.com/v2/ugcPosts?${params}`, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      const data = await response.json();

      return {
        posts: data.elements.map((post) => ({
          id: post.id,
          caption:
            post.specificContent['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '',
          mediaUrl: post.specificContent['com.linkedin.ugc.ShareContent']?.media?.[0]?.media,
          permalink: `https://www.linkedin.com/feed/update/${post.id}`,
          publishedAt: new Date(post.created.time).toISOString(),
          metrics: {
            likes: post.numLikes || 0,
            comments: post.numComments || 0,
            shares: post.numShares || 0,
          },
        })),
        cursor: data.paging?.start?.toString(),
        hasMore: data.paging?.count > 0,
      };
    } catch (error) {
      throw mapLinkedInError(error);
    }
  }

  /**
   * Get account-level insights
   */
  async getAccountInsights(
    creds: Credentials,
    account: SocialAccount,
    window?: { start: string; end: string }
  ): Promise<AccountMetrics> {
    // LinkedIn doesn't provide comprehensive account-level analytics via API
    // This would require LinkedIn Marketing API access
    return {
      followers: 0,
      impressions: 0,
      reach: 0,
      engagement: 0,
      profileViews: 0,
    };
  }

  /**
   * Get post-level insights
   */
  async getMediaInsights(
    creds: Credentials,
    account: SocialAccount,
    mediaId: string
  ): Promise<MediaMetrics> {
    try {
      // Note: Detailed analytics require LinkedIn Marketing API
      // This is a simplified version using public UGC API
      const response = await fetch(`https://api.linkedin.com/v2/ugcPosts/${mediaId}`, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
        },
      });

      const data = await response.json();

      return {
        impressions: 0, // Not available in UGC API
        reach: 0,
        likes: data.numLikes || 0,
        comments: data.numComments || 0,
        shares: data.numShares || 0,
        engagement: data.numLikes + data.numComments + data.numShares || 0,
        saves: 0,
      };
    } catch (error) {
      throw mapLinkedInError(error);
    }
  }

  /**
   * Format caption with hashtags (LinkedIn-specific formatting)
   */
  private formatCaption(caption: string, hashtags: string[] = []): string {
    const maxHashtags = 10; // LinkedIn recommendation
    const limitedHashtags = hashtags.slice(0, maxHashtags);

    if (limitedHashtags.length === 0) {
      return caption;
    }

    const formattedHashtags = limitedHashtags
      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
      .join(' ');

    return `${caption}\n\n${formattedHashtags}`;
  }
}
```

### 1.2 Register Connector in Factory

Edit: `packages/apps/api/src/services/connectors/connector-factory.ts`

```typescript
import type { Connector, PlatformName } from '@postolio/connectors';
import { InstagramConnector, LinkedInConnector } from '@postolio/connectors'; // ADD platform here

export class ConnectorFactory {
  private static connectors: Map<PlatformName, Connector> = new Map([
    ['instagram', new InstagramConnector()],
    ['linkedin', new LinkedInConnector()], // ADD THIS
  ]);

  // ... rest of the factory code
}
```

### 1.3 Add Platform Error Mapping

If not already present, add platform-specific error mapping to:
`packages/libs/errors/src/error-mappers.ts`

The file already has templates for common platforms, but you may need to adjust error codes based on the platform's API documentation.

---

## Step 2: Add OAuth Flow (2-3 hours)

### 2.1 Create OAuth Route

Create: `packages/apps/api/src/routes/oauth/{platform}-oauth.ts`

Example for LinkedIn:

```typescript
import { FastifyInstance } from 'fastify';
import { prisma } from '@postolio/database';
import { storeTokens } from '../services/token-service-client';

export async function linkedInOAuthRoutes(app: FastifyInstance) {
  /**
   * Step 1: Redirect user to LinkedIn authorization
   */
  app.get('/api/oauth/linkedin/authorize', async (req, reply) => {
    const { brandId } = req.query as { brandId: string };

    // Validate brand belongs to user
    const brand = await prisma.brand.findFirst({
      where: {
        id: brandId,
        userId: req.user.id, // Assumes authentication middleware
      },
    });

    if (!brand) {
      return reply.code(404).send({ error: 'Brand not found' });
    }

    // Generate LinkedIn OAuth URL
    const authUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID!);
    authUrl.searchParams.set('redirect_uri', process.env.LINKEDIN_REDIRECT_URI!);
    authUrl.searchParams.set('state', brandId); // Pass brandId for callback
    authUrl.searchParams.set('scope', 'w_member_social r_basicprofile r_organization_social');

    return reply.redirect(authUrl.toString());
  });

  /**
   * Step 2: Handle OAuth callback from LinkedIn
   */
  app.get('/api/oauth/linkedin/callback', async (req, reply) => {
    const {
      code,
      state: brandId,
      error: oauthError,
    } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };

    // Handle OAuth errors
    if (oauthError) {
      return reply.redirect(
        `${process.env.FRONTEND_URL}/brands/${brandId}?error=oauth_${oauthError}`
      );
    }

    if (!code || !brandId) {
      return reply.redirect(`${process.env.FRONTEND_URL}/brands/${brandId}?error=missing_params`);
    }

    try {
      // Exchange authorization code for access token
      const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
          redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange code for token');
      }

      const tokens = await tokenResponse.json();

      // Get user profile info
      const profileResponse = await fetch('https://api.linkedin.com/v2/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      const profile = await profileResponse.json();

      // Get user ID from token service (requires authenticated user)
      const brand = await prisma.brand.findUnique({
        where: { id: brandId },
        select: { userId: true },
      });

      // Create or update SocialAccount
      await prisma.socialAccount.upsert({
        where: {
          brandId_platform: {
            brandId,
            platform: 'linkedin',
          },
        },
        create: {
          brandId,
          platform: 'linkedin',
          externalAccountId: profile.id,
          username: profile.vanityName || profile.id,
          displayName: `${profile.localizedFirstName} ${profile.localizedLastName}`,
          metadata: profile,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        update: {
          externalAccountId: profile.id,
          username: profile.vanityName || profile.id,
          displayName: `${profile.localizedFirstName} ${profile.localizedLastName}`,
          metadata: profile,
          updatedAt: new Date(),
        },
      });

      // Store tokens in token-service
      await storeTokens(brand!.userId, 'linkedin', brandId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });

      // Redirect back to frontend with success
      return reply.redirect(`${process.env.FRONTEND_URL}/brands/${brandId}?connected=linkedin`);
    } catch (error) {
      console.error('LinkedIn OAuth error:', error);
      return reply.redirect(`${process.env.FRONTEND_URL}/brands/${brandId}?error=oauth_failed`);
    }
  });
}
```

### 2.2 Register OAuth Routes

Edit: `packages/apps/api/src/app.ts`

```typescript
import { instagramOAuthRoutes } from './routes/oauth/instagram-oauth';
import { linkedInOAuthRoutes } from './routes/oauth/linkedin-oauth'; // ADD THIS

export async function buildApp() {
  const app = fastify();

  // ... other routes

  await app.register(instagramOAuthRoutes);
  await app.register(linkedInOAuthRoutes); // ADD THIS

  return app;
}
```

### 2.3 Add Environment Variables

Edit: `.env.example` and your `.env` file

```bash
# LinkedIn OAuth
LINKEDIN_CLIENT_ID=your_client_id_here
LINKEDIN_CLIENT_SECRET=your_client_secret_here
LINKEDIN_REDIRECT_URI=http://localhost:3000/api/oauth/linkedin/callback
```

For production:

```bash
LINKEDIN_REDIRECT_URI=https://postolio.example/api/oauth/linkedin/callback
```

---

## Step 3: Configure UI (30 minutes)

### 3.1 Add Platform Configuration

Edit: `packages/apps/web/src/components/social/platform-config.ts`

```typescript
import { InstagramIcon, LinkedInIcon } from 'lucide-react'; // ADD LinkedInIcon

export const PLATFORM_CONFIG = {
  instagram: {
    name: 'Instagram',
    icon: InstagramIcon,
    color: 'from-purple-500 to-pink-500',
    description: 'Share photos and videos with your Instagram followers',
  },

  // ADD THIS
  linkedin: {
    name: 'LinkedIn',
    icon: LinkedInIcon,
    color: 'from-blue-700 to-blue-800',
    description: 'Share professional content with your LinkedIn network',
  },
};
```

### 3.2 Add Platform to Type Definitions

Edit: `packages/apps/web/src/types/platform.ts` (create if doesn't exist)

```typescript
export type Platform = 'instagram' | 'linkedin'; // ADD THIS
// | 'facebook'
// | 'x'
```

### 3.3 Add Platform Icon Asset

If using custom icons:

1. Add icon SVG to `packages/apps/web/public/icons/linkedin.svg`
2. Or use icon library (lucide-react, react-icons, etc.)

---

## Step 4: Enable Platform (5 minutes)

### 4.1 Add to Platform Registry

Create/Edit: `packages/libs/platform-registry/src/index.ts`

```typescript
export const PLATFORM_REGISTRY: Record<Platform, PlatformConfig> = {
  instagram: {
    id: 'instagram',
    name: 'Instagram',
    enabled: true,
    oauthImplemented: true,
    publishingImplemented: true,
    analyticsImplemented: true,
    capabilities: {
      feed: true,
      stories: true,
      reels: true,
      carousel: true,
      video: true,
    },
  },

  // ADD THIS
  linkedin: {
    id: 'linkedin',
    name: 'LinkedIn',
    enabled: true, // Set to true when ready for production
    oauthImplemented: true,
    publishingImplemented: true,
    analyticsImplemented: false, // Limited analytics in free tier
    capabilities: {
      feed: true,
      stories: false,
      reels: false,
      carousel: false,
      video: true,
    },
  },
};
```

### 4.2 Update CDK (if needed)

If the platform needs specific infrastructure:

Edit: `packages/infra/cdk/lib/stacks/auth-stack.ts`

Add environment variables for OAuth:

```typescript
const oauthSecrets = {
  INSTAGRAM_APP_ID: Secret.fromSecretNameV2(this, 'InstagramAppId', 'instagram-app-id'),
  INSTAGRAM_APP_SECRET: Secret.fromSecretNameV2(this, 'InstagramAppSecret', 'instagram-app-secret'),

  // ADD THIS
  LINKEDIN_CLIENT_ID: Secret.fromSecretNameV2(this, 'LinkedInClientId', 'linkedin-client-id'),
  LINKEDIN_CLIENT_SECRET: Secret.fromSecretNameV2(
    this,
    'LinkedInClientSecret',
    'linkedin-client-secret'
  ),
};
```

---

## Step 5: Testing (2-4 hours)

### 5.1 Unit Tests

Create: `packages/apps/api/src/services/connectors/__tests__/linkedin-connector.test.ts`

```typescript
import { LinkedInConnector } from '../linkedin-connector';
import { rest } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  rest.post('https://api.linkedin.com/v2/ugcPosts', (req, res, ctx) => {
    return res(
      ctx.json({
        id: 'urn:li:share:mock123',
        created: { time: Date.now() },
      })
    );
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('LinkedInConnector', () => {
  const connector = new LinkedInConnector();

  it('should publish post successfully', async () => {
    const result = await connector.publish(
      {
        caption: 'Test post',
        hashtags: ['test', 'linkedin'],
        imageUrl: 'https://example.com/image.jpg',
      },
      {
        accessToken: 'mock_token',
        userId: 'mock_user_id',
      }
    );

    expect(result.platform).toBe('linkedin');
    expect(result.postId).toBeDefined();
    expect(result.permalink).toContain('linkedin.com');
  });

  it('should list recent posts', async () => {
    server.use(
      rest.get('https://api.linkedin.com/v2/ugcPosts', (req, res, ctx) => {
        return res(
          ctx.json({
            elements: [
              {
                id: 'urn:li:share:123',
                specificContent: {
                  'com.linkedin.ugc.ShareContent': {
                    shareCommentary: { text: 'Test post' },
                  },
                },
                created: { time: Date.now() },
              },
            ],
            paging: { count: 1 },
          })
        );
      })
    );

    const result = await connector.listRecentPosts(
      { accessToken: 'mock_token' },
      { externalAccountId: 'mock_user' }
    );

    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].caption).toBe('Test post');
  });
});
```

### 5.2 Integration Testing

Manual testing checklist:

```markdown
- [ ] OAuth Flow
  - [ ] Click "Connect LinkedIn" button
  - [ ] Redirected to LinkedIn login
  - [ ] Grant permissions
  - [ ] Redirected back to app with success message
  - [ ] SocialAccount created in database
  - [ ] Tokens stored in token-service

- [ ] Publishing
  - [ ] Create content with caption and hashtags
  - [ ] Select LinkedIn as platform
  - [ ] Publish content
  - [ ] Verify post appears on LinkedIn
  - [ ] ContentPublication record created
  - [ ] Permalink works

- [ ] Syncing
  - [ ] Trigger post sync
  - [ ] Recent LinkedIn posts imported
  - [ ] ContentPublication records created for imported posts
  - [ ] Analytics/metrics populated

- [ ] Analytics
  - [ ] View post details
  - [ ] Metrics displayed (likes, comments, shares)
  - [ ] Metrics refresh correctly

- [ ] Error Handling
  - [ ] Test with invalid token (simulate expiration)
  - [ ] Test with rate limit exceeded
  - [ ] Error messages shown to user
  - [ ] Retry logic works correctly

- [ ] Disconnection
  - [ ] Click "Disconnect LinkedIn"
  - [ ] SocialAccount deleted
  - [ ] Tokens removed
  - [ ] Can reconnect successfully
```

---

## Step 6: Documentation

### 6.1 Update API Documentation

Add LinkedIn endpoints to API docs:

```markdown
## LinkedIn Endpoints

### Connect Account

\`\`\`
GET /api/oauth/linkedin/authorize?brandId={brandId}
\`\`\`

### Get Connection Status

\`\`\`
GET /api/social/linkedin/status/{brandId}
\`\`\`

### Publish to LinkedIn

\`\`\`
POST /api/social/linkedin/publish/{contentId}
\`\`\`

### Sync LinkedIn Posts

\`\`\`
POST /api/social/linkedin/sync/{brandId}
\`\`\`
```

### 6.2 Update User Documentation

Add to user-facing docs:

```markdown
## Connecting Your LinkedIn Account

1. Navigate to **Settings > Connected Accounts**
2. Click **Connect LinkedIn**
3. Log in to LinkedIn and grant permissions
4. You'll be redirected back to Postolio

Your LinkedIn account is now connected and ready to use!
```

---

## Common Pitfalls & Solutions

### Pitfall 1: OAuth Redirect URI Mismatch

**Problem**: OAuth callback fails with redirect_uri mismatch

**Solution**: Ensure redirect URI in code matches **exactly** what's registered in platform's developer portal:

- Protocol (http vs https)
- Port number (if local development)
- Path (/api/oauth/linkedin/callback)

### Pitfall 2: Token Expiration Not Handled

**Problem**: Connector fails after token expires

**Solution**: Implement token refresh logic:

```typescript
async function getValidToken(userId: string, platform: string, brandId: string) {
  const tokens = await fetchTokens(userId, platform, brandId);

  if (Date.now() > tokens.expiresAt) {
    // Refresh token
    return await refreshToken(tokens.refreshToken);
  }

  return tokens;
}
```

### Pitfall 3: Platform-Specific Content Format

**Problem**: Post fails due to incorrect content structure

**Solution**: Validate content before publishing:

```typescript
async publish(request: PublishRequest, creds: Credentials) {
  // Validate against platform requirements
  const validation = await validateContentForPlatform(request, 'linkedin');
  if (!validation.valid) {
    throw new ValidationError(validation.errors.join(', '));
  }

  // Proceed with publishing
}
```

### Pitfall 4: Rate Limits Not Respected

**Problem**: Platform API rate limits exceeded

**Solution**: Implement rate limiting in connector:

```typescript
async publish(request: PublishRequest, creds: Credentials) {
  // Check rate limit before making request
  const rateLimit = await checkRateLimit('linkedin', creds.userId);
  if (!rateLimit.allowed) {
    throw new RateLimitError(`Retry after ${rateLimit.retryAfter} seconds`);
  }

  // Make API request
}
```

### Pitfall 5: Error Messages Not User-Friendly

**Problem**: Raw API errors shown to users

**Solution**: Map platform errors to friendly messages:

```typescript
try {
  await connector.publish(request, creds);
} catch (error) {
  const platformError = mapLinkedInError(error);

  // Return user-friendly message
  if (platformError.code === 'LI_429') {
    throw new Error('LinkedIn posting limit reached. Please try again in 24 hours.');
  }
}
```

---

## Platform-Specific Considerations

### LinkedIn Specifics

**API Limitations**:

- Free tier: Limited analytics
- Posts: 3000 character limit
- Hashtags: 10 recommended (not enforced)
- Daily quota: 500 API calls/day for the entire app

**Best Practices**:

- Use UGC Posts API for personal profiles
- Use Organization API for company pages
- Request Marketing API access for advanced analytics

### Facebook Specifics

**API Limitations**:

- Requires page access token (not user token)
- Must request `pages_manage_posts` permission
- Graph API version changes frequently

**Best Practices**:

- Use Graph API v21.0 (latest)
- Implement webhook for real-time updates
- Use batch requests for efficiency

### Twitter/X Specifics

**API Limitations**:

- Requires OAuth 2.0 with PKCE
- 280 character limit strictly enforced
- Rate limits: 50 tweets per 15 minutes

**Best Practices**:

- Implement thread support for long-form content
- Use Twitter API v2 (v1.1 deprecated)
- Handle duplicate tweet detection

### TikTok Specifics

**API Limitations**:

- Daily post limit: 100 posts/day
- Video only (no photos)
- Max 4GB video size, 10 minute duration

**Best Practices**:

- Implement video transcoding
- Use Content Posting API (not Creator Marketplace API)
- Handle async video processing

---

## Deployment

### 1. Deploy Backend

```bash
# Build and test
pnpm build
pnpm test

# Deploy API with new connector
pnpm --filter=cdk deploy API-dev

# Deploy Auth stack with new OAuth secrets
pnpm --filter=cdk deploy Auth-dev
```

### 2. Add Secrets to AWS Secrets Manager

```bash
aws secretsmanager create-secret \
  --name linkedin-client-id \
  --secret-string "your_client_id"

aws secretsmanager create-secret \
  --name linkedin-client-secret \
  --secret-string "your_client_secret"
```

### 3. Deploy Frontend

```bash
# Build frontend with new platform config
pnpm --filter=web build

# Deploy
pnpm --filter=cdk deploy Web-dev
```

### 4. Verify Deployment

```bash
# Test OAuth
curl https://postolio.example/api/oauth/linkedin/authorize?brandId=test

# Test connector
curl -X POST https://postolio.example/api/social/linkedin/status/test \
  -H "Authorization: Bearer $TOKEN"
```

---

## Rollout Strategy

### Alpha (Internal Testing)

1. Enable platform for internal team only
2. Test all features thoroughly
3. Fix critical bugs

### Beta (Limited Users)

1. Invite 20-50 power users
2. Collect feedback
3. Monitor error rates
4. Iterate based on feedback

### General Availability

1. Enable for 10% of users (feature flag)
2. Monitor metrics for 1 week
3. Gradually increase to 50%, then 100%
4. Announce new platform support

---

## Monitoring & Alerts

### Key Metrics to Track

```typescript
// Log these metrics for the new platform
metrics.addMetric(`${platform}PublishSuccess`, MetricUnit.Count, 1);
metrics.addMetric(`${platform}PublishLatency`, MetricUnit.Milliseconds, duration);
metrics.addMetric(`${platform}OAuthSuccess`, MetricUnit.Count, 1);
metrics.addMetric(`${platform}APIErrors`, MetricUnit.Count, 1);
```

### CloudWatch Alarms

Create alarms for:

- Error rate > 5%
- Latency > 2 seconds
- OAuth failures > 10 per hour
- API rate limit hits

---

## Success Criteria

Before marking the platform as "complete", ensure:

✅ **Functionality**

- [ ] OAuth flow works end-to-end
- [ ] Can publish text-only posts
- [ ] Can publish posts with images
- [ ] Can publish posts with videos (if supported)
- [ ] Can sync existing posts
- [ ] Analytics display correctly
- [ ] Can disconnect account

✅ **Error Handling**

- [ ] Token expiration handled
- [ ] Rate limits respected
- [ ] API errors mapped correctly
- [ ] User-friendly error messages

✅ **Testing**

- [ ] Unit tests pass (>85% coverage)
- [ ] Integration tests pass
- [ ] Manual testing complete
- [ ] Load testing complete (if high-traffic)

✅ **Documentation**

- [ ] API documentation updated
- [ ] User guide updated
- [ ] Code comments added
- [ ] Deployment guide updated

✅ **Monitoring**

- [ ] CloudWatch metrics configured
- [ ] Alarms set up
- [ ] Dashboard created
- [ ] Logs searchable

---

## Support & Resources

- **Platform API Docs**:
  - LinkedIn: https://docs.microsoft.com/en-us/linkedin/
  - Facebook: https://developers.facebook.com/docs/
  - Twitter: https://developer.twitter.com/en/docs
  - TikTok: https://developers.tiktok.com/

- **Internal Docs**:
  - Connector Interface: `packages/libs/connectors/src/types.ts`
  - Platform Requirements: `packages/infra/cdk/lib/shared/platform-requirements.ts`
  - Error Codes: `packages/libs/errors/src/platform-errors.ts`

- **Questions?**
  - Slack: #platform-development
  - Email: dev-team@postolio.example

---

## Appendix: Complete Example (LinkedIn)

See the full LinkedIn implementation in this guide for a complete working example covering:

- ✅ Connector implementation
- ✅ OAuth flow
- ✅ UI configuration
- ✅ Error handling
- ✅ Testing

Use this as a template for implementing other platforms.
