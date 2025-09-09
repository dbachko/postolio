# Token Management Architecture Specification

**Postolio Social Media Scheduling Platform**  
_Version 1.0 - January 24, 2025_

## Executive Summary

Evaluation and recommendation for OAuth token management architecture supporting 1M posts/month across multiple social channels, comparing centralized token service (Postgres + KMS) versus distributed approach (DynamoDB + KMS).

## Product Overview

- **Purpose**: Secure, scalable management of OAuth tokens for multi-platform social media scheduling
- **Target Scale**: 1 million posts per month (33,000 posts/day)
- **Key Scenarios**: Token storage, retrieval, refresh, and multi-service access
- **Success Definition**: <100ms token retrieval, 99.9% availability, zero security breaches

## Current State Analysis

### Existing Implementation

Based on codebase analysis:

- Tokens currently stored in PostgreSQL alongside user/brand data
- Fields: `instagramAccessToken`, `instagramPageId`, `instagramAccountId`
- No dedicated token service or encryption layer
- Direct database access from multiple services

### Pain Points

- PAIN-1: Token data mixed with business data (violates separation of concerns)
- PAIN-2: No centralized token refresh management
- PAIN-3: Limited encryption (database-level only)
- PAIN-4: Scaling concerns with growing platform support

## Architecture Options Comparison

### Option 1: Central Token Service (PostgreSQL + KMS)

**Architecture Pattern**: Dedicated microservice with API-based access

```
Main App ─────┐
              ├──► Token Service API ──► PostgreSQL + KMS
Scheduler ────┘         │
                       Redis Cache
```

**Implementation Details**:

- Dedicated `token-service` microservice
- PostgreSQL for relational token metadata
- AWS KMS for field-level encryption
- Redis for token caching
- RESTful API with JWT authentication

### Option 2: DynamoDB + KMS (Distributed)

**Architecture Pattern**: Shared NoSQL database with direct service access

```
Main App ─────┐
              ├──► DynamoDB + KMS
Scheduler ────┘         │
                    ElastiCache
```

**Implementation Details**:

- DynamoDB table with composite keys
- Client-side encryption with AWS Encryption SDK
- DAX or ElastiCache for caching
- IAM-based access control

## Detailed Comparison Matrix

| Criteria                 | Central Service (PostgreSQL)     | DynamoDB Direct             | Winner                  |
| ------------------------ | -------------------------------- | --------------------------- | ----------------------- |
| **Performance**          |
| Token Retrieval Latency  | 50-100ms (with cache: 5-10ms)    | 10-20ms (with DAX: 1-5ms)   | DynamoDB                |
| Throughput @ 1M posts/mo | Adequate with connection pooling | Auto-scales to millions/sec | DynamoDB                |
| **Security**             |
| Encryption               | Application + KMS                | Client-side + KMS           | Tie                     |
| Access Control           | API keys/JWT                     | IAM policies                | Central (more flexible) |
| Audit Trail              | Built into service               | CloudTrail                  | Central                 |
| Token Isolation          | Complete via API                 | Partition-based             | Central                 |
| **Scalability**          |
| Horizontal Scaling       | Manual (add instances)           | Automatic                   | DynamoDB                |
| Multi-region             | Complex replication              | Global tables               | DynamoDB                |
| **Cost (Monthly)**       |
| Infrastructure           | ~$200-400 (RDS + EC2)            | ~$100-200 (serverless)      | DynamoDB                |
| KMS Encryption           | $1/key + $0.03/10k ops           | $1/key + $0.03/10k ops      | Tie                     |
| Operational              | Higher (maintenance)             | Lower (managed)             | DynamoDB                |
| **Complexity**           |
| Development Effort       | High (new service)               | Medium (integration)        | DynamoDB                |
| Maintenance              | High (service ops)               | Low (serverless)            | DynamoDB                |
| Testing                  | Complex (service layer)          | Simple (direct access)      | DynamoDB                |
| **Reliability**          |
| Availability             | 99.9% (with HA setup)            | 99.99% (AWS SLA)            | DynamoDB                |
| Backup/Recovery          | Manual setup                     | Automatic PITR              | DynamoDB                |
| Disaster Recovery        | Complex failover                 | Built-in multi-AZ           | DynamoDB                |

## Platform-Specific Token Requirements

### Instagram/Facebook (Meta)

- **Token Lifespan**: 60 days (long-lived)
- **Refresh Pattern**: Can refresh after 24 hours, before expiry
- **Rate Limits**: 200 calls/user/hour
- **Storage Needs**: Access token, page ID, account ID

### LinkedIn

- **Token Lifespan**: 60 days (access), 365 days (refresh)
- **Refresh Pattern**: Programmatic refresh for approved partners
- **Rate Limits**: Varies by endpoint (not published)
- **Storage Needs**: Access token, refresh token, member ID

### Future Platforms (TikTok, X/Twitter)

- Similar 60-day patterns emerging as industry standard
- Need flexible schema for platform-specific metadata

## Industry Best Practices Analysis

### What Leading Platforms Do

- **Buffer/Hootsuite**: Centralized token management (not publicly detailed)
- **AWS Recommendations**: DynamoDB for high-scale token storage
- **OAuth 2.0 Standards**: Emphasize token rotation and secure storage

### Key Patterns

1. **Token Refresh Automation**: Background jobs refresh tokens at 80% of lifespan
2. **Graceful Degradation**: Fallback mechanisms for token failures
3. **Platform Abstraction**: Unified interface hiding platform differences

## 🎯 Recommendation: Hybrid Approach with DynamoDB Primary

### Recommended Architecture

```yaml
Primary Storage: DynamoDB with KMS encryption
Caching Layer: ElastiCache Redis
Access Pattern: Direct with abstraction layer
Backup Strategy: PostgreSQL shadow copy for analytics
```

### Why This Approach

**Rationale**:

1. **Scale-Ready**: DynamoDB handles current 1M posts/month with room for 100x growth
2. **Cost-Effective**: ~50% lower TCO than central service
3. **Simple Operations**: Serverless reduces operational burden
4. **Performance**: Sub-20ms token retrieval meets all requirements
5. **Security**: Client-side encryption exceeds compliance requirements

### Implementation Architecture

```typescript
// Token Storage Schema (DynamoDB)
{
  PK: "USER#{userId}",
  SK: "TOKEN#PLATFORM#{platform}#BRAND#{brandId}",
  accessToken: encrypted_string,
  refreshToken: encrypted_string,
  expiresAt: ISO8601,
  platformData: {
    // Platform-specific fields
    pageId?: string,
    accountId?: string,
    scopes?: string[]
  },
  metadata: {
    createdAt: ISO8601,
    lastUsed: ISO8601,
    refreshCount: number
  },
  TTL: unix_timestamp // Auto-cleanup expired tokens
}
```

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

- TASK-1: Create DynamoDB table with encryption
- TASK-2: Implement TokenManager abstraction layer
- TASK-3: Add client-side encryption with AWS SDK
- TASK-4: Set up ElastiCache for token caching

### Phase 2: Migration (Week 3-4)

- TASK-5: Create migration script from PostgreSQL
- TASK-6: Implement dual-write for transition period
- TASK-7: Add comprehensive logging and monitoring
- TASK-8: Test with staging environment

### Phase 3: Integration (Week 5-6)

- TASK-9: Update main app to use TokenManager
- TASK-10: Update scheduler service integration
- TASK-11: Implement token refresh automation
- TASK-12: Add platform-specific adapters

### Phase 4: Optimization (Week 7-8)

- TASK-13: Performance tuning and caching strategy
- TASK-14: Implement backup and recovery procedures
- TASK-15: Security audit and penetration testing
- TASK-16: Documentation and runbooks

## Success Metrics

- METRIC-1: Token retrieval latency — baseline: 100ms → target: <20ms by March 2025
- METRIC-2: System availability — baseline: 99.5% → target: 99.9% by March 2025
- METRIC-3: Token refresh success rate — baseline: 95% → target: 99.5% by March 2025
- METRIC-4: Security incidents — baseline: 0 → target: 0 maintained

## Key Assumptions

- ASSUME-1: DynamoDB global tables not needed initially → validation: monitor latency
- ASSUME-2: 1M posts/month growth rate sustainable → validation: capacity planning
- ASSUME-3: Platform APIs remain stable → validation: API monitoring

## Risks & Mitigations

- RISK-1 (Medium): DynamoDB vendor lock-in → mitigation: Abstract with TokenManager interface
- RISK-2 (Low): Cache invalidation complexity → mitigation: TTL-based strategy with events
- RISK-3 (Low): Migration data loss → mitigation: Dual-write period with validation

## Security Best Practices

### Encryption Strategy

```typescript
// Multi-layer encryption approach
class SecureTokenManager {
  async storeToken(token: OAuthToken): Promise<void> {
    // 1. Client-side encryption
    const encrypted = await this.encryptWithKMS(token.accessToken);

    // 2. DynamoDB encryption at rest
    await dynamodb.putItem({
      TableName: "oauth-tokens",
      Item: {
        ...tokenData,
        accessToken: encrypted,
        // Additional security metadata
        encryptionKeyId: this.kmsKeyId,
        encryptionVersion: "v1",
      },
    });

    // 3. Audit logging
    await this.auditLog.record({
      action: "TOKEN_STORED",
      platform: token.platform,
      userId: token.userId,
    });
  }
}
```

### Access Control

- **Least Privilege**: Services only access their required tokens
- **Rotation Policy**: KMS keys rotated annually
- **Monitoring**: CloudWatch alarms for suspicious access patterns

## Cost Analysis

### Current State (PostgreSQL in RDS)

- RDS instance (db.t3.medium): $70/month
- Storage (100GB): $12/month
- Backups: $10/month
- **Total**: ~$92/month (token portion of shared database)

### Proposed State (DynamoDB)

- DynamoDB on-demand: ~$50/month at current scale
- KMS: $1/month + negligible API costs
- ElastiCache (cache.t3.micro): $13/month
- **Total**: ~$64/month (30% cost reduction)

### Scale Projections (10M posts/month)

- PostgreSQL approach: ~$500-800/month
- DynamoDB approach: ~$150-250/month

## Validation Criteria

- FEAT-1: Token storage and retrieval in <20ms for 95th percentile
- FEAT-2: Automatic token refresh 7 days before expiration
- FEAT-3: Platform-agnostic token interface supporting 5+ platforms
- FEAT-4: Zero-downtime migration from current system

## Open Questions

- **High Priority**: Should we implement token versioning for rollback capability? — Owner: Architecture Team
- **Medium Priority**: Do we need cross-region replication initially? — Owner: DevOps Team
- **Low Priority**: Should we build admin UI for token management? — Owner: Product Team

## Appendix: Code Examples

### TokenManager Interface

```typescript
interface TokenManager {
  // Core operations
  storeToken(
    userId: string,
    brandId: string,
    platform: string,
    token: OAuthToken,
  ): Promise<void>;
  getToken(
    userId: string,
    brandId: string,
    platform: string,
  ): Promise<OAuthToken | null>;
  refreshToken(
    userId: string,
    brandId: string,
    platform: string,
  ): Promise<OAuthToken>;
  revokeToken(userId: string, brandId: string, platform: string): Promise<void>;

  // Bulk operations
  getTokensForUser(userId: string): Promise<OAuthToken[]>;
  getExpiringTokens(withinDays: number): Promise<OAuthToken[]>;

  // Platform-specific
  getPlatformMetadata(platform: string): PlatformConfig;
}
```

### Migration Strategy

```typescript
// Dual-write during migration
class DualWriteTokenManager implements TokenManager {
  async storeToken(
    userId: string,
    brandId: string,
    platform: string,
    token: OAuthToken,
  ): Promise<void> {
    // Write to both systems
    await Promise.all([
      this.postgresStore.storeToken(userId, brandId, platform, token),
      this.dynamoStore.storeToken(userId, brandId, platform, token),
    ]);

    // Log discrepancies for monitoring
    await this.compareAndLog(userId, brandId, platform);
  }

  async getToken(
    userId: string,
    brandId: string,
    platform: string,
  ): Promise<OAuthToken | null> {
    // Read from new system, fallback to old
    try {
      return await this.dynamoStore.getToken(userId, brandId, platform);
    } catch (error) {
      console.warn("DynamoDB read failed, falling back to PostgreSQL", error);
      return await this.postgresStore.getToken(userId, brandId, platform);
    }
  }
}
```

---

**Document Version**: 1.0  
**Last Updated**: January 24, 2025  
**Status**: Ready for Review  
**Next Steps**: Architecture team review and approval
