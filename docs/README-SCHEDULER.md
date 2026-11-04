# Content scheduler

The scheduling service stores schedules in DynamoDB and uses EventBridge Scheduler to emit `schedule.due` events. The publishing stack routes those events to the publisher.

## Components

- [Schedule management](../packages/services/schedule-management/README.md): schedule API and lifecycle
- [Publisher](../packages/services/publisher/README.md): platform publishing
- [Retry handler](../packages/services/retry-handler/README.md): failed publishing attempts
- [Status sync](../packages/services/status-sync/README.md): status updates from events
- [Schedule cleanup](../packages/services/schedule-cleanup/README.md): orphaned schedules
- [DLQ processor](../packages/services/dlq-processor/README.md): failed messages

## API

The schedule management handler exposes:

- `POST /schedules`
- `POST /schedules/publish-now`
- `GET /schedules/:scheduleId`
- `PUT /schedules/:scheduleId`
- `DELETE /schedules/:scheduleId`
- `GET /schedules`

See `packages/services/schedule-management/src/handlers/http-handler.ts` for payloads and validation.

## Deployment and troubleshooting

Deploy the `scheduling` and `publishing` stacks using the [deployment scripts](../scripts/README.md).

If a post does not publish, inspect the schedule status, EventBridge target permissions, publisher logs, retry queue, and platform credentials in Token Service. See [retry verification](../packages/infra/cdk/RETRY_STRATEGY_TESTING.md).
