# Proposal

## Why

Subagent definitions degrade or drift without any feedback signal. The calling agent is the only party that sees how useful a subagent's result actually was. Capturing that judgement per call, aggregating it per subagent type, and surfacing low performers gives a tuning agent evidence to improve definitions instead of guessing.

## What Changes

New opencode **V2-only** server plugin (this repository):

- After every built-in `subagent` tool call completes, the plugin appends a short instruction to the result asking the calling agent to rate the subagent's performance and helpfulness (score plus free-text comment) via a plugin-registered `rate_subagent` tool.
- `rate_subagent` stores each rating locally in a SQLite database: subagent type, score, comment, calling session, child session, timestamp.
- The plugin computes a rolling-window average per subagent type. When the average falls below a configured threshold (with a minimum sample count and a cooldown), it starts an unguided improvement pass.
- The plugin is **agent-agnostic**: the tuning agent is a configurable agent name. When none is configured, the plugin supplies its own built-in tuning agent (registered by the plugin, if the V2 API allows; otherwise the design decides the fallback).
- The tuning agent reads the evidence through a plugin-registered query tool (`subagent_ratings`) returning recent ratings and comments for a subagent type. There is **no Markdown report**.
- The tuning agent MAY be tuned itself (no default self-exclusion). Shell and subagent tools are permitted to the pass when the configured tool list includes them; the user has accepted the weaker containment this implies.
- The agent-config repository is user configuration (`agentConfigRepo`), never a plugin default. The plugin is named `opencode-stasi`. No user-specific paths, names or host details appear in this repository.
- The pass is **propose-only**: it runs in a dedicated session in a git worktree of the agent-config repository and ends as a commit on a branch (`agent-tuning/<agent>-<date>`). It never touches live agent files and never merges. The plugin marks the pass "awaiting review" and does not re-trigger for that subagent type until the user resolves it.
- Configuration (threshold, window size, minimum samples, cooldown, DB path, agent-config repo path) lives in a JSON config file.
- Ratings of tuning-pass sessions and calls to the rating tools themselves are never solicited (no feedback loops). Exclusions are decided by session ancestry, not by agent name alone.
- If the V2 session API cannot start the pass, the plugin degrades to notify-only (records "tripped" state; surfaced via the ratings tool).

### Review dispositions (proposal critique)

| Id | Disposition |
|---|---|
| C1 call key | Accepted. Each `subagent` call gets a server-side `pending` row (subagent type, caller session, child session, call id) at `execute.after`; `rate_subagent` takes a call key, rejects unknown/duplicate keys and mismatched caller session. Subagent type is never taken from the rater. |
| C2 background/error calls | Accepted. Inject only when `status` is `completed`; background and errored calls are not solicited. Design must state whether background completion is observable. |
| C3 rater bias/flood | Accepted. Terse one-line injection, anchored score rubric, configurable sampling rate. |
| C4 loops/recursion | Accepted. Exclusion predicates are spec requirements; in-flight lock prevents concurrent passes; design decides who the rater is when the caller is itself a subagent. |
| C5 noise | Accepted. Minimum sample count; design chooses the statistic (mean vs median vs share-below-threshold) and partitioning of the window by agent-definition version so old ratings do not re-trigger after an improvement. The user asked for an average; that stays the default unless design shows it unsound. |
| C6 state | Accepted. Trigger state machine persisted in SQLite (`ok → tripped → awaiting_review → resolved`) with an explicit user resolution path. |
| C7 session/git feasibility | Accepted as open design question: who runs git (plugin vs the tuning agent), session has no `parentID`. Notify-only is the default fallback. Timeout and cost cap required. |
| C8 notification gap | Accepted. Server plugins have no toast API; design must verify a surface, with the query tool as the guaranteed one. |
| C9 SQLite availability | Accepted as design spike; JSONL + in-memory aggregation is the fallback. |
| C10 privacy | Accepted. Comment length cap; DB file created owner-only and never inside a git-tracked path. |
| C11 prompt injection | Accepted. `subagent_ratings` frames comments as untrusted data. |
| C12 right-sizing / phasing | Partially accepted. Three capabilities kept because trigger has distinct lifecycle/state. Phasing (capture + query first, auto-trigger later) and implicit signals / LLM-as-judge are noted alternatives, **not** in scope; surfaced to the user at the approval gate. |

Security critique not commissioned: no authentication, cryptography, secrets or network-facing surface; the prompt-injection and privacy points are covered above.

## Capabilities

### New Capabilities
- `subagent-rating-capture`: Injecting the rating request after `subagent` calls, the `rate_subagent` tool, input validation, and persistence of ratings with comments in SQLite.
- `subagent-rating-analysis`: Rolling-window average per subagent type, threshold/minimum-sample/cooldown evaluation, and the `subagent_ratings` query tool for the tuning agent.
- `subagent-improvement-trigger`: Starting the propose-only tuning pass in an isolated session/worktree, awaiting-review state, suppression of repeat triggers, exclusion rules, and the notify-only fallback.

### Modified Capabilities
<!-- none: greenfield repository -->

## Impact

- New repository content: plugin source, SQLite schema, config file format, tests.
- Runtime dependency on a SQLite implementation available to the plugin runtime (to be verified in design).
- Runs on the user's machine only; ratings and comments (which may echo task context) are stored locally and never transmitted.
- Interacts with opencode V2 plugin APIs: `ctx.tool.hook`, `ctx.tool.transform`, `ctx.session`. Out of scope: V1 support, dashboards, autonomous edits or merges, any edit of agent/skill files by this project.
