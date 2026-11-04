# GitHub Actions

| Workflow                    | Trigger                                   | Tasks                                                                                                                  |
| --------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pr-checks.yml`             | Pull request opened, updated, or reopened | Build, lint, typecheck, format, unit and database integration tests, browser checks, dependency audit, and secret scan |
| `deploy.yml`                | Manual                                    | Resolve ref, select stacks, build images, deploy CDK stacks, and deploy the frontend                                   |
| `deploy-vps.yml`            | Manual                                    | Build images, push to GHCR, and deploy Docker Compose over SSH                                                         |
| `cleanup.yml`               | Daily at 02:00 UTC or manual              | Clean up ECR images, Lambda versions, and CloudWatch log streams                                                       |
| `cleanup-failed-stacks.yml` | Manual                                    | Delete failed CloudFormation stacks                                                                                    |

## AWS deployment

Select a ref, environment (`dev`, `staging`, or `prod`), and stacks. Use `all`, `changed`, or a comma-separated stack list. `changed` uses the deployment diff to select stacks and images.

```bash
gh workflow run deploy.yml -f ref=main -f environment=staging -f stacks=changed
gh workflow run deploy.yml -f ref=main -f environment=dev -f stacks=api,web
```

The workflow builds images, deploys CDK stacks sequentially, and uploads the frontend. Inspect the deployment plan and job summaries to see which packages were selected.

Configure GitHub environments and their AWS credentials, secrets, and variables before deploying. The workflow files contain the required names; [`.env.example`](../../.env.example) documents application settings. Set `TURBO_TOKEN` and `TURBO_TEAM` to enable remote caching.

See [local deployment scripts](../../scripts/README.md) for stack names and configuration. For VPS deployment secrets and host setup, see the [VPS guide](../../docs/VPS_DEPLOYMENT.md).

## Pull request checks

- Code quality: builds, lint, TypeScript checks, and Prettier.
- Tests: unit tests and assets API integration tests against disposable PostgreSQL.
- Browser validation: builds the web app and runs Playwright checks and screenshots.
- Security: checks private artifacts, audits dependencies, and scans the source tree with Gitleaks.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for local commands.

## Cleanup

Review the selected environment, retention settings, and dry-run input before running cleanup. The failed-stack workflow can target one named stack or failed stacks in an environment.

## Troubleshooting

Start with the failed job's logs. For deployment failures, inspect CloudFormation events and service logs. For unexpected stack selection, inspect `detect-changes`, its base ref, and the path filters in `deploy.yml`.
