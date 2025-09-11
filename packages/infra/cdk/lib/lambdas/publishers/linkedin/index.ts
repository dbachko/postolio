import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import axios, { AxiosError } from 'axios';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new KMSClient({});
const eventBridgeClient = new EventBridgeClient({});

const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME!;
const JOB_STATE_TABLE_NAME = process.env.JOB_STATE_TABLE_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;

interface PublishRequest {
  scheduleId: string;
  contentId: string;
  brandId: string;
  userId: string;
  platform: string;
  content: {
    caption: string;
    hashtags: string[];
    mediaUrl?: string;
  };
  metadata?: Record<string, any>;
}

interface LinkedInShareResponse {
  id: string;
  activity: string;
  content?: {
    contentUrl?: string;
  };
}

export const handler = async (event: SQSEvent): Promise<void> => {
  console.log('LinkedIn Publisher Lambda invoked', {
    records: event.Records.length,
  });

  // Process each message
  for (const record of event.Records) {
    try {
      await processMessage(record);
    } catch (error) {
      console.error('Error processing message:', error, {
        messageId: record.messageId,
        body: record.body,
      });

      // Throw error to send message to DLQ after retries
      throw error;
    }
  }
};

async function processMessage(record: SQSRecord): Promise<void> {
  const request: PublishRequest = JSON.parse(record.body);
  console.log('Processing publish request:', request);

  // Create job state entry
  const jobId = `${request.scheduleId}-${Date.now()}`;
  await updateJobState(jobId, 'processing', request);

  try {
    // Get OAuth token
    const token = await getToken(request.userId, request.brandId, 'linkedin');
    if (!token) {
      throw new Error('LinkedIn token not found');
    }

    // Check if token needs refresh
    if (token.needsRefresh && token.refreshToken) {
      const newToken = await refreshLinkedInToken(
        token.refreshToken,
        request.metadata?.clientId,
        request.metadata?.clientSecret
      );
      await storeRefreshedToken(request.userId, request.brandId, newToken);
      token.accessToken = newToken.accessToken;
    }

    // Get LinkedIn person URN from metadata
    const personUrn = request.metadata?.personUrn;
    if (!personUrn) {
      throw new Error('LinkedIn person URN not found in metadata');
    }

    // Publish to LinkedIn
    const result = await publishToLinkedIn(personUrn, token.accessToken, request.content);

    // Update job state with success
    await updateJobState(jobId, 'completed', {
      ...request,
      result,
    });

    // Send success event
    await sendEvent('postolio.publisher.linkedin', 'post.published', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'linkedin',
      postId: result.id,
      activityUrl: result.activity,
      publishedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Publishing failed:', error);

    // Update job state with failure
    await updateJobState(jobId, 'failed', {
      ...request,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    // Send failure event
    await sendEvent('postolio.publisher.linkedin', 'post.failed', {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: 'linkedin',
      error: error instanceof Error ? error.message : 'Unknown error',
      failedAt: new Date().toISOString(),
    });

    throw error;
  }
}

async function getToken(userId: string, brandId: string, platform: string): Promise<any> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TOKEN_TABLE_NAME,
      Key: {
        pk: `${userId}#${platform}`,
        sk: brandId,
      },
    })
  );

  if (!result.Item) {
    return null;
  }

  // Decrypt token
  const accessToken = await decryptData(result.Item.encryptedAccessToken);
  const refreshToken = result.Item.encryptedRefreshToken
    ? await decryptData(result.Item.encryptedRefreshToken)
    : null;

  // Check if token needs refresh (LinkedIn tokens expire after 60 days)
  const expiryTime = result.Item.expiresAt;
  const refreshThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  const needsRefresh = expiryTime < refreshThreshold;

  return {
    accessToken,
    refreshToken,
    expiresAt: result.Item.expiresAt,
    needsRefresh,
  };
}

async function decryptData(encryptedData: string): Promise<string> {
  const result = await kmsClient.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedData, 'base64'),
    })
  );

  return Buffer.from(result.Plaintext!).toString();
}

async function refreshLinkedInToken(
  refreshToken: string,
  clientId?: string,
  clientSecret?: string
): Promise<any> {
  // LinkedIn OAuth 2.0 token refresh
  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn client credentials required for token refresh');
  }

  try {
    const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
      params: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in,
      refreshToken: response.data.refresh_token || refreshToken, // LinkedIn may or may not return new refresh token
    };
  } catch (error) {
    console.error('Token refresh failed:', error);
    throw new Error('Failed to refresh LinkedIn token');
  }
}

async function storeRefreshedToken(userId: string, brandId: string, token: any): Promise<void> {
  // This would normally call back to the Token Service API
  // For now, we'll skip this as it requires more setup
  console.log('Would store refreshed token:', { userId, brandId, token });
}

async function publishToLinkedIn(
  personUrn: string,
  accessToken: string,
  content: PublishRequest['content']
): Promise<LinkedInShareResponse> {
  try {
    const caption = formatCaption(content.caption, content.hashtags);

    // Build LinkedIn share document
    const shareContent: any = {
      author: personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: {
            text: caption,
          },
          shareMediaCategory: content.mediaUrl ? 'IMAGE' : 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };

    // Add media if present
    if (content.mediaUrl) {
      // Step 1: Register image upload
      const registerResponse = await axios.post(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        {
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: personUrn,
            serviceRelationships: [
              {
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent',
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        }
      );

      const uploadUrl =
        registerResponse.data.value.uploadMechanism[
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
        ].uploadUrl;
      const mediaAsset = registerResponse.data.value.asset;

      // Step 2: Upload image to LinkedIn's CDN
      const imageResponse = await axios.get(content.mediaUrl, {
        responseType: 'arraybuffer',
      });
      await axios.put(uploadUrl, imageResponse.data, {
        headers: {
          'Content-Type': 'image/jpeg', // Adjust based on actual image type
        },
      });

      // Step 3: Add media to share content
      shareContent.specificContent['com.linkedin.ugc.ShareContent'].media = [
        {
          status: 'READY',
          description: {
            text: 'Posted via Postolio',
          },
          media: mediaAsset,
          title: {
            text: 'Image',
          },
        },
      ];
    }

    // Step 4: Create the share
    const shareResponse = await axios.post('https://api.linkedin.com/v2/ugcPosts', shareContent, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });

    return {
      id: shareResponse.data.id,
      activity: `https://www.linkedin.com/feed/update/${shareResponse.data.id}`,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      console.error('LinkedIn API error:', {
        status: axiosError.response?.status,
        data: axiosError.response?.data,
      });

      // Handle rate limiting
      if (axiosError.response?.status === 429) {
        throw new Error('LinkedIn API rate limit exceeded');
      }

      // Handle other API errors
      const errorMessage = (axiosError.response?.data as any)?.message || 'LinkedIn API error';
      throw new Error(errorMessage);
    }

    throw error;
  }
}

function formatCaption(caption: string, hashtags: string[]): string {
  // LinkedIn best practices:
  // - Maximum 3,000 characters for posts
  // - Hashtags work but are less important than on Instagram
  // - Focus on professional tone

  const hashtagString = hashtags
    .slice(0, 10) // Limit hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');

  const fullCaption = hashtagString ? `${caption}\n\n${hashtagString}` : caption;

  // Truncate if too long
  if (fullCaption.length > 3000) {
    const truncatedCaption = caption.substring(0, 3000 - hashtagString.length - 7);
    return `${truncatedCaption}...\n\n${hashtagString}`;
  }

  return fullCaption;
}

async function updateJobState(jobId: string, status: string, data: any): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: JOB_STATE_TABLE_NAME,
      Item: {
        jobId,
        status,
        data,
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days TTL
      },
    })
  );
}

async function sendEvent(source: string, detailType: string, detail: any): Promise<void> {
  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify(detail),
          EventBusName: EVENT_BUS_NAME,
        },
      ],
    })
  );
}
