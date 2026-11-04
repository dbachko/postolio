# Analytics

Analytics views are scoped to a social account. The UI uses shared components and platform configuration to select available metrics and actions.

## Implementation

| Location                                                           | Purpose                                  |
| ------------------------------------------------------------------ | ---------------------------------------- |
| `packages/apps/web/src/pages/analytics-account/`                   | Account page state and tabs              |
| `packages/apps/web/src/features/analytics/`                        | Hooks, types, and platform configuration |
| `packages/apps/web/src/components/analytics-common/`               | Shared charts and panels                 |
| `packages/apps/api/src/routes/analytics/social-account-analytics/` | Account API handlers                     |
| `packages/services/analytics-ingestor/src/index.ts`                | Metric ingestion                         |

The ingestor writes metric samples and latest aggregates to PostgreSQL. API handlers read those records for summaries, charts, insights, recommendations, and forecasts.

## API

Account endpoints use `/api/analytics/social-accounts/:id`:

- `GET /summary`
- `GET /health`
- `GET /posts`
- `GET /ai-insights`
- `GET /recommendations`
- `GET /forecasting`
- `POST /refresh`

See the route handlers for query parameters and response schemas.

## Troubleshooting

Check the selected account, browser requests, API response, database records, and ingestor logs. A connected account may still lack metrics or the permissions needed to fetch them.

See [ingestor configuration](ANALYTICS-INGESTOR.md) and [analytics tests](../packages/apps/api/src/services/__tests__/README.md).
