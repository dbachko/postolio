# Token Service Integration & Microservices Communication Standards - Product Specification

## Executive Summary

Establish secure, scalable OAuth token management and standardized inter-service communication patterns for Postolio's microservices architecture, eliminating token storage duplication and API key dependencies.

## Product Overview

- **Purpose**: Centralize OAuth token management with enterprise-grade security while establishing clear service boundaries and communication standards
- **Target Users**: Development team maintaining services, DevOps managing infrastructure, Security team ensuring compliance
- **Key Scenarios**:
  - Secure storage and retrieval of OAuth tokens across multiple social platforms
  - Automatic token refresh without service interruption
  - Standardized service-to-service authentication and communication

## Jobs To Be Done

- When managing OAuth tokens for multiple platforms, I want centralized secure storage, so I can ensure consistent security and avoid duplication
- When services need to communicate, I want standardized patterns, so I can maintain loose coupling and scale independently
- When tokens expire, I want automatic refresh handling, so I can prevent service disruptions
- When debugging issues, I want clear service boundaries, so I can quickly identify and fix problems
- When scaling the platform, I want independent service deployment, so I can optimize resources efficiently

## Core Features

- FEAT-TOKEN-1: Token Service Migration — Replace database token storage with DynamoDB + KMS encryption service
- FEAT-TOKEN-2: Service Authentication — Implement IAM-based service-to-service authentication
- FEAT-TOKEN-3: Event-Driven Communication — Standardize EventBridge patterns for async operations
- FEAT-TOKEN-4: API Gateway Integration — Consolidate external-facing APIs through single gateway
- FEAT-TOKEN-5: Direct URLs — Endpoint resolution via environment variables (optionally SSM-backed); Service Discovery removed
- FEAT-TOKEN-6: Token Lifecycle Management — Automatic refresh, rotation, and expiration handling

## Current State Analysis

### What Exists (Working)

- Token Service fully implemented with KMS encryption (unused)
- EventBridge configured for event-driven architecture
- Publisher Lambdas with circuit breaker patterns
- Content Scheduler with DynamoDB sharding

### Critical Issues

- **Duplicate Storage**: Tokens in both Prisma DB and DynamoDB (security risk)
- **Tight Coupling**: Publisher calls back to main app for credentials (latency)
- **Missing Integration**: Token Service not connected to main app
- **API Key Dependency**: Publisher using API keys instead of IAM

## Architecture Decisions

### Decision 1: Token Storage Strategy

**Choice**: DynamoDB with KMS Customer Managed Keys

- **Rationale**: Industry best practice (Hootsuite model), $0.000064/operation vs $0.05/secret with Secrets Manager
- **Security**: Customer-managed KMS keys provide full control and audit trails
- **Performance**: Single-digit millisecond latency even with encryption

### Decision 2: Service Communication Pattern

**Choice**: Hybrid EventBridge + API Gateway

- **Sync Operations**: API Gateway for user-facing requests (< 1s response)
- **Async Operations**: EventBridge for background processing
- **Rationale**: Combines low latency for UX with resilience for background tasks

### Decision 3: Authentication Strategy

**Choice**: AWS IAM for service-to-service, JWT for client-to-service

- **Internal**: IAM roles with temporary credentials (SigV4)
- **External**: JWT tokens with short expiration (15 min)
- **Rationale**: Zero-trust security model with minimal credential exposure

## Implementation Roadmap

### Phase 1: Token Service Integration (3 days)

- Update main app to use Token Service API
- Implement token service client SDK
- Add fallback to database during migration
- Monitor token service performance

### Phase 2: Token Migration (1 day)

- Script to migrate existing tokens to DynamoDB
- Encrypt tokens with KMS during migration
- Verify token integrity post-migration
- Update monitoring dashboards

### Phase 3: Publisher Optimization (2 days)

- Include credentials in SQS messages
- Remove `/publisher/credentials` endpoint
- Update publisher to use Token Service directly
- Test end-to-end publishing flow

### Phase 4: Database Cleanup (1 day)

- Remove token columns from brands table
- Update backup procedures
- Clean unused API endpoints
- Update documentation

## Service Boundaries

| Service       | Responsibility                                  | Database           | Communication          |
| ------------- | ----------------------------------------------- | ------------------ | ---------------------- |
| Main App      | User management, content generation, scheduling | PostgreSQL         | REST API + EventBridge |
| Token Service | OAuth token storage, refresh, encryption        | DynamoDB + KMS     | Internal REST API      |
| Scheduler     | Schedule management, EventBridge rules          | DynamoDB (sharded) | EventBridge + API      |
| Publisher     | Platform API integration, content publishing    | DynamoDB (state)   | SQS + EventBridge      |

## Success Metrics

- METRIC-1: Token Retrieval Latency — < 50ms p99 latency
- METRIC-2: Token Refresh Success — 99.9% automatic refresh success rate
- METRIC-3: Service Decoupling — Zero direct database access between services
- METRIC-4: Security Compliance — 100% tokens encrypted with KMS
- METRIC-5: Cost Efficiency — < $100/month for 10,000 active users

## Risks

- RISK-1: Migration data loss → Comprehensive backup before migration, rollback plan ready
- RISK-2: Service communication failures → Circuit breakers and exponential backoff implemented
- RISK-3: Token refresh failures → Proactive refresh 7 days before expiry, manual override available
- RISK-4: Cost overruns → CloudWatch billing alerts, request throttling at service level

## Constraints

- **Technical**: Must maintain backward compatibility during migration
- **Business**: Zero downtime migration required
- **Compliance**: GDPR/CCPA compliant token storage and deletion

## Communication Standards

### Event Naming Convention

````bash
postolio.<service>.<entity>.<action>
Examples:
- postolio.scheduler.content.scheduled
- postolio.publisher.post.published
- postolio.token.refresh.completed
```bash

### API Response Format

```json
{
  "success": boolean,
  "data": object | null,
  "error": {
    "code": "string",
    "message": "string"
  } | null,
  "metadata": {
    "requestId": "string",
    "timestamp": "ISO8601"
  }
}
````

### Service Health Check Standard

```http
GET /health
Response: {
  "status": "healthy|degraded|unhealthy",
  "version": "string",
  "dependencies": [{
    "service": "string",
    "status": "string"
  }]
}
```

## Cost Analysis

### Current State (Problematic)

- Database token storage: Part of RDS costs (~$100/month)
- Security risk of unencrypted tokens: Potential breach costs

### Future State (Optimized)

- DynamoDB on-demand: ~$30/month for 100K operations
- KMS encryption: $1/month per key + $0.03/10K requests
- Total: < $35/month with enterprise security

## Validation Criteria

- All tokens successfully migrated without data loss
- Zero failed publishes due to token issues for 7 days
- Service communication latency < 100ms p95
- 100% of tokens encrypted with customer-managed KMS keys
- Successful rollback test completed

## Traceability

| Feature      | Implementation Tasks                         | Status      |
| ------------ | -------------------------------------------- | ----------- |
| FEAT-TOKEN-1 | Token migration script, service integration  | 📋 Planned  |
| FEAT-TOKEN-2 | IAM role configuration, SigV4 implementation | 📋 Planned  |
| FEAT-TOKEN-3 | Event schema registry, event handlers        | ✅ Partial  |
| FEAT-TOKEN-4 | API Gateway configuration, rate limiting     | 📋 Planned  |
| FEAT-TOKEN-5 | Parameter Store setup, service registry      | 📋 Planned  |
| FEAT-TOKEN-6 | Refresh Lambda, expiry monitoring            | ✅ Complete |

## Implementation Decisions

Based on project status (no customers yet), we can implement a clean architecture transition:

- **Migration Strategy**: Hard replace - no gradual rollout needed
- **Fallback Period**: 7 days of database token retention for safety
- **Deployment**: Single region (us-east-1) initially
- **Monitoring**: CloudWatch with option to add X-Ray later
- **Rate Limiting**: Per-service limits (1000/min) initially

### PAUSE FOR FEEDBACK
