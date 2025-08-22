# PowerTools Lambda Layer

This directory contains the AWS Lambda PowerTools layer used by the ContentScheduler microservice.

## Dependencies

The layer includes:
- `@aws-lambda-powertools/logger` - Structured logging
- `@aws-lambda-powertools/tracer` - Distributed tracing
- `@aws-lambda-powertools/metrics` - CloudWatch metrics
- AWS SDK v3 clients for various services

## Important: Installation Required

**The `nodejs/node_modules` directory must be populated before CDK deployment!**

### Automatic Installation

Dependencies are automatically installed via:
- **CI/CD**: GitHub Actions workflow installs them during deployment
- **Local Development**: `postinstall` script runs after `npm install` in aws-infrastructure
- **NPM Scripts**: All `deploy:scheduler:*` scripts run `prepare:layers` first
- **Deployment Scripts**: `deploy-scheduler.sh` installs them automatically

### Manual Installation

If needed, you can manually install dependencies:

```bash
cd aws-infrastructure/lib/layers/powertools/nodejs
npm install
```

## Troubleshooting

If you see Lambda import errors like:
```
Error: Cannot find module '@aws-lambda-powertools/logger'
```

This means the layer dependencies weren't installed before deployment. Run:
```bash
cd aws-infrastructure
npm run prepare:layers
npm run deploy:scheduler:dev
```

## Layer Structure

```
powertools/
├── README.md           # This file
└── nodejs/            # Layer content (Lambda expects this structure)
    ├── package.json   # Dependencies specification
    └── node_modules/  # Actual dependencies (must be installed!)
```

The CDK uses `lambda.Code.fromAsset()` to package this directory, so the node_modules must exist at build time.