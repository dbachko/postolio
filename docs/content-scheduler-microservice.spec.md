# Content Scheduler Microservice Product Specification

## Executive Summary

This specification outlines the design and implementation of a highly reliable, cost-effective content scheduling and posting microservice capable of handling 1 million posts per day with 99.99% reliability. The solution leverages AWS serverless technologies to extract scheduling functionality from the existing monolithic cron-based system into a dedicated microservice that guarantees timely content delivery across social media platforms, including support for video content and full GDPR compliance.

**Key Value Propositions:**
- **99.99% Reliability**: Maximum 52 minutes downtime per year with defined SLAs
- **Massive Scale**: Support for 1M+ daily posts with elastic scaling
- **Cost Optimization**: ~$200/month for 1M daily posts using serverless architecture  
- **Platform Resilience**: Robust handling of social media API rate limits and failures
- **Video Content Support**: Native handling of video posts including Reels, Shorts, and TikToks
- **GDPR Compliant**: Full data protection and privacy compliance from day one

---

## Product Overview

- **Purpose**: Ensure scheduled social media content is published reliably at the exact time specified by users, regardless of scale or platform conditions
- **Target Users**: Social media managers, content creators, marketing teams, agencies managing multiple brands
- **Key Scenarios**: 
  - Scheduled post publishing at user-specified times
  - Bulk campaign execution with thousands of posts
  - Cross-timezone content delivery
- **Success Definition**: 99% of posts published within 2 minutes of scheduled time (SLA)

## User Personas

- **Primary**: Marketing Manager — manages 50+ brand accounts, schedules 1000+ posts weekly, needs absolute reliability
- **Secondary**: Content Creator — schedules 20-50 posts weekly, values precise timing for audience engagement
- **Tertiary**: Agency Administrator — oversees 500+ client accounts, requires bulk operations and monitoring

## Jobs To Be Done

- When I schedule a post, I want it published at the exact time specified, so I can maximize audience engagement
- When platform APIs are down, I want automatic retries, so I don't lose content or timing
- When managing multiple timezones, I want accurate local time publishing, so I reach global audiences effectively
- When monitoring campaigns, I want real-time status updates, so I can intervene if needed

---

## Problem Statement & Current Limitations

### Current State Analysis

The existing monolithic architecture uses a cron-based system running within the main application, presenting several critical limitations:

1. **Single Point of Failure**: Cron service failure affects entire application
2. **Scaling Constraints**: Vertical scaling limitations of monolithic architecture
3. **Precision Issues**: Cron granularity limited to minutes, potential for drift
4. **Resource Contention**: Scheduling competes with other application processes
5. **Limited Observability**: Difficult to monitor and debug scheduling issues
6. **Recovery Challenges**: Manual intervention required for failed posts

### Critical Requirements

- **Scheduling Precision**: Within 2 minutes of target time (99% SLA)
- **Delayed Post Tolerance**: Business can accept up to 5-minute delays in edge cases
- **Failure Recovery**: Automatic retry with exponential backoff
- **Platform Resilience**: Handle API rate limits gracefully
- **Video Content**: Support for video posts up to 1GB with async processing
- **Scale**: Linear scaling from 1 to 1M+ posts daily
- **Cost Efficiency**: Optimize for variable workloads
- **GDPR Compliance**: Full data protection and user rights from launch

---

## Industry Research Findings

### Market Analysis

Based on research of leading platforms (Buffer, Hootsuite, Later, Sprout Social):

#### Buffer (70,000+ customers, $31.1M revenue)
- **Architecture**: Focuses on simplicity and reliability
- **Strengths**: Minimal failure points through simple design
- **Target**: Small businesses and creators (ARPU: $25)
- **Key Insight**: Reliability through simplicity over feature complexity

#### Hootsuite (350M+ revenue, enterprise focus)
- **Architecture**: Complex enterprise-grade system
- **Strengths**: Comprehensive feature set, advanced analytics
- **Target**: Large organizations with dedicated teams
- **Key Insight**: Enterprise features come with complexity costs

#### Industry Best Practices
- **Decoupled Architecture**: Separate scheduling from content creation
- **Event-Driven Design**: Asynchronous processing for reliability
- **Multi-Layer Retry**: Platform-specific retry strategies
- **Observability First**: Comprehensive monitoring and alerting

### Technical Research

#### AWS Service Comparison

**EventBridge Scheduler (Recommended)**
- **Pros**: 
  - Native scheduling with 50-second precision
  - 14M free invocations/month
  - Built-in retry and DLQ support
  - Serverless, no infrastructure management
- **Cons**: 
  - 1M schedule limit (manageable with rotation)
  - 64KB payload limit (use reference pattern)
- **Cost**: ~$16/month for 30M invocations

**Lambda + DynamoDB (Traditional)**
- **Pros**: Full control over scheduling logic
- **Cons**: 
  - Higher operational overhead
  - DynamoDB TTL has 48-hour precision window
  - Higher costs (~$100+/month at scale)

**Step Functions**
- **Pros**: Complex workflow orchestration
- **Cons**: Overkill for simple scheduling, higher costs

### Social Media Platform Constraints

#### Rate Limits (2025)
- **Instagram**: 200 calls/hour per user
- **Twitter/X**: 900 requests/15-minute window
- **Facebook**: Dynamic based on app usage
- **TikTok**: 1000 requests/minute

#### Retry Strategies
- **Exponential Backoff**: 1s, 4s, 10s, 30s intervals
- **Rate Limit Headers**: Monitor x-rate-limit-remaining
- **Circuit Breaker**: Prevent cascade failures
- **Dead Letter Queue**: Capture unrecoverable failures

### Video Content Handling Research

#### Platform-Specific Video Requirements (2025)

**Instagram Reels**
- **Max Duration**: 90 seconds (feed), 60 seconds (stories)
- **File Size**: Up to 1GB
- **Formats**: MP4, MOV (H.264 codec, AAC audio)
- **Aspect Ratios**: 9:16 (recommended), 16:9, 4:5, 1:1
- **Resolution**: 1080x1920 (recommended)
- **Upload Process**: Two-step (upload media, then publish)

**YouTube Shorts**
- **Max Duration**: 60 seconds
- **File Size**: Up to 128GB (but typically <500MB for shorts)
- **Formats**: MP4, MOV, AVI, WMV, FLV, 3GP
- **Aspect Ratio**: 9:16 vertical required
- **Resolution**: 1920x1080 or higher
- **Processing Time**: 2-10 minutes for HD processing

**TikTok**
- **Max Duration**: 10 minutes (most engagement <60 seconds)
- **File Size**: Up to 287.6MB (iOS), 72MB (Android)
- **Formats**: MP4, MOV
- **Aspect Ratio**: 9:16 vertical
- **Resolution**: 1080x1920
- **Special Requirements**: Sound/music licensing validation

#### Video Processing Architecture

**Challenges & Solutions:**
1. **Large File Sizes**: 
   - Store videos in S3 with pre-signed URLs
   - Stream uploads to avoid Lambda memory limits
   - Use S3 Transfer Acceleration for faster uploads

2. **Processing Time**:
   - Async processing with Step Functions
   - SQS for queue management
   - Progress tracking via DynamoDB

3. **Format Conversion**:
   - AWS MediaConvert for transcoding
   - Pre-process to platform specs
   - Cache converted versions

4. **Timeout Handling**:
   - Extended Lambda timeout (15 minutes)
   - Or use ECS tasks for long-running processes
   - Chunked uploads for reliability

---

## Proposed Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Client Applications                      │
│                  (Web, Mobile, API Clients)                  │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway (REST)                         │
│              Authentication & Request Routing                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┬──────────────┬────────────┐
        ▼                           ▼              ▼            ▼
┌──────────────┐           ┌──────────────┐  ┌──────────────┐ ┌──────────────┐
│  Schedule    │           │   Status     │  │   Admin      │ │Video Upload  │
│  Lambda      │           │   Lambda     │  │   Lambda     │ │  Lambda      │
└──────┬───────┘           └──────┬───────┘  └──────┬───────┘ └──────┬───────┘
       │                          │                  │                │
       ▼                          ▼                  ▼                ▼
┌─────────────────────────────────────────────────────────────┐ ┌─────────────┐
│                    DynamoDB Tables                           │ │  S3 Bucket  │
│         Schedules | Status | Config | Analytics              │ │   (Videos)  │
└─────────────────────────────────────────────────────────────┘ └──────┬──────┘
       │                                                               │
       ▼                                                               ▼
┌─────────────────────────────────────────────────────────────┐ ┌─────────────┐
│              EventBridge Scheduler                           │ │MediaConvert │
│         Manages scheduled invocations                        │ │(Transcoding)│
└─────────────────────┬───────────────────────────────────────┘ └──────┬──────┘
                      │                                                │
                      ▼                                                │
┌─────────────────────────────────────────────────────────────┐       │
│                  Publisher Lambda                            │◄──────┘
│            Triggered at scheduled time                       │
│            (Handles both image and video content)            │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┬──────────────┐
        ▼             ▼             ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Instagram   │ │   Twitter    │ │   Facebook   │ │   TikTok     │
│  Connector   │ │  Connector   │ │  Connector   │ │  Connector   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                 │                 │                 │
       ▼                 ▼                 ▼                 ▼
   Social APIs      Social APIs      Social APIs      Social APIs
```

### Core Components

#### 1. Schedule Management Service
```typescript
interface ScheduleService {
  createSchedule(post: ScheduledPost): Promise<ScheduleId>
  updateSchedule(id: ScheduleId, updates: Partial<ScheduledPost>): Promise<void>
  cancelSchedule(id: ScheduleId): Promise<void>
  bulkSchedule(posts: ScheduledPost[]): Promise<ScheduleId[]>
}
```

#### 2. EventBridge Scheduler Integration
```typescript
interface SchedulerAdapter {
  scheduleOneTime(params: {
    scheduledTime: DateTime    // UTC timestamp
    targetArn: string          // Publisher Lambda ARN
    payload: PostReference     // Reference to DynamoDB record
    retryPolicy: RetryConfig
  }): Promise<ScheduleArn>
  
  scheduleRecurring(params: {
    cronExpression: string
    targetArn: string
    payload: CampaignReference
  }): Promise<ScheduleArn>
}
```

#### 3. Publisher Service
```typescript
interface PublisherService {
  publish(postId: string): Promise<PublishResult>
  handleRateLimit(error: RateLimitError): Promise<RetryDecision>
  recordMetrics(result: PublishResult): Promise<void>
}
```

#### 4. Platform Connectors
```typescript
interface PlatformConnector {
  post(content: Content): Promise<PostResult>
  postVideo(video: VideoContent): Promise<PostResult>
  checkRateLimit(): Promise<RateLimitStatus>
  handleError(error: PlatformError): Promise<ErrorResolution>
  validateCredentials(): Promise<boolean>
  getVideoUploadLimits(): VideoLimits
}
```

#### 5. Video Processing Service
```typescript
interface VideoProcessingService {
  uploadVideo(params: {
    file: Buffer | Stream
    metadata: VideoMetadata
  }): Promise<S3Location>
  
  transcodeVideo(params: {
    sourceUrl: string
    targetPlatform: Platform
    outputFormat: VideoFormat
  }): Promise<TranscodedVideo>
  
  validateVideo(params: {
    url: string
    platform: Platform
  }): Promise<ValidationResult>
  
  generateThumbnail(videoUrl: string): Promise<string>
  
  getProcessingStatus(jobId: string): Promise<ProcessingStatus>
}

interface VideoMetadata {
  duration: number
  fileSize: number
  format: string
  resolution: { width: number; height: number }
  aspectRatio: string
  hasAudio: boolean
}
```

### Data Models

#### Schedule Table (DynamoDB)
```typescript
interface ScheduleRecord {
  PK: string                  // "SCHEDULE#${scheduleId}"
  SK: string                  // "TIME#${timestamp}"
  scheduleId: string          // ULID for sortability
  brandId: string
  userId: string
  contentId: string
  contentType: 'image' | 'video' | 'text'
  scheduledTime: string       // ISO 8601 UTC
  localTime: string          // User's local time
  timezone: string           // IANA timezone
  platform: Platform
  status: ScheduleStatus
  eventBridgeArn?: string
  retryCount: number
  lastError?: string
  videoMetadata?: {
    s3Url: string
    processedUrl?: string
    thumbnailUrl?: string
    duration: number
    fileSize: number
    transcodingJobId?: string
  }
  createdAt: string
  updatedAt: string
  TTL?: number              // For automatic cleanup (90 days for GDPR)
}
```

#### Status Table (DynamoDB)
```typescript
interface StatusRecord {
  PK: string                 // "STATUS#${contentId}"
  SK: string                 // "UPDATE#${timestamp}"
  contentId: string
  status: PublishStatus
  platform: Platform
  publishedAt?: string
  platformPostId?: string
  platformUrl?: string
  error?: ErrorDetail
  metrics?: PublishMetrics
  timestamp: string
}
```

### Reliability Mechanisms

#### 1. Multi-Layer Retry Strategy
```typescript
const retryConfig = {
  maxRetries: 5,
  retryDelayBase: 1000,      // Start with 1 second
  retryDelayMax: 300000,     // Max 5 minutes
  retryableErrors: [
    'RATE_LIMIT_EXCEEDED',
    'TEMPORARY_API_ERROR',
    'NETWORK_TIMEOUT'
  ],
  fatalErrors: [
    'INVALID_CREDENTIALS',
    'CONTENT_POLICY_VIOLATION',
    'ACCOUNT_SUSPENDED'
  ]
}

class RetryHandler {
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    let lastError: Error
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        if (this.isFatalError(error, config)) {
          throw error
        }
        
        if (attempt < config.maxRetries) {
          const delay = this.calculateBackoff(attempt, config)
          await this.sleep(delay)
        }
      }
    }
    
    // Move to DLQ after max retries
    await this.sendToDeadLetterQueue(lastError)
    throw lastError
  }
  
  calculateBackoff(attempt: number, config: RetryConfig): number {
    const exponentialDelay = config.retryDelayBase * Math.pow(2, attempt)
    const jitteredDelay = exponentialDelay * (0.5 + Math.random() * 0.5)
    return Math.min(jitteredDelay, config.retryDelayMax)
  }
}
```

#### 2. Dead Letter Queue Processing
```typescript
interface DeadLetterProcessor {
  processFailedPost(post: FailedPost): Promise<void> {
    // 1. Log comprehensive error details
    await this.logError(post)
    
    // 2. Notify user/admin
    await this.sendNotification(post)
    
    // 3. Store for manual review
    await this.storeForReview(post)
    
    // 4. Attempt alternative publishing method
    if (post.retryCount < MAX_DLQ_RETRIES) {
      await this.scheduleDelayedRetry(post)
    }
  }
}
```

#### 3. Circuit Breaker Pattern
```typescript
class CircuitBreaker {
  private failures: Map<Platform, number> = new Map()
  private lastFailureTime: Map<Platform, Date> = new Map()
  private state: Map<Platform, 'CLOSED' | 'OPEN' | 'HALF_OPEN'> = new Map()
  
  async execute<T>(
    platform: Platform,
    operation: () => Promise<T>
  ): Promise<T> {
    const currentState = this.state.get(platform) || 'CLOSED'
    
    if (currentState === 'OPEN') {
      if (this.shouldAttemptReset(platform)) {
        this.state.set(platform, 'HALF_OPEN')
      } else {
        throw new Error(`Circuit breaker OPEN for ${platform}`)
      }
    }
    
    try {
      const result = await operation()
      this.onSuccess(platform)
      return result
    } catch (error) {
      this.onFailure(platform)
      throw error
    }
  }
}
```

### Timezone & DST Handling

#### Best Practices Implementation
```typescript
class TimezoneHandler {
  // Store user intent as wall clock time + timezone
  schedulePost(params: {
    localTime: string        // "2025-03-15 14:00:00"
    timezone: string         // "America/New_York"
    content: Content
  }): ScheduleRecord {
    // Convert to UTC for EventBridge
    const utcTime = this.convertToUTC(params.localTime, params.timezone)
    
    // Store both for reference
    return {
      scheduledTime: utcTime.toISOString(),
      localTime: params.localTime,
      timezone: params.timezone,
      // ... other fields
    }
  }
  
  // Handle DST transitions
  handleDSTTransition(schedule: ScheduleRecord): void {
    // For spring forward (2am → 3am)
    // Posts scheduled for 2:30am run at 3:00am
    
    // For fall back (2am → 1am)
    // Ensure posts don't run twice
    if (this.isDSTTransition(schedule.scheduledTime)) {
      this.adjustForDST(schedule)
    }
  }
  
  // Validate timezone data
  validateTimezone(timezone: string): boolean {
    // Use IANA timezone database
    return moment.tz.zone(timezone) !== null
  }
}
```

### GDPR Compliance Implementation

#### Data Protection Requirements

```typescript
class GDPRComplianceService {
  // Data Minimization - Only collect necessary data
  sanitizeScheduleData(data: ScheduleRecord): ScheduleRecord {
    // Remove any PII not required for scheduling
    const sanitized = { ...data }
    delete sanitized.userEmail  // Store only userId
    delete sanitized.ipAddress  // Don't store IP addresses
    return sanitized
  }
  
  // Right to Access (Article 15)
  async exportUserData(userId: string): Promise<UserDataExport> {
    const schedules = await this.getSchedulesByUser(userId)
    const status = await this.getStatusByUser(userId)
    const auditLogs = await this.getAuditLogsByUser(userId)
    
    return {
      schedules: this.sanitizeForExport(schedules),
      statusHistory: status,
      auditLogs: auditLogs,
      exportDate: new Date().toISOString(),
      format: 'json' // Also support CSV
    }
  }
  
  // Right to Erasure (Article 17)
  async deleteUserData(userId: string): Promise<DeletionReport> {
    // Soft delete with audit trail
    const deletionTasks = await Promise.all([
      this.anonymizeSchedules(userId),
      this.deleteVideoContent(userId),
      this.removeFromAnalytics(userId),
      this.createDeletionAuditLog(userId)
    ])
    
    return {
      deletedRecords: deletionTasks.flat().length,
      deletionDate: new Date().toISOString(),
      confirmationId: generateDeletionConfirmation()
    }
  }
  
  // Data Portability (Article 20)
  async generatePortableExport(userId: string): Promise<Buffer> {
    const data = await this.exportUserData(userId)
    return this.formatAsJSON(data) // Machine-readable format
  }
  
  // Consent Management
  async recordConsent(params: {
    userId: string
    consentType: 'scheduling' | 'analytics' | 'marketing'
    granted: boolean
    ipAddress?: string
    timestamp: Date
  }): Promise<void> {
    await this.consentTable.put({
      PK: `CONSENT#${params.userId}`,
      SK: `TYPE#${params.consentType}#${params.timestamp.toISOString()}`,
      ...params,
      TTL: Math.floor(Date.now() / 1000) + (7 * 365 * 24 * 60 * 60) // 7 years
    })
  }
}
```

#### Data Encryption

```typescript
class EncryptionService {
  // Encryption at rest (handled by AWS)
  configureDynamoDBEncryption(): DynamoDBConfig {
    return {
      SSESpecification: {
        Enabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: 'alias/aws/dynamodb'
      }
    }
  }
  
  // Encryption in transit
  configureAPIGateway(): APIGatewayConfig {
    return {
      protocols: ['TLS_1_2', 'TLS_1_3'],
      cipherSuites: [
        'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
        'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384'
      ]
    }
  }
  
  // Sensitive data encryption
  async encryptSensitiveField(value: string): Promise<string> {
    const kms = new AWS.KMS()
    const result = await kms.encrypt({
      KeyId: process.env.KMS_KEY_ID,
      Plaintext: value
    }).promise()
    return result.CiphertextBlob.toString('base64')
  }
}
```

#### Audit Logging

```typescript
interface AuditLog {
  PK: string              // "AUDIT#${date}"
  SK: string              // "USER#${userId}#${timestamp}"
  userId: string
  action: AuditAction
  resourceType: 'schedule' | 'video' | 'config'
  resourceId: string
  changes?: Record<string, any>
  ipAddress?: string      // Hashed for privacy
  userAgent?: string
  timestamp: string
  TTL: number            // 7 years retention
}

enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  ACCESS = 'ACCESS',
  EXPORT = 'EXPORT',
  CONSENT_GIVEN = 'CONSENT_GIVEN',
  CONSENT_WITHDRAWN = 'CONSENT_WITHDRAWN'
}
```

#### Data Retention Policies

```typescript
const retentionPolicies = {
  schedules: {
    completed: 90,      // Days after completion
    failed: 30,         // Days after failure  
    cancelled: 7        // Days after cancellation
  },
  videos: {
    published: 180,     // Days after publishing
    unpublished: 30     // Days if never published
  },
  auditLogs: 2555,     // 7 years (legal requirement)
  analytics: 365,       // 1 year for aggregated data
  personalData: 0      // Delete immediately when requested
}
```

---

## Success Metrics

- METRIC-1: Publishing Success Rate — baseline: 95% → target: 99.99% by Q2 2025
- METRIC-2: Scheduling Precision (SLA) — baseline: ±5 minutes → target: 99% within 2 minutes by Q2 2025
- METRIC-3: Cost per Million Posts — baseline: $500 → target: $200 by Q3 2025
- METRIC-4: Mean Time to Recovery — baseline: 30 minutes → target: <5 minutes by Q2 2025
- METRIC-5: API Rate Limit Efficiency — baseline: 60% → target: 95% utilization by Q3 2025
- METRIC-6: Video Processing Success — baseline: N/A → target: 98% success rate by Q2 2025
- METRIC-7: GDPR Compliance — baseline: N/A → target: 100% compliance from launch

## Key Assumptions

- ASSUME-1: Social media platforms maintain current API rate limits → monitor platform announcements
- ASSUME-2: EventBridge Scheduler maintains 14M free tier → review AWS pricing quarterly
- ASSUME-3: Average post payload <1KB → validate with production data
- ASSUME-4: 80% of posts scheduled for business hours → analyze actual patterns

## Risks & Mitigations

- RISK-1 (High): EventBridge 1M schedule limit → Implement schedule rotation and archival
- RISK-2 (High): Platform API changes → Abstract connectors, version APIs, monitor deprecations
- RISK-3 (Medium): DynamoDB hot partitions → Use distributed partition keys, implement sharding
- RISK-4 (Medium): Lambda cold starts affecting precision → Use provisioned concurrency for publishers
- RISK-5 (Low): AWS service outages → Multi-region fallback, SLA monitoring

---

## Cost Analysis & Optimization

### Monthly Cost Breakdown (1M posts/day, 20% video content)

#### EventBridge Scheduler
- 30M monthly invocations
- Free tier: 14M invocations
- Billable: 16M × $1.00/million = **$16.00**

#### Lambda Functions
- Publisher: 30M invocations × $0.20/million = **$6.00**
- Compute: 30M × 512MB × 2sec = **~$25.00**
- Video Processing: 6M × 3GB × 30sec = **~$150.00**
- Schedule Management: ~1M invocations = **$2.00**

#### DynamoDB
- Storage: 100GB = **$25.00**
- Write capacity: 400 WCU = **$180.00**
- Read capacity: 100 RCU = **$13.00**
- Streams: **$10.00**

#### S3 Storage (Video Content)
- Storage: 2TB × $0.023/GB = **$47.00**
- Requests: 10M × $0.0004 = **$4.00**
- Transfer: 1TB × $0.09/GB = **$92.00**

#### MediaConvert (Video Transcoding)
- 6M videos × 60 sec avg × $0.015/min = **$90.00**

#### API Gateway
- 35M API calls × $1.00/million = **$35.00**

#### CloudWatch
- Logs: 100GB × $0.50/GB = **$50.00**
- Metrics: 150 custom metrics = **$45.00**

**Total Monthly Cost: ~$790**

### Optimization Strategies

1. **Reserved Capacity**: 20-30% savings on DynamoDB
2. **Batch Operations**: Reduce Lambda invocations by 40%
3. **Caching**: Minimize DynamoDB reads by 50%
4. **Video Optimization**: 
   - Compress videos before upload (30% size reduction)
   - Use S3 Intelligent-Tiering for automatic cost optimization
   - Cache transcoded videos for reuse
5. **CDN for Videos**: CloudFront for reduced transfer costs
6. **Tiered Storage**: Archive old schedules to S3 Glacier

**Optimized Monthly Cost: ~$450** (with video support)

---

## Implementation Roadmap

### Phase 1: Foundation & GDPR (Weeks 1-4)
- TASK-1: Set up AWS infrastructure with CDK/Terraform
- TASK-2: Implement core DynamoDB tables with GDPR-compliant schemas
- TASK-3: Create Schedule Management Lambda functions
- TASK-4: Integrate EventBridge Scheduler
- TASK-5: Implement GDPR compliance layer (encryption, audit logging)
- TASK-6: Build basic monitoring dashboard with privacy controls

### Phase 2: Video Support (Weeks 5-6)
- TASK-7: Set up S3 buckets with lifecycle policies
- TASK-8: Implement video upload Lambda with streaming
- TASK-9: Integrate AWS MediaConvert for transcoding
- TASK-10: Create video validation and metadata extraction
- TASK-11: Build thumbnail generation service
- TASK-12: Add CDN configuration for video delivery

### Phase 3: Platform Integration (Weeks 7-10)
- TASK-13: Implement Instagram connector with video support
- TASK-14: Add Twitter/X connector with video handling
- TASK-15: Build Facebook connector including Reels
- TASK-16: Create TikTok connector (video-first)
- TASK-17: Create platform abstraction layer
- TASK-18: Implement circuit breaker pattern

### Phase 4: Reliability & Compliance (Weeks 11-13)
- TASK-19: Add comprehensive retry mechanisms
- TASK-20: Implement dead letter queue processing
- TASK-21: Build failure recovery workflows
- TASK-22: Add timezone/DST handling
- TASK-23: Create GDPR data export/deletion APIs
- TASK-24: Implement consent management system
- TASK-25: Create alerting system with SLA monitoring

### Phase 5: Scale Testing (Weeks 14-15)
- TASK-26: Load test with 1M daily posts (20% video)
- TASK-27: Optimize hot partition handling
- TASK-28: Tune Lambda concurrency for video processing
- TASK-29: Validate cost projections with video content
- TASK-30: Performance optimization for 2-minute SLA

### Phase 6: Migration (Weeks 16-17)
- TASK-31: Create migration scripts with data validation
- TASK-32: Implement dual-write pattern
- TASK-33: Gradual traffic migration (10%, 25%, 50%, 100%)
- TASK-34: Deprecate cron system
- TASK-35: Production monitoring and SLA validation

---

## Monitoring & Observability

### Key Metrics Dashboard

#### System Health
- Publishing success rate (target: 99.99%)
- Scheduling precision (P50, P95, P99)
- API rate limit utilization per platform
- Lambda cold start frequency
- DynamoDB throttling rate

#### Business Metrics
- Posts published per minute/hour/day
- Failed posts by reason
- Average retry count
- Platform distribution
- Peak scheduling times

#### Cost Metrics
- Cost per post published
- Lambda invocation costs
- DynamoDB usage costs
- Data transfer costs

### Alerting Strategy

#### Critical Alerts (Page immediately)
- Publishing success rate <99%
- EventBridge Scheduler errors
- DynamoDB throttling >1%
- Platform API authentication failures

#### Warning Alerts (Notify team)
- Publishing success rate <99.9%
- High retry rates (>10%)
- Lambda duration >5 seconds
- Cost anomalies >20%

#### Informational Alerts
- Daily summary reports
- Weekly trend analysis
- Monthly cost reports
- Capacity planning alerts

### Logging Strategy

```typescript
interface StructuredLog {
  timestamp: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  service: string
  operation: string
  scheduleId?: string
  contentId?: string
  platform?: Platform
  userId?: string
  brandId?: string
  duration?: number
  error?: {
    type: string
    message: string
    stack?: string
    retryable: boolean
  }
  metadata?: Record<string, any>
}
```

---

## Migration Strategy

### Current State Assessment
1. Identify all cron jobs in monolithic service
2. Document scheduling patterns and dependencies
3. Analyze historical failure rates
4. Map content to user timezones

### Migration Approach

#### 1. Dual-Write Pattern (Weeks 1-2)
```typescript
class DualWriteAdapter {
  async schedulePost(post: ScheduledPost): Promise<void> {
    // Write to both systems
    await Promise.all([
      this.legacyCron.schedule(post),
      this.newScheduler.schedule(post)
    ])
    
    // Mark for tracking
    await this.migrationTracker.record(post.id, 'DUAL_WRITE')
  }
}
```

#### 2. Gradual Migration (Weeks 3-4)
- 10% of new schedules → microservice
- Monitor metrics, compare with legacy
- Increase to 25%, 50%, 100% over 2 weeks
- Keep legacy system as fallback

#### 3. Validation & Cutover (Week 5)
- Verify all metrics meet SLA
- Run parallel for 1 week at 100%
- Compare results between systems
- Full cutover with rollback plan

#### 4. Legacy Decommission (Week 6)
- Remove cron job configurations
- Archive legacy code
- Update documentation
- Celebrate! 🎉

---

## Validation Criteria

- FEAT-1: Schedule Creation — Successfully schedule 10,000 posts in <5 seconds
- FEAT-2: Publishing Accuracy — 99% of posts published within 2 minutes of target (SLA)
- FEAT-3: Retry Logic — Automatic recovery from transient failures within 5 attempts
- FEAT-4: Platform Support — Successful posting to all major platforms (image & video)
- FEAT-5: Scale Performance — Handle 1M posts/day with <1% error rate
- FEAT-6: Video Processing — Process and publish videos up to 1GB successfully
- FEAT-7: Cost Efficiency — Operate at <$500/month for 1M daily posts (20% video)
- FEAT-8: GDPR Compliance — Full data export in <24 hours, deletion in <72 hours
- FEAT-9: Monitoring — Real-time visibility with SLA tracking dashboard
- FEAT-10: Migration — Zero-downtime migration from legacy system

## Open Questions

### Answered Questions (Decisions Made)
- ~~**High Priority**: Should we implement multi-region failover from day one?~~ **ANSWERED: NO** — Can be added later as needed
- ~~**High Priority**: What is the business impact tolerance for delayed posts?~~ **ANSWERED: 2-5 minutes acceptable** — SLA set at 99% within 2 minutes
- ~~**Medium Priority**: Should we support video content scheduling initially?~~ **ANSWERED: YES** — Full video support required from launch
- ~~**Medium Priority**: Do we need GDPR compliance for scheduling data?~~ **ANSWERED: YES** — Full GDPR compliance required
- ~~**Low Priority**: Should we build a scheduling API for third-party integrations?~~ **ANSWERED: NO** — Not needed initially

### New Questions (Based on Decisions)
- **High Priority**: What is the migration path for adding multi-region support later? — Owner: Architecture Team
- **High Priority**: Which video formats should be prioritized for transcoding? — Owner: Product Team
- **Medium Priority**: Should we implement automatic video compression? — Owner: Engineering Team
- **Medium Priority**: What is the retention policy for failed video uploads? — Owner: Legal/Product Team
- **Low Priority**: Should we support live streaming scheduling in the future? — Owner: Product Team

---

## Appendix A: Platform-Specific Considerations

### Instagram
- Business/Creator accounts required
- Media upload separate from publishing
- Story vs Feed post handling
- Carousel post complexity

### Twitter/X
- Thread scheduling support
- Media upload limits
- Alt text requirements
- Quote tweet handling

### Facebook
- Page vs Personal account
- Cross-posting to Instagram
- Event scheduling
- Ad campaign integration

### TikTok
- Video-first platform
- Sound/music licensing
- Hashtag challenges
- Duet/Stitch scheduling

## Appendix B: Future Multi-Region Migration Path

### Migration Strategy (Post-Launch Enhancement)

Since multi-region failover is not required at launch, here's the recommended migration path when business requirements change:

#### Phase 1: Assessment (2 weeks)
1. **Traffic Analysis**: Identify geographic distribution of users
2. **Latency Metrics**: Measure current response times by region
3. **Cost Analysis**: Calculate multi-region operational costs
4. **Risk Assessment**: Evaluate single-region failure impact

#### Phase 2: Architecture Evolution (4 weeks)
```typescript
// Current: Single Region
const architecture = {
  primary: 'us-east-1',
  database: 'DynamoDB (single region)',
  scheduler: 'EventBridge (regional)',
  storage: 'S3 (single region)'
}

// Future: Multi-Region Active-Passive
const multiRegionArchitecture = {
  primary: 'us-east-1',
  secondary: 'eu-west-1',
  database: 'DynamoDB Global Tables',
  scheduler: 'EventBridge (cross-region replication)',
  storage: 'S3 Cross-Region Replication',
  dns: 'Route 53 with health checks'
}
```

#### Phase 3: Implementation Steps
1. **Enable DynamoDB Global Tables**
   - Zero-downtime conversion from regional tables
   - Automatic multi-master replication
   - ~$200/month additional cost per region

2. **Configure S3 Cross-Region Replication**
   - Enable CRR for video content buckets
   - Use S3 Intelligent-Tiering in secondary region
   - ~$100/month for 2TB replicated

3. **Deploy Lambda Functions Multi-Region**
   - Use AWS SAM for consistent deployments
   - Environment-specific configurations
   - Shared code via Lambda Layers

4. **EventBridge Cross-Region Events**
   - Create event buses in secondary regions
   - Configure rules for cross-region forwarding
   - Implement regional schedule management

5. **Route 53 Failover Configuration**
   - Health checks on primary region
   - Automatic DNS failover (< 60 seconds)
   - Weighted routing for gradual migration

#### Phase 4: Testing & Validation (2 weeks)
- Chaos engineering with region failures
- Load testing across regions
- Data consistency validation
- Failover time measurements

#### Estimated Additional Costs
- **Monthly**: ~$400-600 per additional region
- **One-time Migration**: ~$5,000 in engineering time
- **ROI**: Break-even at 99.99% → 99.999% availability

## Appendix C: Disaster Recovery Plan

### Failure Scenarios

1. **EventBridge Scheduler Outage**
   - Fallback: Lambda polling DynamoDB
   - Recovery Time: <5 minutes
   - Data Loss: Zero

2. **DynamoDB Regional Outage**
   - Fallback: Global table failover
   - Recovery Time: <2 minutes
   - Data Loss: <1 minute of writes

3. **Platform API Outage**
   - Fallback: Queue for later delivery
   - Recovery Time: Automatic when API recovers
   - Data Loss: Zero (queued delivery)

4. **Lambda Service Degradation**
   - Fallback: ECS Fargate tasks
   - Recovery Time: <10 minutes
   - Data Loss: Zero

---

## Conclusion

This microservice architecture provides a robust, scalable, and cost-effective solution for content scheduling that significantly improves upon the current monolithic cron-based system. With 99.99% reliability, sub-minute precision, and comprehensive platform support, it positions Postolio as a leader in social media automation reliability.

The investment in proper architecture, monitoring, and migration planning ensures a smooth transition with zero business disruption while setting the foundation for future growth to 10M+ posts daily.

---

**Document Version**: 2.0.0  
**Last Updated**: January 2025  
**Status**: Updated with Stakeholder Decisions  
**Next Review**: February 2025

**Change Log**:
- v2.0.0 (Jan 2025): Updated with stakeholder decisions:
  - No multi-region at launch (added future migration path)
  - SLA defined as 99% within 2 minutes
  - Full video content support added
  - GDPR compliance implementation added
  - No third-party API initially
  - Updated cost estimates for video content
  - Revised implementation roadmap
- v1.0.0 (Jan 2025): Initial specification