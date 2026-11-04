# Backend services

The API uses Lambda services for scheduling, publishing, token storage, and brand analysis. Service code lives in `packages/services`; AWS resources live in `packages/infra/cdk/lib/stacks`.

| Service                     | Responsibility                                        |
| --------------------------- | ----------------------------------------------------- |
| `token-service`             | Platform OAuth tokens in DynamoDB, encrypted with KMS |
| `schedule-management`       | Schedule API and EventBridge schedules                |
| `publisher`                 | Platform publishing                                   |
| `retry-handler`             | Publishing retries                                    |
| `status-sync`               | Status updates from schedule and publishing events    |
| `schedule-cleanup`          | Orphaned schedules                                    |
| `dlq-processor`             | Failed queue messages                                 |
| `brand-analysis`            | Brand style profiles and learning signals             |
| `brand-analysis-projection` | Profile projection in PostgreSQL                      |
| `analytics-ingestor`        | Account and publication metrics (ECS worker)          |
| `session-cleanup`           | Expired and revoked sessions                          |

Each package README lists its development commands. See [STRUCTURE.md](../STRUCTURE.md) for import boundaries, [content scheduler](README-SCHEDULER.md) for the publishing flow, and [deployment stacks](STACK-OPTIMIZATION.md) for AWS grouping.
