# Campaign Wizard Help – Inline FAQ and Future Sidebar

Status: Implemented (modal), Future (sidebar)

## Summary

Provide in-context guidance during campaign creation. A Help button inside the Campaign Wizard opens a modal with concise FAQ content covering Content Pillars, Analyze Goal, and Generate With AI. This reduces confusion and improves self‑serve onboarding.

## Current UX (Phase 1)

- Entry: `Create Campaign` header → `Help` button.
- Opens a modal with sections:
  - Content Pillars (definition, structure, how used, themes vs. pillars, best practices)
  - Analyze Goal (inputs/outputs, how to apply suggestions)
  - Generate With AI (requirements, outputs, how to apply)

## Future UX (Phase 2)

- Replace modal with a right‑side help drawer that:
  - Stays open across steps and responds to context (current step).
  - Includes an optional chat interface to ask questions and deep dive on topics.
  - Surfaces smart links to take actions (e.g., “Apply suggested pillars”).

## Acceptance Criteria

- Help is accessible on every wizard step.
- Content is scannable, non‑scroll‑locked page, keyboard accessible.
- No dependency on external services; works offline.

## Notes

- The modal uses existing UI primitives (`Dialog`); migration to a drawer/chat can be incremental without changing copy.
