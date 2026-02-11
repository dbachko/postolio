# WebSocket Implementation Product Specification

## Executive Summary

Real-time bidirectional communication system for Postolio using AWS infrastructure with proper subdomain routing to ensure reliable WebSocket connections at scale.

## Product Overview

- **Purpose**: Enable real-time status updates and notifications for content scheduling and publishing operations
- **Target Users**: Content creators and social media managers using Postolio platform
  - **Key Scenarios**:
    1. Real-time content status updates (scheduled → publishing → published)
    2. Content generation progress notifications
    3. Live error notifications for failed publications

## Core Features

- FEAT-1: WebSocket Connection Management — Persistent bidirectional connections with automatic reconnection
- FEAT-2: Subdomain Routing — Dedicated subdomain for WebSocket traffic bypassing CDN limitations
- FEAT-3: Multi-Region Support — WebSocket connections work across all deployed regions
- FEAT-4: Sticky Sessions — Session affinity for WebSocket connections to maintain state
- FEAT-5: Health Monitoring — Heartbeat mechanism and connection health tracking

## Jobs To Be Done

- When content is scheduled, I want to see real-time status changes, so I can monitor publication progress
- When publishing fails, I want immediate notification, so I can take corrective action quickly
- When multiple team members work on the same content and schedules, I want live updates, so I can avoid conflicts
- When connection drops, I want automatic reconnection, so I can maintain real-time awareness

## Current Implementation Analysis

### Issues Identified

1. **Hardcoded Domain Problem**
   - Code hardcodes `postolio.example` regardless of actual deployment domain
   - When main domain is `postolio.example`, WebSocket still tries `postolio.example`
   - Route 53 record not created correctly due to conditional logic

2. **CloudFront Consideration**
   - CloudFront now SUPPORTS WebSocket (since 2018) with proper header forwarding
   - Previous assumption about CloudFront limitations may be outdated
   - Still valid to use subdomain for direct ALB connection to reduce latency

3. **Configuration Issues**
   - Certificate SAN doesn't match actual WebSocket domain being used
   - Environment variable `WS_DOMAIN` not consistently set
   - Frontend fallback logic creates confusion

## Proper Architecture Solution

### Option 1: Direct ALB Connection (Currently Attempted)

```
Client → postolio.example → Route 53 → ALB → ECS Tasks
         (bypass CloudFront)
```

**Pros**: Lower latency, direct connection
**Cons**: Requires separate subdomain management

### Option 2: CloudFront WebSocket Support (Modern Approach)

```
Client → postolio.example/ws → CloudFront → ALB → ECS Tasks
         (with proper headers)
```

**Pros**: Unified domain, CloudFront benefits (DDoS protection, edge locations)
**Cons**: Slightly higher latency

### Option 3: Dynamic Subdomain (Flexible)

```
Client → ws.{environment}.postolio.example → Route 53 → ALB → ECS Tasks
         (environment-specific)
```

**Pros**: Environment isolation, clear separation
**Cons**: More complex certificate management

## Recommended Solution

### Selected Approach: CloudFront WebSocket (Option 2)

Based on our analysis, we're implementing the modern CloudFront WebSocket approach because:

- **Simplified Architecture**: No separate subdomain management
- **Better Performance**: CloudFront edge locations reduce latency globally
- **Enhanced Security**: DDoS protection at edge locations
- **Cost Effective**: Leverages existing CloudFront distribution
- **Future Proof**: Aligns with AWS best practices since 2018

### Implementation Phases

#### Phase 1: CloudFront Configuration

1. **Create WebSocket Origin Request Policy**

   ```typescript
   const wsOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'WebSocketOriginPolicy', {
     headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
       'Sec-WebSocket-Key',
       'Sec-WebSocket-Version',
       'Sec-WebSocket-Protocol',
       'Sec-WebSocket-Accept',
       'Sec-WebSocket-Extensions',
       'Upgrade',
       'Connection',
       'Authorization'
     ),
     cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
     queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
   });
   ```

2. **Add `/ws` Behavior to CloudFront**
   ```typescript
   '/ws': {
     origin: apiOrigin,
     viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
     allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
     cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
     originRequestPolicy: wsOriginRequestPolicy,
   }
   ```

#### Phase 2: Backend Configuration

1. **Unify WebSocket Path**
   - Always use `/ws` path regardless of environment
   - Remove WS_DOMAIN environment variable dependency

2. **Return Relative Path**
   - Config endpoint returns `{wsUrl: '', useRelative: true}`
   - Let frontend construct URL from current location

#### Phase 3: Frontend Updates

1. **Use Main Domain**
   ```typescript
   const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
   const wsUrl = `${protocol}//${window.location.host}/ws`;
   ```

#### Phase 4: Cleanup

1. **Remove Subdomain Logic**
   - Delete postolio.example Route 53 record creation
   - Remove certificate SAN for postolio.example
   - Clean up WS_DOMAIN environment variable

## Constraints

- **Technical**:
  - ALB supports WebSocket natively on Layer 7
  - ECS tasks must maintain WebSocket connection state
  - Redis required for multi-instance coordination
- **Business**:
  - Zero downtime migration required
  - Must maintain backward compatibility during transition
- **Security**:
  - TLS 1.2+ required for all WebSocket connections
  - JWT authentication required before WebSocket upgrade

## Success Metrics

- METRIC-1: Connection Success Rate — Target: >99.5%
- METRIC-2: Average Reconnection Time — Target: <3 seconds
- METRIC-3: Message Delivery Latency — Target: <100ms p99
- METRIC-4: Concurrent Connections — Target: Support 10,000+
- METRIC-5: Uptime — Target: 99.9% availability

## Implementation Steps

1. **Immediate Fix**
   - Update CDK to always create `postolio.example` Route 53 record in production
   - Ensure certificate includes correct SAN
   - Deploy infrastructure changes

2. **Verification**
   - Confirm Route 53 record exists: `aws route53 list-resource-record-sets`
   - Test WebSocket connection: `wscat -c wss://postolio.example`
   - Monitor CloudWatch metrics for connection success

3. **Long-term Improvement**
   - Evaluate CloudFront WebSocket support for unified domain
   - Implement connection pooling and multiplexing
   - Add WebSocket-specific monitoring and alerting

## Risks

- RISK-1: DNS propagation delays → Mitigation: Pre-create records before switching
- RISK-2: Certificate validation failures → Mitigation: Validate ACM certificate before deployment
- RISK-3: Load balancer connection limits → Mitigation: Configure appropriate scaling policies
- RISK-4: WebSocket connection storms → Mitigation: Implement exponential backoff in clients

## Best Practices Applied

1. **AWS Application Load Balancer**
   - Native WebSocket support at Layer 7
   - Sticky sessions using application cookies
   - Health checks on `/api/health` endpoint

2. **Route 53 Configuration**
   - Use alias records for ALB (no charge for queries)
   - Separate subdomain for WebSocket traffic
   - Health check routing policies

3. **Security**
   - TLS termination at ALB
   - Security groups restrict traffic appropriately
   - WAF rules protect against WebSocket attacks

4. **Monitoring**
   - CloudWatch metrics for connection counts
   - Custom metrics for WebSocket-specific events
   - X-Ray tracing for request flow

## Traceability

| Feature | Implementation              | Status       |
| ------- | --------------------------- | ------------ |
| FEAT-1  | WebSocket plugin in Fastify | Implemented  |
| FEAT-2  | Route 53 subdomain setup    | Needs Fix    |
| FEAT-3  | Multi-region not yet needed | Not Started  |
| FEAT-4  | ALB sticky sessions         | Configurable |
| FEAT-5  | Heartbeat mechanism         | Implemented  |

## Decisions Made

- **Architecture**: ✅ **CloudFront WebSocket** - Simplified domain management selected
- **Monitoring**: ✅ **YES** - Add custom CloudWatch metrics for WebSocket events
- **Rate Limiting**: ✅ **Connection-level limits** - Implement in middleware layer
- **Scaling**: ✅ **Simple solution** - Start with default ALB, scale based on actual usage
- **Failover**: ✅ **NO** - No SSE fallback (unnecessary complexity)
- **Cost Analysis**: ✅ **NO** - Not needed, use existing CloudFront

## Simple Implementation Approach

### Core Principles

- **No over-engineering** - Use AWS defaults where possible
- **Scale on demand** - Monitor actual usage, adjust as needed
- **Minimal complexity** - Avoid unnecessary fallback mechanisms

### CloudWatch Metrics (Simple)

```typescript
// Track only essential metrics
await cloudWatch.putMetricData({
  Namespace: 'Postolio/WebSocket',
  MetricData: [
    { MetricName: 'ConnectionCount', Value: 1, Unit: 'Count' },
    { MetricName: 'MessagesSent', Value: 1, Unit: 'Count' },
    { MetricName: 'ConnectionErrors', Value: 1, Unit: 'Count' },
  ],
});
```

### Rate Limiting (Simple)

```typescript
// Connection-level rate limiting in middleware
const connectionLimits = new Map(); // userId -> connection count

fastify.get('/ws', { websocket: true }, (connection) => {
  const userId = getUserFromToken(connection);
  const currentConnections = connectionLimits.get(userId) || 0;

  if (currentConnections >= 5) {
    // Max 5 connections per user
    connection.close(1008, 'Connection limit exceeded');
    return;
  }

  connectionLimits.set(userId, currentConnections + 1);
  // ... rest of WebSocket logic
});
```

**IMPLEMENTATION READY**
