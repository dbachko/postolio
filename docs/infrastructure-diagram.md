# Postolio AWS Infrastructure Architecture Diagram

## Complete Microservices Architecture & Communication Flow

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                   🌐 INTERNET USERS                                                    │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                 🎯 EDGE SERVICES LAYER                                                 │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│    ┌──────────────────┐                  ┌──────────────────────┐                    ┌──────────────────┐            │
│    │   📡 Route 53    │                  │   🌍 CloudFront     │                    │    🛡️ AWS WAF     │            │
│    │  DNS Service     │◄─────────────────│   CDN Distribution   │◄───────────────────│  (Production)     │            │
│    │  postolio.example   │                  │   Global Caching     │                    │  Web Security     │            │
│    └──────────────────┘                  └──────────────────────┘                    └──────────────────┘            │
│                                                     │                                                                 │
└────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────┘
                                                      ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                              🚪 API GATEWAY LAYER                                                      │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│   ┌──────────────────────────┐         ┌───────────────────────────┐         ┌──────────────────────────┐           │
│   │  🌐 API Gateway          │         │  🌐 API Gateway           │         │  ⚖️ ALB                   │           │
│   │  Token Service           │         │  Content Scheduler        │         │  Application Load         │           │
│   │  /tokens/*               │         │  /schedules/*             │         │  Balancer                 │           │
│   │  IAM Auth                │         │  IAM Auth                 │         │  HTTPS/SSL                │           │
│   └────────────┬─────────────┘         └──────────┬─────────────────┘         └───────────┬──────────────┘           │
│                │                                   │                                        │                          │
└────────────────┼───────────────────────────────────┼────────────────────────────────────────┼─────────────────────────┘
                 │                                   │                                        │
                 ▼                                   ▼                                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          🔧 APPLICATION SERVICES LAYER                                                  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐         │
│  │                                     🚢 ECS FARGATE CLUSTER                                               │         │
│  │  ┌──────────────────────────────────────────────────────────────────────────────────────────────┐       │         │
│  │  │                            📦 MAIN POSTOLIO SERVICE                                         │       │         │
│  │  │  • Node.js 22 + Fastify                                                                     │       │         │
│  │  │  • User Auth (JWT + 2FA)                                                                    │       │         │
│  │  │  • Brand Management                                                                         │       │         │
│  │  │  • Campaign Orchestration                                                                   │       │         │
│  │  │  • AI Content Generation                                                                    │       │         │
│  │  │  • Analytics & Reporting                                                                    │       │         │
│  │  └──────────────────────────────────────────────────────────────────────────────────────────────┘       │         │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘         │
│                                                                                                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   ⚡ Lambda              │  │   ⚡ Lambda              │  │   ⚡ Lambda              │  │   ⚡ Lambda          │ │
│  │   TOKEN SERVICE          │  │   CONTENT SCHEDULER      │  │   PUBLISHER SERVICE      │  │   GDPR SERVICE      │ │
│  │   • OAuth Storage        │  │   • Schedule CRUD        │  │   • Instagram            │  │   • Data Export     │ │
│  │   • KMS Encryption       │  │   • EventBridge Rules    │  │   • Facebook             │  │   • Data Deletion   │ │
│  │   • Auto Rotation        │  │   • Conflict Resolution  │  │   • LinkedIn             │  │   • Audit Logs      │ │
│  │   • Multi-tenant         │  │   • Time Zone Handling   │  │   • TikTok               │  │                     │ │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│             │                              │                              │                            │              │
│             │                              │                              │                            │              │
└─────────────┼──────────────────────────────┼──────────────────────────────┼────────────────────────────┼──────────────┘
              │                              │                              │                            │
              ▼                              ▼                              ▼                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                               💾 DATA STORAGE LAYER                                                    │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   🗄️ RDS PostgreSQL      │  │   🔥 DynamoDB            │  │   ⚡ Redis ElastiCache   │  │   📂 S3 Buckets      │ │
│  │   Primary Database       │  │   NoSQL Tables          │  │   Caching Layer         │  │                      │ │
│  │   • Users & Auth         │  │   • oauth-tokens        │  │   • Session Storage     │  │  • Frontend Assets   │ │
│  │   • Brands               │  │   • schedules           │  │   • Rate Limiting       │  │  • AI Images         │ │
│  │   • Campaigns            │  │   • retry-queue         │  │   • Temp Data           │  │  • Video Content     │ │
│  │   • Content              │  │   • audit-logs          │  │   Port: 6380            │  │  • Access Logs       │ │
│  │   • Analytics            │  │   • gdpr-retention      │  │                          │  │                      │ │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│                                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          🔌 INTEGRATION & SUPPORT SERVICES                                             │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   🔄 EventBridge         │  │   🔐 Secrets Manager     │  │   🔑 KMS                 │  │   🌐 Cloud Map       │ │
│  │   Event Bus              │  │   API Keys Storage      │  │   Encryption Keys       │  │   Service Discovery  │ │
│  │   • campaign.created     │  │   • OpenAI Keys         │  │   • Token Encryption    │  │   • Dynamic URLs     │ │
│  │   • schedule.ready       │  │   • OAuth Secrets       │  │   • Data Encryption     │  │   • Health Routing   │ │
│  │   • post.published       │  │   • JWT Secrets         │  │   • Key Rotation        │  │   • 30s Cache TTL    │ │
│  │   • token.refreshed      │  │   • Database Creds      │  │                          │  │                      │ │
│  └────────────┬─────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│               │                                                                                                        │
│  ┌────────────▼─────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   📊 CloudWatch          │  │   🔍 X-Ray              │  │   📧 SES                 │  │   📢 SNS             │ │
│  │   Monitoring & Logs      │  │   Distributed Tracing   │  │   Email Service         │  │   Notifications      │ │
│  │   • Metrics              │  │   • Request Tracking    │  │   • Welcome Emails      │  │   • Alert Topics     │ │
│  │   • Alarms               │  │   • Performance         │  │   • 2FA Codes           │  │   • Error Alerts     │ │
│  │   • Dashboards           │  │   • Service Map         │  │   • Reset Links         │  │   • Admin Emails     │ │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│                                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          🌍 EXTERNAL PLATFORM INTEGRATIONS                                             │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   📷 Instagram           │  │   👔 LinkedIn            │  │   📘 Facebook            │  │   🎵 TikTok          │ │
│  │   Graph API              │  │   API v2                 │  │   Graph API             │  │   Business API       │ │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│                                                                                                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐ │
│  │   🤖 OpenAI              │  │   🎨 DALL-E 3            │  │   🔍 Google OAuth       │  │   📹 YouTube         │ │
│  │   GPT-4o                 │  │   Image Generation      │  │   Authentication        │  │   Data API v3        │ │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────┘ │
│                                                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Communication Flows

### 🔄 **Primary Data Flows**

```text
1. USER AUTHENTICATION FLOW
   Users → CloudFront → ALB → ECS (Main App) → PostgreSQL
                                            ↘ Redis (Sessions)

2. CONTENT SCHEDULING FLOW
   Main App → EventBridge Event → Content Scheduler → DynamoDB (Schedules)
           ↘ PostgreSQL (Content)                   ↘ EventBridge Rules

3. PUBLISHING FLOW
   EventBridge Trigger → Publisher Lambda → Token Service → DynamoDB (Tokens)
                      ↘ Platform APIs     ↗ KMS (Decrypt)
                      ↘ S3 (Media)

4. SERVICE DISCOVERY FLOW
   Service A → Cloud Map → Service Registry → Service B URL
           ↘ Cache (30s TTL)            ↗ Health Check

5. TOKEN REFRESH FLOW
   Token Expiry → Token Service → Platform OAuth → KMS Encrypt → DynamoDB
                                                 ↘ EventBridge (token.refreshed)
```

### 🔐 **Security & Authentication Paths**

```text
• User Auth:     JWT + Refresh Tokens (15min/7day)
• Service Auth:  AWS IAM SigV4 between microservices
• OAuth Tokens:  KMS encrypted in DynamoDB
• API Gateway:   IAM authorization for Lambda services
• Secrets:       AWS Secrets Manager for credentials
```

### 📊 **Event-Driven Architecture**

```text
EventBridge Topics:
├── postolio.campaign.created     → Content Scheduler
├── postolio.schedule.ready       → Publisher Lambda
├── postolio.post.published       → Analytics Service
├── postolio.token.refreshed      → Main App Cache Update
├── postolio.content.updated      → Scheduler Update
└── postolio.gdpr.deletion        → GDPR Service
```

### ⚡ **Performance Characteristics**

```text
• API Response:        <200ms (p95)
• Content Generation:  <30s
• Publishing Latency:  <60s
• Service Discovery:   30s cache
• Token Refresh:       7 days before expiry
• Circuit Breaker:     50% error threshold
• Auto-scaling:        CPU 70%, Memory 80%
```

### 💰 **Cost Optimization Points**

```text
• DynamoDB:    Pay-per-request → Provisioned (production)
• S3:          Intelligent tiering with lifecycle policies
• Lambda:      Reserved concurrency only for critical functions
• NAT Gateway: Single instance in development
• CloudFront:  Caching policies reduce origin requests
```

## Deployment Architecture

```text
GitHub Repository
       │
       ▼
GitHub Actions CI/CD
       │
       ├── CDK Synth & Deploy
       │   ├── 1. Service Discovery Stack
       │   ├── 2. Token Service Stack
       │   ├── 3. Content Scheduler Stack
       │   └── 4. Main Postolio Stack
       │
       ├── Docker Build & Push → ECR
       │
       └── Lambda Deployment → S3 → Lambda Functions
```

## Key Architecture Decisions

✅ **Microservices**: Clean boundaries with single responsibilities
✅ **Event-Driven**: Asynchronous via EventBridge
✅ **Service Discovery**: AWS Cloud Map for dynamic URLs
✅ **Hybrid Scheduling**: AWS-primary with local fallback
✅ **Multi-Tenant**: Secure isolation at data layer
✅ **Circuit Breakers**: Resilience for external APIs
✅ **GDPR Compliant**: Automated retention & deletion
```

```mermeid
graph TB
    %% Postolio AWS Architecture Diagram
    %% AI-Powered Social Media Automation Platform
    
    subgraph Internet["🌐 Internet"]
        Users[["👥 Users<br/>Web & Mobile"]]
    end
    
    subgraph EdgeServices["☁️ Edge Services Layer"]
        Route53["📡 Route 53<br/>postolio.example"]
        CloudFront["🌍 CloudFront CDN<br/>Global Distribution"]
        WAF["🛡️ AWS WAF v2<br/>Production Security"]
    end
    
    subgraph APIGateway["🚪 API Gateway Layer"]
        ALB["⚖️ Application Load Balancer<br/>HTTPS/SSL Termination"]
        TokenAPI["🌐 API Gateway<br/>Token Service<br/>IAM Auth"]
        SchedulerAPI["🌐 API Gateway<br/>Content Scheduler<br/>IAM Auth"]
    end
    
    subgraph ComputeServices["🔧 Compute Services"]
        subgraph ECSCluster["🚢 ECS Fargate Cluster"]
            MainApp["📦 Main Postolio Service<br/>Node.js 22 + Fastify<br/>• User Auth (JWT + 2FA)<br/>• Brand Management<br/>• Campaign Orchestration<br/>• AI Content Generation"]
        end
        
        TokenLambda["⚡ Token Service Lambda<br/>• OAuth Storage<br/>• KMS Encryption<br/>• Auto Rotation"]
        SchedulerLambda["⚡ Content Scheduler Lambda<br/>• Schedule CRUD<br/>• EventBridge Rules<br/>• Conflict Resolution"]
        PublisherLambda["⚡ Publisher Lambda<br/>• Multi-Platform<br/>• Adapter Pattern<br/>• Rate Limiting"]
        GDPRLambda["⚡ GDPR Service Lambda<br/>• Data Export<br/>• Data Deletion<br/>• Audit Logs"]
    end
    
    subgraph DataStorage["💾 Data Storage Layer"]
        RDS[("🗄️ RDS PostgreSQL<br/>• Users & Auth<br/>• Brands<br/>• Campaigns<br/>• Content")]
        DynamoTokens[("🔥 DynamoDB<br/>OAuth Tokens<br/>TTL & GSI")]
        DynamoSchedules[("🔥 DynamoDB<br/>Schedules<br/>4 GSIs")]
        Redis[("⚡ ElastiCache Redis<br/>Sessions & Caching<br/>Port 6380")]
        S3Frontend["📂 S3 Frontend<br/>React SPA Assets"]
        S3Images["📂 S3 AI Images<br/>Intelligent Tiering"]
    end
    
    subgraph Integration["🔌 AWS Integration Services"]
        EventBridge["🔄 EventBridge<br/>Event Bus<br/>• campaign.created<br/>• schedule.ready<br/>• post.published"]
        SecretsManager["🔐 Secrets Manager<br/>API Keys & Credentials"]
        KMS["🔑 KMS<br/>Encryption Keys"]
        CloudMap["🌐 Cloud Map<br/>Service Discovery<br/>30s Cache"]
    end
    
    subgraph Monitoring["📊 Monitoring & Observability"]
        CloudWatch["📊 CloudWatch<br/>Metrics & Logs"]
        XRay["🔍 X-Ray<br/>Distributed Tracing"]
        SNS["📢 SNS<br/>Alert Topics"]
        SES["📧 SES<br/>Transactional Email"]
    end
    
    subgraph External["🌍 External Platform APIs"]
        Instagram["📷 Instagram<br/>Graph API"]
        LinkedIn["👔 LinkedIn<br/>API v2"]
        Facebook["📘 Facebook<br/>Graph API"]
        TikTok["🎵 TikTok<br/>Business API"]
        OpenAI["🤖 OpenAI<br/>GPT-4o & DALL-E 3"]
        YouTube["📹 YouTube<br/>Data API v3"]
        Google["🔍 Google OAuth"]
    end
    
    %% Primary Flow Connections
    Users --> Route53
    Route53 --> CloudFront
    CloudFront --> WAF
    CloudFront --> S3Frontend
    WAF --> ALB
    ALB --> MainApp
    
    %% API Gateway Connections
    TokenAPI --> TokenLambda
    SchedulerAPI --> SchedulerLambda
    
    %% Main App Database Connections
    MainApp --> RDS
    MainApp --> Redis
    MainApp --> S3Images
    MainApp --> EventBridge
    MainApp --> CloudMap
    MainApp --> SecretsManager
    
    %% Service-to-Service Communications
    MainApp -.->|SigV4 Auth| TokenAPI
    MainApp -.->|SigV4 Auth| SchedulerAPI
    
    %% Lambda Service Connections
    TokenLambda --> DynamoTokens
    TokenLambda --> KMS
    TokenLambda --> SecretsManager
    SchedulerLambda --> DynamoSchedules
    SchedulerLambda --> EventBridge
    
    %% EventBridge Triggers
    EventBridge -->|Trigger| PublisherLambda
    EventBridge -->|GDPR Events| GDPRLambda
    
    %% Publisher Flow
    PublisherLambda -.->|Get Tokens| TokenLambda
    PublisherLambda --> Instagram
    PublisherLambda --> LinkedIn
    PublisherLambda --> Facebook
    PublisherLambda --> TikTok
    PublisherLambda --> YouTube
    
    %% GDPR Service Connections
    GDPRLambda --> RDS
    GDPRLambda -.-> DynamoTokens
    
    %% External API Connections
    MainApp --> OpenAI
    MainApp -.-> Google
    
    %% Service Discovery Registration
    CloudMap -.-> TokenAPI
    CloudMap -.-> SchedulerAPI
    CloudMap -.-> MainApp
    
    %% Monitoring Connections
    MainApp -.-> CloudWatch
    TokenLambda -.-> CloudWatch
    SchedulerLambda -.-> CloudWatch
    PublisherLambda -.-> CloudWatch
    CloudWatch --> SNS
    MainApp -.-> XRay
    MainApp --> SES
    
    %% Styling
    classDef awsService fill:#FF9900,stroke:#232F3E,stroke-width:2px,color:#fff
    classDef lambda fill:#FF9900,stroke:#FF6600,stroke-width:2px,color:#fff
    classDef database fill:#3369E7,stroke:#1E3A8A,stroke-width:2px,color:#fff
    classDef external fill:#10B981,stroke:#059669,stroke-width:2px,color:#fff
    classDef storage fill:#8B5CF6,stroke:#6D28D9,stroke-width:2px,color:#fff
    
    class Route53,CloudFront,WAF,ALB,TokenAPI,SchedulerAPI,EventBridge,SecretsManager,KMS,CloudMap,CloudWatch,XRay,SNS,SES awsService
    class TokenLambda,SchedulerLambda,PublisherLambda,GDPRLambda lambda
    class RDS,DynamoTokens,DynamoSchedules,Redis database
    class S3Frontend,S3Images storage
    class Instagram,LinkedIn,Facebook,TikTok,OpenAI,YouTube,Google external
    ```
