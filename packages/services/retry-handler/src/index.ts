import { Logger } from "@aws-lambda-powertools/logger";
import { Tracer } from "@aws-lambda-powertools/tracer";
import { Metrics, MetricUnit } from "@aws-lambda-powertools/metrics";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { SQSEvent, SQSRecord } from "aws-lambda";

// Initialize Powertools
const logger = new Logger({ serviceName: "retry-handler" });
const tracer = new Tracer({ serviceName: "retry-handler" });
const metrics = new Metrics({
  namespace: "ContentScheduler",
  serviceName: "retry-handler",
});

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = tracer.captureAWSv3Client(new LambdaClient({}));

const MAX_RETRY_ATTEMPTS = 3;

export const handler = async (event: SQSEvent): Promise<void> => {
  logger.info("Processing retry messages", {
    messageCount: event.Records.length,
  });

  for (const record of event.Records) {
    try {
      await processRetryMessage(record);
      metrics.addMetric("RetryProcessed", MetricUnit.Count, 1);
    } catch (error) {
      logger.error("Failed to process retry message", error as Error);
      metrics.addMetric("RetryFailed", MetricUnit.Count, 1);
      throw error; // Let SQS handle retry
    }
  }

  metrics.publishStoredMetrics();
};

async function processRetryMessage(record: SQSRecord): Promise<void> {
  const message = JSON.parse(record.body);
  const { scheduleId } = message;

  logger.info("Processing retry for schedule", { scheduleId });

  // Get retry information
  const retryInfo = await getRetryInfo(scheduleId);
  const attemptNumber = (retryInfo?.attemptNumber || 0) + 1;

  if (attemptNumber > MAX_RETRY_ATTEMPTS) {
    logger.warn("Max retry attempts exceeded", { scheduleId, attemptNumber });
    await markAsFailed(scheduleId, "Max retry attempts exceeded");
    metrics.addMetric("MaxRetriesExceeded", MetricUnit.Count, 1);
    return;
  }

  // Record retry attempt
  await recordRetryAttempt(scheduleId, attemptNumber);

  // Calculate delay for next retry
  // Calculate potential delay (retained for future logic) currently not used
  // const delaySeconds = RETRY_DELAYS[attemptNumber - 1] || 900;

  try {
    // Get schedule metadata to include brandId and userId
    const scheduleData = await getScheduleData(scheduleId);

    // Retry the publish operation with full context
    const payload = {
      scheduleId,
      brandId: scheduleData?.brandId,
      userId: scheduleData?.userId,
    };

    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: process.env.PUBLISHER_LAMBDA_ARN!,
        InvocationType: "Event", // Async invocation
        Payload: JSON.stringify(payload),
      }),
    );

    logger.info("Retry invoked successfully", {
      scheduleId,
      attemptNumber,
      payload,
    });
    metrics.addMetric("RetryInvoked", MetricUnit.Count, 1);
  } catch (error) {
    logger.error("Failed to invoke retry", error as Error);

    // If we've reached max attempts, mark as failed
    if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
      await markAsFailed(
        scheduleId,
        "Failed to invoke publisher Lambda after max retries",
      );
    }

    // Let SQS DLQ handle the retry with its built-in exponential backoff
    // Do NOT manually schedule retries to avoid recursive invocations
    throw error;
  }
}

interface ScheduleRecord {
  pk: string;
  sk: string;
  brandId?: string;
  userId?: string;
  contentId?: string;
  [key: string]: unknown;
}

async function getScheduleData(
  scheduleId: string,
): Promise<ScheduleRecord | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.SCHEDULES_TABLE!,
        Key: {
          pk: `SCHEDULE#${scheduleId}`,
          sk: "METADATA",
        },
      }),
    );

    return (result.Item as ScheduleRecord) || null;
  } catch {
    logger.warn("No schedule data found", { scheduleId });
    return null;
  }
}

interface RetryInfo {
  scheduleId: string;
  attemptNumber: number;
  [key: string]: unknown;
}

async function getRetryInfo(scheduleId: string): Promise<RetryInfo | null> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: process.env.RETRY_QUEUE_TABLE!,
        Key: {
          scheduleId,
          attemptNumber: 0, // Get the latest attempt
        },
      }),
    );

    return (result.Item as RetryInfo) || null;
  } catch {
    logger.warn("No retry info found", { scheduleId });
    return null;
  }
}

async function recordRetryAttempt(
  scheduleId: string,
  attemptNumber: number,
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: process.env.RETRY_QUEUE_TABLE!,
      Item: {
        scheduleId,
        attemptNumber,
        timestamp: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
      },
    }),
  );

  // Also update the main schedule record
  await docClient.send(
    new UpdateCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: "METADATA",
      },
      UpdateExpression: "SET #retryCount = :count, #lastRetry = :timestamp",
      ExpressionAttributeNames: {
        "#retryCount": "retryCount",
        "#lastRetry": "lastRetryAt",
      },
      ExpressionAttributeValues: {
        ":count": attemptNumber,
        ":timestamp": new Date().toISOString(),
      },
    }),
  );
}

async function markAsFailed(scheduleId: string, reason: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: process.env.SCHEDULES_TABLE!,
      Key: {
        pk: `SCHEDULE#${scheduleId}`,
        sk: "METADATA",
      },
      UpdateExpression:
        "SET #status = :status, #error = :error, #updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
        "#error": "schedulingError",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":status": "failed",
        ":error": reason,
        ":updatedAt": new Date().toISOString(),
      },
    }),
  );

  // Log to audit table
  await docClient.send(
    new PutCommand({
      TableName: process.env.AUDIT_LOG_TABLE!,
      Item: {
        pk: `SCHEDULE#${scheduleId}`,
        timestamp: new Date().toISOString(),
        action: "FAILED_AFTER_RETRIES",
        reason,
        metadata: {
          maxAttempts: MAX_RETRY_ATTEMPTS,
        },
      },
    }),
  );
}

// Removed scheduleNextRetry function to prevent recursive invocations
// The DLQ's built-in retry mechanism with exponential backoff handles retries automatically
