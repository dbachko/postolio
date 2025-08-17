/**
 * GDPR Compliance Lambda
 * Implements data protection, encryption, export, and deletion functionality
 * Complies with GDPR Articles 15 (Right to Access), 17 (Right to Erasure), and 20 (Data Portability)
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, DeleteCommand, BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { KMSClient, EncryptCommand, DecryptCommand, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';

// Initialize Powertools
const logger = new Logger({ serviceName: 'gdpr-compliance' });
const tracer = new Tracer({ serviceName: 'gdpr-compliance' });
const metrics = new Metrics({ namespace: 'ContentScheduler', serviceName: 'gdpr-compliance' });

// Initialize AWS SDK clients
const dynamoClient = tracer.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = tracer.captureAWSv3Client(new S3Client({}));
const kmsClient = tracer.captureAWSv3Client(new KMSClient({}));
const secretsClient = tracer.captureAWSv3Client(new SecretsManagerClient({}));

// Configuration
const EXPORT_BUCKET = process.env.GDPR_EXPORT_BUCKET!;
const KMS_KEY_ID = process.env.KMS_KEY_ID!;
const AUDIT_TABLE = process.env.AUDIT_TABLE!;
const EXPORT_EXPIRY = 7 * 24 * 60 * 60; // 7 days
const DELETION_GRACE_PERIOD = 30 * 24 * 60 * 60; // 30 days

interface UserDataExport {
  userId: string;
  requestId: string;
  exportedAt: string;
  dataCategories: string[];
  format: 'json' | 'csv';
  downloadUrl?: string;
  expiresAt: string;
}

interface DeletionRequest {
  userId: string;
  requestId: string;
  requestedAt: string;
  scheduledDeletionDate: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  dataCategories: string[];
  confirmationToken: string;
}

interface AuditLog {
  pk: string;
  sk: string;
  operation: string;
  userId: string;
  requestId: string;
  timestamp: string;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure';
  metadata?: Record<string, any>;
  ttl?: number; // 7 years retention for audit logs
}

// CORS headers helper
function addCorsHeaders(response: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...response,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      ...response.headers,
    },
  };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  logger.addPersistentLogAttributes({
    requestId: event.requestContext.requestId,
    method: event.httpMethod,
    path: event.path,
  });

  logger.info('Processing GDPR request', { 
    method: event.httpMethod, 
    path: event.path 
  });

  try {
    // Extract user context from authorizer
    const userId = event.requestContext.authorizer?.userId || 
                   event.pathParameters?.userId;
    
    if (!userId) {
      return addCorsHeaders({
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      });
    }

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return addCorsHeaders({
        statusCode: 200,
        body: '',
      });
    }

    // Route to appropriate handler
    let result: APIGatewayProxyResult;
    
    if (event.path.includes('/export')) {
      result = await handleDataExport(userId, event);
      metrics.addMetric('GDPRDataExport', MetricUnit.Count, 1);
    } else if (event.path.includes('/delete')) {
      result = await handleDataDeletion(userId, event);
      metrics.addMetric('GDPRDataDeletion', MetricUnit.Count, 1);
    } else if (event.path.includes('/access')) {
      result = await handleDataAccess(userId, event);
      metrics.addMetric('GDPRDataAccess', MetricUnit.Count, 1);
    } else if (event.path.includes('/encrypt')) {
      result = await handleDataEncryption(event);
      metrics.addMetric('GDPRDataEncryption', MetricUnit.Count, 1);
    } else {
      result = {
        statusCode: 404,
        body: JSON.stringify({ error: 'Endpoint not found' }),
      };
    }

    // Audit log the operation
    await auditLog({
      operation: event.path,
      userId,
      requestId: event.requestContext.requestId,
      ipAddress: event.requestContext.identity?.sourceIp,
      userAgent: event.headers['User-Agent'],
      result: result.statusCode < 400 ? 'success' : 'failure',
    });

    metrics.publishStoredMetrics();
    return addCorsHeaders(result);
    
  } catch (error) {
    logger.error('Error processing GDPR request', error as Error);
    metrics.addMetric('GDPRError', MetricUnit.Count, 1);
    metrics.publishStoredMetrics();

    return addCorsHeaders({
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'Failed to process GDPR request',
      }),
    });
  }
};

/**
 * Handle data export request (GDPR Article 20 - Data Portability)
 */
async function handleDataExport(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const requestId = `EXPORT_${Date.now()}_${crypto.randomUUID()}`;
    const body = event.body ? JSON.parse(event.body) : {};
    const format = body.format || 'json';
    const dataCategories = body.dataCategories || ['all'];

    logger.info('Processing data export request', { userId, requestId, format, dataCategories });

    // Collect user data from all tables
    const userData = await collectUserData(userId, dataCategories);

    // Encrypt sensitive data
    const encryptedData = await encryptUserData(userData);

    // Generate export file
    const exportKey = `exports/${userId}/${requestId}/data.${format}`;
    const exportData = format === 'json' 
      ? JSON.stringify(encryptedData, null, 2)
      : convertToCSV(encryptedData);

    // Upload to S3 with encryption
    await s3Client.send(new PutObjectCommand({
      Bucket: EXPORT_BUCKET,
      Key: exportKey,
      Body: exportData,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: KMS_KEY_ID,
      Metadata: {
        userId,
        requestId,
        exportedAt: new Date().toISOString(),
      },
      ContentType: format === 'json' ? 'application/json' : 'text/csv',
    }));

    // Generate presigned URL for download
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: EXPORT_BUCKET,
        Key: exportKey,
      }),
      { expiresIn: EXPORT_EXPIRY }
    );

    // Record export in database
    const exportRecord: UserDataExport = {
      userId,
      requestId,
      exportedAt: new Date().toISOString(),
      dataCategories,
      format,
      downloadUrl,
      expiresAt: new Date(Date.now() + EXPORT_EXPIRY * 1000).toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: process.env.GDPR_REQUESTS_TABLE!,
      Item: {
        pk: `USER#${userId}`,
        sk: `EXPORT#${requestId}`,
        ...exportRecord,
        ttl: Math.floor(Date.now() / 1000) + EXPORT_EXPIRY,
      },
    }));

    logger.info('Data export completed', { userId, requestId });

    return {
      statusCode: 200,
      body: JSON.stringify({
        requestId,
        downloadUrl,
        expiresAt: exportRecord.expiresAt,
        format,
        message: 'Data export completed successfully',
      }),
    };
  } catch (error) {
    logger.error('Failed to export user data', error as Error);
    throw error;
  }
}

/**
 * Handle data deletion request (GDPR Article 17 - Right to Erasure)
 */
async function handleDataDeletion(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const confirmationToken = body.confirmationToken;
    const immediate = body.immediate || false;

    // Verify confirmation token for safety
    if (!confirmationToken || !await verifyDeletionToken(userId, confirmationToken)) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Invalid or missing confirmation token',
          message: 'Please confirm the deletion request with a valid token',
        }),
      };
    }

    const requestId = `DELETE_${Date.now()}_${crypto.randomUUID()}`;
    const scheduledDeletionDate = immediate 
      ? new Date().toISOString()
      : new Date(Date.now() + DELETION_GRACE_PERIOD * 1000).toISOString();

    logger.info('Processing data deletion request', { 
      userId, 
      requestId, 
      immediate,
      scheduledDeletionDate 
    });

    // Create deletion request record
    const deletionRequest: DeletionRequest = {
      userId,
      requestId,
      requestedAt: new Date().toISOString(),
      scheduledDeletionDate,
      status: immediate ? 'processing' : 'pending',
      dataCategories: body.dataCategories || ['all'],
      confirmationToken,
    };

    await docClient.send(new PutCommand({
      TableName: process.env.GDPR_REQUESTS_TABLE!,
      Item: {
        pk: `USER#${userId}`,
        sk: `DELETE#${requestId}`,
        ...deletionRequest,
      },
    }));

    if (immediate) {
      // Perform immediate deletion
      await performUserDataDeletion(userId, deletionRequest);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          requestId,
          status: 'completed',
          message: 'User data has been permanently deleted',
        }),
      };
    } else {
      // Schedule deletion
      return {
        statusCode: 202,
        body: JSON.stringify({
          requestId,
          status: 'scheduled',
          scheduledDeletionDate,
          message: `Data deletion scheduled for ${scheduledDeletionDate}. You can cancel within the grace period.`,
        }),
      };
    }
  } catch (error) {
    logger.error('Failed to process deletion request', error as Error);
    throw error;
  }
}

/**
 * Handle data access request (GDPR Article 15 - Right to Access)
 */
async function handleDataAccess(userId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const queryParams = event.queryStringParameters || {};
    const category = queryParams.category || 'summary';

    logger.info('Processing data access request', { userId, category });

    // Collect user data based on category
    const userData = await collectUserData(userId, [category]);
    
    // Anonymize sensitive fields for viewing
    const anonymizedData = anonymizeForViewing(userData);

    return {
      statusCode: 200,
      body: JSON.stringify({
        userId,
        dataCategory: category,
        data: anonymizedData,
        retrievedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    logger.error('Failed to retrieve user data', error as Error);
    throw error;
  }
}

/**
 * Handle data encryption request
 */
async function handleDataEncryption(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const body = JSON.parse(event.body || '{}');
    const data = body.data;
    const operation = body.operation || 'encrypt';

    if (!data) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No data provided for encryption' }),
      };
    }

    let result: string;
    
    if (operation === 'encrypt') {
      result = await encryptField(data);
    } else if (operation === 'decrypt') {
      result = await decryptField(data);
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid operation. Use encrypt or decrypt' }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        operation,
        result,
        processedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    logger.error('Encryption operation failed', error as Error);
    throw error;
  }
}

/**
 * Collect all user data from various tables
 */
async function collectUserData(userId: string, categories: string[]): Promise<any> {
  const userData: Record<string, any> = {
    userId,
    exportedAt: new Date().toISOString(),
    categories: {},
  };

  // Define table mappings for each data category
  const categoryMappings: Record<string, string[]> = {
    schedules: [process.env.SCHEDULES_TABLE!],
    content: [process.env.CONTENT_TABLE!],
    analytics: [process.env.ANALYTICS_TABLE!],
    videos: [process.env.VIDEO_UPLOADS_TABLE!, process.env.VIDEO_PROCESSING_TABLE!],
    audit: [AUDIT_TABLE],
    all: [
      process.env.SCHEDULES_TABLE!,
      process.env.CONTENT_TABLE!,
      process.env.ANALYTICS_TABLE!,
      process.env.VIDEO_UPLOADS_TABLE!,
      process.env.VIDEO_PROCESSING_TABLE!,
      AUDIT_TABLE,
    ],
  };

  const tablesToQuery = categories.includes('all') 
    ? categoryMappings.all 
    : categories.flatMap(cat => categoryMappings[cat] || []);

  // Query each table
  for (const tableName of tablesToQuery) {
    try {
      const items = await queryUserDataFromTable(userId, tableName);
      userData.categories[tableName] = items;
    } catch (error) {
      logger.error(`Failed to query table ${tableName}`, error as Error);
      userData.categories[tableName] = { error: 'Failed to retrieve data' };
    }
  }

  return userData;
}

/**
 * Query user data from a specific table
 */
async function queryUserDataFromTable(userId: string, tableName: string): Promise<any[]> {
  const items: any[] = [];
  let lastEvaluatedKey: any;

  do {
    const response = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'pk = :userId',
      ExpressionAttributeValues: {
        ':userId': `USER#${userId}`,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    if (response.Items) {
      items.push(...response.Items);
    }

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

/**
 * Perform actual user data deletion
 */
async function performUserDataDeletion(userId: string, request: DeletionRequest): Promise<void> {
  logger.info('Performing user data deletion', { userId, requestId: request.requestId });

  const tables = [
    process.env.SCHEDULES_TABLE!,
    process.env.CONTENT_TABLE!,
    process.env.ANALYTICS_TABLE!,
    process.env.VIDEO_UPLOADS_TABLE!,
    process.env.VIDEO_PROCESSING_TABLE!,
  ];

  // Delete from each table
  for (const tableName of tables) {
    await deleteUserDataFromTable(userId, tableName);
  }

  // Delete S3 objects
  await deleteUserS3Objects(userId);

  // Update deletion request status
  await docClient.send(new UpdateCommand({
    TableName: process.env.GDPR_REQUESTS_TABLE!,
    Key: {
      pk: `USER#${userId}`,
      sk: `DELETE#${request.requestId}`,
    },
    UpdateExpression: 'SET #status = :status, #completedAt = :completedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#completedAt': 'completedAt',
    },
    ExpressionAttributeValues: {
      ':status': 'completed',
      ':completedAt': new Date().toISOString(),
    },
  }));

  logger.info('User data deletion completed', { userId });
}

/**
 * Delete user data from a specific table
 */
async function deleteUserDataFromTable(userId: string, tableName: string): Promise<void> {
  // First, query all items
  const items = await queryUserDataFromTable(userId, tableName);

  // Batch delete items
  const chunks = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const deleteRequests = chunk.map(item => ({
      DeleteRequest: {
        Key: {
          pk: item.pk,
          sk: item.sk,
        },
      },
    }));

    await docClient.send(new BatchWriteCommand({
      RequestItems: {
        [tableName]: deleteRequests,
      },
    }));
  }

  logger.info(`Deleted ${items.length} items from ${tableName}`, { userId });
}

/**
 * Delete user's S3 objects
 */
async function deleteUserS3Objects(userId: string): Promise<void> {
  const buckets = [
    process.env.CONTENT_BUCKET!,
    process.env.VIDEO_BUCKET!,
    EXPORT_BUCKET,
  ];

  for (const bucket of buckets) {
    let continuationToken: string | undefined;

    do {
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${userId}/`,
        ContinuationToken: continuationToken,
      }));

      if (response.Contents && response.Contents.length > 0) {
        // Delete objects in batches
        for (const object of response.Contents) {
          if (object.Key) {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: bucket,
              Key: object.Key,
            }));
          }
        }

        logger.info(`Deleted ${response.Contents.length} objects from ${bucket}`, { userId });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);
  }
}

/**
 * Encrypt user data for export
 */
async function encryptUserData(data: any): Promise<any> {
  // List of fields that should be encrypted
  const sensitiveFields = ['email', 'phone', 'address', 'creditCard', 'ssn'];
  
  const encryptObject = async (obj: any): Promise<any> => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const encrypted: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.includes(key) && typeof value === 'string') {
        encrypted[key] = await encryptField(value);
      } else if (typeof value === 'object') {
        encrypted[key] = await encryptObject(value);
      } else {
        encrypted[key] = value;
      }
    }

    return encrypted;
  };

  return encryptObject(data);
}

/**
 * Encrypt a single field using KMS
 */
async function encryptField(plaintext: string): Promise<string> {
  const response = await kmsClient.send(new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(plaintext),
  }));

  return Buffer.from(response.CiphertextBlob!).toString('base64');
}

/**
 * Decrypt a single field using KMS
 */
async function decryptField(ciphertext: string): Promise<string> {
  const response = await kmsClient.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    KeyId: KMS_KEY_ID,
  }));

  return Buffer.from(response.Plaintext!).toString();
}

/**
 * Anonymize data for viewing (mask sensitive information)
 */
function anonymizeForViewing(data: any): any {
  const sensitiveFields = ['email', 'phone', 'creditCard', 'ssn', 'password'];
  
  const anonymize = (obj: any): any => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    const anonymized: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.includes(key) && typeof value === 'string') {
        // Mask sensitive fields
        anonymized[key] = value.substring(0, 3) + '***' + value.substring(Math.max(value.length - 2, 3));
      } else if (typeof value === 'object') {
        anonymized[key] = anonymize(value);
      } else {
        anonymized[key] = value;
      }
    }

    return anonymized;
  };

  return anonymize(data);
}

/**
 * Convert JSON data to CSV format
 */
function convertToCSV(data: any): string {
  // Flatten nested objects
  const flatten = (obj: any, prefix = ''): Record<string, any> => {
    return Object.keys(obj).reduce((acc: Record<string, any>, key) => {
      const pre = prefix.length ? `${prefix}.` : '';
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        Object.assign(acc, flatten(obj[key], pre + key));
      } else {
        acc[pre + key] = obj[key];
      }
      return acc;
    }, {});
  };

  const flattened = flatten(data);
  const headers = Object.keys(flattened);
  const values = Object.values(flattened).map(v => 
    typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v
  );

  return `${headers.join(',')}\n${values.join(',')}`;
}

/**
 * Verify deletion confirmation token
 */
async function verifyDeletionToken(userId: string, token: string): Promise<boolean> {
  // In production, verify against a stored token or use a cryptographic signature
  // For now, simple validation
  return token === crypto.createHash('sha256').update(`${userId}:DELETE`).digest('hex').substring(0, 16);
}

/**
 * Audit log operation
 */
async function auditLog(log: Omit<AuditLog, 'pk' | 'sk' | 'timestamp' | 'ttl'>): Promise<void> {
  const auditEntry: AuditLog = {
    pk: `AUDIT#${log.userId}`,
    sk: `LOG#${Date.now()}#${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    ttl: Math.floor(Date.now() / 1000) + (7 * 365 * 24 * 60 * 60), // 7 years retention
    ...log,
  };

  await docClient.send(new PutCommand({
    TableName: AUDIT_TABLE,
    Item: auditEntry,
  }));

  logger.info('Audit log recorded', { 
    operation: log.operation, 
    userId: log.userId,
    result: log.result 
  });
}