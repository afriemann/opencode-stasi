# Proposal

## Why

Agents can confuse opaque rating call keys and permanently attach feedback to the wrong delegation. Clear targets and a small, session-owned recovery path make rating evidence more reliable without automating tuning-pass rollback.

## What Changes

- Identify rating targets in solicitations and acknowledgements.
- Allow the originating session to edit or retract its downward ratings, retaining correction history.
- Reflect corrected votes in evidence without changing existing tuning passes or evaluating thresholds during correction.

## Capabilities

### Modified Capabilities

- `subagent-rating-capture`: recognizable targets and session-owned correction/retraction.
- `subagent-rating-analysis`: corrected evidence remains independent of tuning lifecycle changes.

## Impact

Capture/rubric presentation, downward tools and registration, SQLite migration/repository, pass containment, colocated tests, and README usage guidance. Initial rating inputs, parent feedback, dependencies and cross-session access remain unchanged. No automatic reassignment or repair of past mistakes.
