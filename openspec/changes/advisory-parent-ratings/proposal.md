# Proposal

## Why

Parents can assess delegated results, but children cannot provide structured feedback about the briefs they receive. Early feedback can reveal unclear objectives, missing context, inconsistent constraints, or instructions that cannot be executed.

## What Changes

- Advisory first-action feedback on initial briefs for new and resumed delegations, without tool-order enforcement or completion gating.
- A child-facing `rate_parent` tool and a read-only `parent_ratings` tool.
- Request-bound, single-vote upward feedback kept separate from downward ratings and automatic tuning.

## Capabilities

### Modified Capabilities

- `subagent-rating-capture`: upward brief solicitation, trusted request identity, validation and local storage.
- `subagent-rating-analysis`: separate upward-feedback evidence queries and isolation from downward scoring.

## Impact

Server hooks, host adapter and fake, separate parent-capture/tool modules, SQLite migrations/repository, pass containment, tests and README. No agent-definition edits, dependencies, configuration additions, enforcement, or automatic parent tuning.
