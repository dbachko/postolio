# Autopilot

Autopilot detects schedule gaps and generates content for enabled brands. EventBridge triggers the generation service; authenticated API routes expose manual triggering, status, and brand configuration.

## API

Routes use the `/api/autopilot` prefix:

| Method  | Path                      | Purpose              |
| ------- | ------------------------- | -------------------- |
| `POST`  | `/trigger`                | Trigger generation   |
| `GET`   | `/status`                 | Service status       |
| `GET`   | `/gaps`                   | Content gap analysis |
| `GET`   | `/brands/:brandId/config` | Brand configuration  |
| `PATCH` | `/brands/:brandId/config` | Update configuration |

Brand configuration is stored in `Brand.preferences.autopilot`.

## Configuration

```json
{
  "enabled": true,
  "minDaysAhead": 14,
  "maxContentPerGeneration": 5,
  "contentStrategy": {
    "themes": ["lifestyle", "inspiration"],
    "postingFrequency": "daily",
    "optimalTimes": [
      { "hour": 9, "minute": 0 },
      { "hour": 18, "minute": 0 }
    ]
  }
}
```

Autopilot is disabled by default. `minDaysAhead` accepts 7-30 and `maxContentPerGeneration` accepts 1-10. Posting frequency accepts `daily`, `every-other-day`, or `weekly`.

## Implementation

- `packages/apps/api/src/routes/autopilot.ts`: routes, validation, and defaults
- `packages/apps/api/src/services/autopilot.ts`: gap detection and generation orchestration
- `packages/apps/api/src/services/autopilot-generation.ts`: content generation and scheduling

## Troubleshooting

If no content is generated, check that autopilot is enabled, the brand has a schedule gap, and image/text providers are configured. For scheduling failures, inspect API and scheduler logs and the brand's posting times.
