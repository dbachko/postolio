# Recipe Runner Prompts

This folder contains markdown prompt templates referenced by recipe steps that use:

```json
{ "type": "llm", "prompt_template": "<file>.md" }
```

## Rules

- Paths are resolved relative to this folder.
- `prompts/<file>.md` is also accepted (the `prompts/` prefix is stripped for convenience).
- Path traversal is blocked (no `..`, no absolute paths).
- Templates support `{{path.to.value}}` interpolation using the run state.

## Available state (v1)

- `input.*` — user-provided run input JSON
- Step outputs are written to `output_key` names (e.g. `url_context`, `hooks`, `thread_md`)

Example:

```md
BRIEF:
{{input.brief}}

URL SUMMARY:
{{url_context.text}}
```
