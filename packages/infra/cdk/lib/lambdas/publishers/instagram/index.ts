/**
 * Instagram Publisher Lambda
 * Implements security fixes, validation, circuit breaker, and idempotency
 */

import { SQSEvent, SQSRecord } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { KMSClient, DecryptCommand } from "@aws-sdk/client-kms";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { Tracer } from "@aws-lambda-powertools/tracer";
import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry from "axios-retry";

// Import shared utilities
import {
  PublishRequestSchema,
  PostPublishedEventSchema,
  PostFailedEventSchema,
  validateInput,
  ValidationError,
  type PublishRequest,
} from "../../shared/validation-schemas";
import { TokenRefreshHandler } from "../../shared/token-refresh-handler";
import {
  CircuitBreaker,
  CircuitBreakerFactory,
} from "../../shared/circuit-breaker";
import {
  IdempotencyHandler,
  IdempotencyError,
} from "../../shared/idempotency-handler";

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const kmsClient = new KMSClient({});
const eventBridgeClient = new EventBridgeClient({});

// Initialize observability tools
const logger = new Logger({ serviceName: "instagram-publisher" });
const metrics = new Metrics({
  namespace: "Postolio/Publisher",
  serviceName: "instagram",
});
const tracer = new Tracer({ serviceName: "instagram-publisher" });

// Environment variables
const TOKEN_TABLE_NAME = process.env.TOKEN_TABLE_NAME!;
const JOB_STATE_TABLE_NAME = process.env.JOB_STATE_TABLE_NAME!;
const IDEMPOTENCY_TABLE_NAME = process.env.IDEMPOTENCY_TABLE_NAME!;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;

// Initialize handlers
const tokenRefreshHandler = new TokenRefreshHandler({
  docClient,
  kmsClient,
  eventBridgeClient,
  tokenTableName: TOKEN_TABLE_NAME,
  kmsKeyId: KMS_KEY_ID,
  eventBusName: EVENT_BUS_NAME,
});

const idempotencyHandler = new IdempotencyHandler(docClient, {
  tableName: IDEMPOTENCY_TABLE_NAME,
  ttlSeconds: 86400, // 24 hours
});

// Initialize circuit breakers for Instagram API
const circuitBreakerFactory = new CircuitBreakerFactory();
const instagramApiBreaker = circuitBreakerFactory.getBreaker("instagram-api", {
  failureThreshold: 5,
  resetTimeout: 60000, // 1 minute
  monitoringPeriod: 60000, // 1 minute
});

// Configure axios with retry logic
const axiosInstance: AxiosInstance = axios.create({
  timeout: 25000, // 25 seconds (less than circuit breaker timeout)
});

axiosRetry(axiosInstance, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.response?.status === 429
    ); // Rate limit
  },
  onRetry: (retryCount, error) => {
    logger.warn("Retrying Instagram API request", {
      retryCount,
      error: error.message,
    });
  },
});

interface InstagramMediaResponse {
  id: string;
  permalink?: string;
}

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  needsRefresh: boolean;
}

/**
 * Main Lambda handler
 */
export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info("Instagram Publisher Lambda invoked", {
    records: event.Records.length,
  });

  metrics.addMetric("Invocations", MetricUnit.Count, 1);

  // Process messages in parallel with concurrency limit
  const results = await Promise.allSettled(
    event.Records.map((record) => processMessage(record)),
  );

  // Check for failures
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    metrics.addMetric("BatchFailures", MetricUnit.Count, failures.length);

    // Throw error to trigger retry for failed messages
    const errorMessages = failures
      .map(
        (f) => (f as PromiseRejectedResult).reason?.message || "Unknown error",
      )
      .join("; ");

    throw new Error(
      `Failed to process ${failures.length} messages: ${errorMessages}`,
    );
  }

  metrics.publishStoredMetrics();
};

/**
 * Process individual SQS message with full error handling
 */
async function processMessage(record: SQSRecord): Promise<void> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment("processMessage");

  try {
    // Validate input
    const request: PublishRequest = validateInput(
      PublishRequestSchema,
      JSON.parse(record.body),
    );

    logger.info("Processing publish request", {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      platform: request.platform,
    });

    // Generate idempotency key
    const idempotencyKey =
      request.idempotencyKey ||
      `${request.contentId}-${request.platform}-${Date.now()}`;

    // Check idempotency
    const shouldProcess = await idempotencyHandler.checkAndRecord(
      idempotencyKey,
      {
        contentId: request.contentId,
        platform: request.platform,
        brandId: request.brandId,
        scheduledAt: request.scheduledAt,
      },
    );

    if (!shouldProcess) {
      logger.info("Duplicate request detected, skipping", {
        idempotencyKey,
        contentId: request.contentId,
      });
      metrics.addMetric("DuplicateMessages", MetricUnit.Count, 1);
      return;
    }

    // Process the request
    const result = await publishContent(request);

    // Mark complete
    await idempotencyHandler.markComplete(idempotencyKey, result);

    metrics.addMetric("SuccessfulPublish", MetricUnit.Count, 1);
  } catch (error) {
    subsegment?.addError(error as Error);

    if (error instanceof ValidationError) {
      logger.error("Validation failed", {
        messageId: record.messageId,
        errors: (error as ValidationError).errors.issues,
      });
      metrics.addMetric("ValidationErrors", MetricUnit.Count, 1);
      // Don't retry validation errors
      return;
    }

    if (error instanceof IdempotencyError) {
      logger.info("Duplicate message detected, skipping", {
        messageId: record.messageId,
      });
      metrics.addMetric("DuplicateMessages", MetricUnit.Count, 1);
      // Don't retry duplicates
      return;
    }

    logger.error("Failed to process message", {
      messageId: record.messageId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    metrics.addMetric("ProcessingErrors", MetricUnit.Count, 1);
    throw error;
  } finally {
    subsegment?.close();
  }
}

/**
 * Publish content to Instagram with all improvements
 */
async function publishContent(
  request: PublishRequest,
): Promise<InstagramMediaResponse> {
  // Create job state entry
  const jobId = `${request.scheduleId}-${Date.now()}`;
  await updateJobState(jobId, "processing", request);

  try {
    // Get OAuth token
    const token = await getToken(request.userId, request.brandId, "instagram");
    if (!token) {
      throw new Error("Instagram token not found");
    }

    // Refresh token if needed (without logging the token!)
    if (token.needsRefresh && token.refreshToken) {
      await refreshAndStoreToken(request.userId, request.brandId, token);
    }

    // Validate Instagram-specific metadata
    const instagramAccountId = request.metadata?.instagramAccountId;
    if (!instagramAccountId) {
      throw new Error("Instagram Business Account ID not found in metadata");
    }

    // Publish to Instagram using circuit breaker
    const result = await instagramApiBreaker.execute(
      async () =>
        await publishToInstagram(
          instagramAccountId,
          token.accessToken,
          request.content,
        ),
    );

    // Update job state with success
    await updateJobState(jobId, "completed", {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      result,
    });

    // Send success event
    const successEvent = PostPublishedEventSchema.parse({
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: "instagram",
      postId: result.id,
      permalink: result.permalink,
      publishedAt: new Date().toISOString(),
    });

    await sendEvent(
      "postolio.publisher.instagram",
      "post.published",
      successEvent,
    );

    return result;
  } catch (error) {
    logger.error("Publishing failed", {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Update job state with failure
    await updateJobState(jobId, "failed", {
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    // Send failure event
    const failureEvent = PostFailedEventSchema.parse({
      scheduleId: request.scheduleId,
      contentId: request.contentId,
      brandId: request.brandId,
      userId: request.userId,
      platform: "instagram",
      error: error instanceof Error ? error.message : "Unknown error",
      failedAt: new Date().toISOString(),
    });

    await sendEvent(
      "postolio.publisher.instagram",
      "post.failed",
      failureEvent,
    );

    throw error;
  }
}

/**
 * Get and decrypt OAuth token
 */
async function getToken(
  userId: string,
  brandId: string,
  platform: string,
): Promise<TokenData | null> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment("getToken");

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: TOKEN_TABLE_NAME,
        Key: {
          pk: `${userId}#${platform}`,
          sk: brandId,
        },
      }),
    );

    if (!result.Item) {
      return null;
    }

    // Decrypt token (NEVER log the actual token value!)
    const accessToken = await decryptData(result.Item.encryptedAccessToken);
    const refreshToken = result.Item.encryptedRefreshToken
      ? await decryptData(result.Item.encryptedRefreshToken)
      : undefined;

    // Check if token needs refresh
    const expiryTime = result.Item.expiresAt;
    const refreshThreshold = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const needsRefresh = expiryTime < refreshThreshold;

    return {
      accessToken,
      refreshToken,
      expiresAt: result.Item.expiresAt,
      needsRefresh,
    };
  } finally {
    subsegment?.close();
  }
}

/**
 * Decrypt data using KMS
 */
async function decryptData(encryptedData: string): Promise<string> {
  const result = await kmsClient.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(encryptedData, "base64"),
    }),
  );

  return Buffer.from(result.Plaintext!).toString();
}

/**
 * Refresh Instagram token and store it securely
 */
async function refreshAndStoreToken(
  userId: string,
  brandId: string,
  token: TokenData,
): Promise<void> {
  try {
    const response = await axiosInstance.get(
      "https://graph.instagram.com/refresh_access_token",
      {
        params: {
          grant_type: "ig_refresh_token",
          access_token: token.accessToken,
        },
      },
    );

    // Store refreshed token securely (no logging!)
    await tokenRefreshHandler.storeToken(userId, brandId, "instagram", {
      accessToken: response.data.access_token,
      refreshToken: token.refreshToken, // Keep existing refresh token if not provided
      expiresIn: response.data.expires_in || 5184000, // 60 days default
    });

    // Update the token in memory for current request
    token.accessToken = response.data.access_token;
  } catch (error) {
    logger.error("Token refresh failed", {
      userId,
      brandId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    metrics.addMetric("TokenRefreshFailures", MetricUnit.Count, 1);
    // Continue with existing token
  }
}

/**
 * Publish content to Instagram Graph API
 */
async function publishToInstagram(
  accountId: string,
  accessToken: string,
  content: PublishRequest["content"],
): Promise<InstagramMediaResponse> {
  const segment = tracer.getSegment();
  const subsegment = segment?.addNewSubsegment("publishToInstagram");

  try {
    if (!content.mediaUrl) {
      throw new Error("Media URL is required for Instagram posts");
    }

    const caption = formatCaption(content.caption, content.hashtags || []);

    // Step 1: Create media container
    logger.info("Creating Instagram media container", { accountId });

    const containerResponse = await axiosInstance.post(
      `https://graph.facebook.com/v18.0/${accountId}/media`,
      null,
      {
        params: {
          image_url: content.mediaUrl,
          caption: caption,
          access_token: accessToken,
        },
      },
    );

    const mediaContainerId = containerResponse.data.id;

    // Step 2: Poll for media processing completion
    await waitForMediaProcessing(mediaContainerId, accessToken);

    // Step 3: Publish media
    logger.info("Publishing Instagram media", { mediaContainerId });

    const publishResponse = await axiosInstance.post(
      `https://graph.facebook.com/v18.0/${accountId}/media_publish`,
      null,
      {
        params: {
          creation_id: mediaContainerId,
          access_token: accessToken,
        },
      },
    );

    const mediaId = publishResponse.data.id;

    // Step 4: Get permalink
    const permalinkResponse = await axiosInstance.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      {
        params: {
          fields: "permalink",
          access_token: accessToken,
        },
      },
    );

    metrics.addMetric("InstagramPostsPublished", MetricUnit.Count, 1);

    return {
      id: mediaId,
      permalink: permalinkResponse.data.permalink,
    };
  } catch (error) {
    subsegment?.addError(error as Error);

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // Handle rate limiting
      if (axiosError.response?.status === 429) {
        metrics.addMetric("RateLimitErrors", MetricUnit.Count, 1);
        throw new Error("Instagram API rate limit exceeded");
      }

      // Handle other API errors (without exposing internal details)
      const statusCode = axiosError.response?.status || 0;
      logger.error("Instagram API error", {
        status: statusCode,
        // Don't log potentially sensitive response data
      });

      throw new Error(`Instagram API error (${statusCode})`);
    }

    throw error;
  } finally {
    subsegment?.close();
  }
}

/**
 * Wait for Instagram to process media
 */
async function waitForMediaProcessing(
  mediaContainerId: string,
  accessToken: string,
  maxAttempts = 10,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 seconds between checks

    const statusResponse = await axiosInstance.get(
      `https://graph.facebook.com/v18.0/${mediaContainerId}`,
      {
        params: {
          fields: "status_code",
          access_token: accessToken,
        },
      },
    );

    if (statusResponse.data.status_code === "FINISHED") {
      return;
    }

    if (statusResponse.data.status_code === "ERROR") {
      throw new Error("Instagram media processing failed");
    }
  }

  throw new Error("Instagram media processing timeout");
}

/**
 * Format caption with hashtags
 */
function formatCaption(caption: string, hashtags: string[]): string {
  const hashtagString = hashtags
    .slice(0, 30) // Instagram limit
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .join(" ");

  const fullCaption = `${caption}\n\n${hashtagString}`;

  // Truncate if too long
  if (fullCaption.length > 2200) {
    const truncatedCaption =
      caption.substring(0, 2200 - hashtagString.length - 4) + "...";
    return `${truncatedCaption}\n\n${hashtagString}`;
  }

  return fullCaption;
}

/**
 * Update job state in DynamoDB
 */
async function updateJobState(
  jobId: string,
  status: string,
  data: any,
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: JOB_STATE_TABLE_NAME,
      Item: {
        jobId,
        status,
        // Don't store sensitive data in job state
        data: {
          scheduleId: data.scheduleId,
          contentId: data.contentId,
          result: data.result,
          error: data.error,
        },
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days TTL
      },
    }),
  );
}

/**
 * Send event to EventBridge
 */
async function sendEvent(
  source: string,
  detailType: string,
  detail: any,
): Promise<void> {
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
    }),
  );
}
