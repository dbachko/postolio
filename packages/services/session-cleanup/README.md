# Session Cleanup Service

AWS Lambda function that performs periodic cleanup of expired and revoked sessions.

## Features

- **Expire Sessions**: Revokes sessions that have exceeded their expiration date
- **Sliding Timeout**: Revokes sessions with 30+ days of inactivity
- **Absolute Timeout**: Revokes sessions older than 90 days
- **Cleanup Old Data**: Deletes revoked sessions older than 180 days

## Scheduled Execution

This Lambda is invoked daily by EventBridge Scheduler to maintain session hygiene.

## Metrics

Publishes CloudWatch metrics:

- `ExpiredSessionsRevoked`: Count of sessions revoked due to expiration
- `SlidingTimeoutExpired`: Count of sessions revoked due to inactivity
- `AbsoluteTimeoutExpired`: Count of sessions revoked due to absolute timeout
- `OldRevokedSessionsDeleted`: Count of old revoked sessions deleted

## Environment

Requires access to the PostgreSQL database via Prisma client.
