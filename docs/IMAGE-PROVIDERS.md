# Image providers

The API registers `gemini-2.5-flash`, `dalle-3`, and `gemini-3-pro`. These are application provider IDs; model selection and request handling live in `packages/apps/api/src/services/image-providers/`.

## Configuration

- `OPENAI_API_KEY`: DALL-E provider
- `GOOGLE_GENERATIVE_AI_API_KEY`: Gemini providers
- `DEFAULT_IMAGE_PROVIDER`: preferred system default among configured providers
- `IMAGE_FALLBACK_ORDER`: comma-separated fallback provider IDs
- `SKIP_IMAGE_GENERATION=1`: use development placeholders
- `PLACEHOLDER_IMAGE_BASE`: placeholder URL base

The registry selects configured providers only. Without a configured default, its priority is Gemini Flash, DALL-E, then Gemini Pro. A request can specify a preferred provider; the orchestrator controls fallback between attempts.

## Implementation

- `image-providers/types.ts`: provider IDs and request/result types
- `image-providers/registry.ts`: registration, configuration, and selection
- `image-providers/orchestrator.ts`: generation and fallback
- Provider files: API requests and brand context

Paths above are relative to `packages/apps/api/src/services/`.

## Troubleshooting

If no provider is available, check runtime keys and provider IDs. For generation failures, inspect provider errors and orchestrator logs. Test fallback with a configured secondary provider. Stored cost values are application estimates; check provider billing for actual charges.
