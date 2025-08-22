# Postolio Documentation

## Core Implementation Plans

### Active Features
- [Scheduling Status Synchronization](SCHEDULING_STATUS_PLAN.md) - WebSocket-based real-time status updates
- [Campaign Editing](implementation-plan-campaign-editing.md) - ✅ COMPLETED - Edit campaigns with automatic regeneration
- [Content Calendar](implementation-plan-content-calendar.md) - Dedicated content management page
- [Calendar Filters & Export](implementation-plan-calendar-filters-export.md) - Advanced filtering and export capabilities
- [Individual Post Page](individual-post-page.implementation.md) - Detailed post view and management
- [Live Mock Preview](live-mock-preview.implementation.md) - Instagram-style post preview
- [Manual Post Creation](implementation-plan-manual-post-creation.md) - Create posts from scratch with media upload

### Infrastructure & Deployment
- [AWS Deployment Strategy](AWS_DEPLOYMENT_STRATEGY.md) - Cloud deployment architecture
- [Infrastructure Architecture](INFRASTRUCTURE_ARCHITECTURE.md) - System design and components
- [Content Scheduler Microservice](content-scheduler-microservice.implementation.md) - AWS Lambda-based scheduler
- [Content Scheduler Deployment](content-scheduler-deployment-guide.md) - Production deployment guide
- [Production Runbook](production-runbook.md) - Operations and maintenance guide
- [OIDC Setup](OIDC_SETUP.md) - GitHub Actions AWS authentication

### Configuration & Migration
- [Configuration Management](CONFIGURATION-MANAGEMENT.md) - Environment and secrets management
- [Content Status Migration](CONTENT_STATUS_MIGRATION.md) - Database migration strategy
- [Migration Strategy](MIGRATION_STRATEGY.md) - System migration approach
- [Deployment Summary](DEPLOYMENT_SUMMARY.md) - Deployment status and notes

### Security
- [Authentication Security Upgrade](authentication-security-upgrade.md) - Enhanced auth implementation
- [AWS SigV4 Implementation](aws-sigv4-implementation-review.md) - ✅ APPROVED - ECS task role authentication

## GitHub Issues & Improvements
See [github-issues/](github-issues/) directory for tracked improvements and feature requests.