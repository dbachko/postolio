# Infrastructure deployment

Run deployments from the repository root using `scripts/deploy-stack.sh`. Configure AWS credentials and a root `.env` first.

```bash
./scripts/deploy-stack.sh -e dev all
./scripts/deploy-stack.sh -e staging api
```

See the [script reference](../../../scripts/README.md) for stack names, options, environment variables, and dependency order. GitHub deployments use [manual workflows](../../../.github/workflows/README.md).

## Scheduling and publishing

EventBridge Scheduler sends events to the scheduling event bus. The publishing stack routes events with source `postolio.scheduling` and detail type `schedule.due` to the publisher Lambda.

The scheduling stack publishes the scheduler execution role ARN at `/postolio/{environment}/scheduling/scheduler-events-role-arn` for retry handling.

Inspect CloudFormation events, service logs, and the selected environment's SSM parameters when a deployment fails.
