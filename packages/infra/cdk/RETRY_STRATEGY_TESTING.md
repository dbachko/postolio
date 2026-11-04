# Verify publishing retries

Retry behavior is implemented in `packages/services/retry-handler/src/retry-strategy.ts` and `src/domain/retry-processor.ts`. Check their limits and error classification when changing publishing failures.

## Scenarios

Use a development environment and test content:

1. Authentication failure: confirm the attempt is marked failed according to the circuit-breaker policy.
2. Rate limit: confirm the retry delay and scheduling reflect the classified error.
3. Transient server failure: confirm backoff increases between attempts and includes jitter.
4. Retry limit reached: confirm the schedule reaches a terminal state.
5. Malformed queue message: confirm failure handling does not create an unbounded retry loop.
6. Successful retry: confirm stored status and emitted events reflect publication.

Inspect the publisher and retry-handler logs, EventBridge retry schedules, stored attempt counts, and queue depth. Count publisher attempts for the same schedule ID rather than relying on total Lambda invocations.

## Deployment

Use the [deployment scripts](../../../scripts/README.md) to deploy the publishing stack. Verify Token Service access and the scheduler execution role configuration before testing retries.
