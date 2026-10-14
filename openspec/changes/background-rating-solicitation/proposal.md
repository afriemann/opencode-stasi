# Proposal

## Why

Background `subagent` calls never receive a `[rate]` line: the launch returns with output status `running` and no tool hook fires when the child finishes. Background runs are often the long, expensive ones, so they are missing from the ratings, and a caller that finds no `[rate]` line may invent a call key.

## What Changes

- A background launch that starts a **new** child session (output status `running`, launch input names no existing `sessionID`) is solicited at launch: a pending call is stored and a deferred rating-request line is appended to the launch result. The line carries the real call key and tells the caller to keep it, read the eventual result or failure report, and rate that work (not the launch acknowledgement) against the original brief.
- Background launches that continue an existing child session are not solicited (the child's idle marker may be stale and the session may be busy with a later call).
- `rate_subagent` checks, after key, ownership and expiry validation and before storing, that the child has finished: `session.get().time.idle` is set and `session.wait` resolves within a short timeout. Otherwise it returns a "subagent still running, rate after it finishes" error (or a distinct "cannot determine state" error on probe failure) and stores nothing; the pending call stays ratable.
- At most one in-flight `session.wait` is kept per child, because the plugin's `session.wait` cannot be aborted; a premature attempt never accumulates waiters.
- Failed and cancelled background subagents are ratable (idle is sufficient).
- The `rate_subagent` description says never to invent a key and to rate the eventual result.
- `HostPort` and the fake host gain `session.wait` and `session.get().time.idle`.
- README documents background rating and its limits.

Foreground behaviour, the rubric, sampling by call key, pass-lineage exclusion, server-side identity and storage are unchanged. No schema change.

### Known limits (accepted)

- A child idle between turns counts as finished.
- The pending-call TTL runs from launch, so a child running longer than `pendingTtlHours` is not ratable.
- Whether the caller read the result is the caller's obligation; the probe does not enforce it.
- Calls continuing an existing child session are never rated.

### Disposition of proposal review (architect)

| Concern | Disposition |
|---|---|
| Idle is not invocation completion | Accepted: weakened to "child has finished an execution and is idle", limits documented; resumed children excluded |
| Abandoned waits leak | Accepted: one in-flight wait per child; rating never interrupts the child |
| Timeout vs unknown | Accepted: distinct running vs unavailable errors, nothing stored, retryable |
| Foreground compatibility / no discriminator | Accepted: the probe applies to every pending call; for foreground calls the child is already idle with `time.idle` set, so it passes. Resumed-child foreground calls are verified to pass the same way (idle set) |
| Validation ordering, stale timestamp | Accepted: validate before probing, take the time after the probe |
| TTL from launch | Accepted as a documented limit; schema change rejected as out of scope |
| Deferred line wording / caller workflow | Accepted: line and description reworded |
| Failure semantics | Accepted: failed and cancelled are ratable per the user's decision; interrupted infrastructure failures are a documented risk, not excluded |
| Event-based alternative | Rejected: undocumented event metadata, lost on restart |

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `subagent-rating-capture`: "Rating request injection" now covers new-child background launches (scenario "Background call is not solicited" is replaced); "rate_subagent stores a validated rating" gains a still-running rejection.

## Impact

- `src/host/capture.ts`, `src/host/tools.ts`, `src/host/port.ts`, `src/host/testing/fake-host.ts`, `src/core/rubric.ts`, `README.md`, and their colocated tests.
- Depends on `ctx.session.wait` and `session.get().time.idle` semantics, verified against opencode v2.0.29 (unchanged from 2.0.26 in the relevant files).
