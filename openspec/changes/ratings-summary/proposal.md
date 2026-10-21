# Proposal

## Why

The ratings overview does not show how well agents scored or how many votes support their scores. Users need both current quality evidence and historical context without querying each agent separately.

## What Changes

- Expose current-window and lifetime score summaries in overview and agent-detail results.
- Preserve existing evidence, state, pass metadata and tuning decisions; lifetime reporting is informational.
- Document the two populations and cover filtering differences and empty results with regression tests.

## Capabilities

### Modified Capabilities

- `subagent-rating-analysis`: expand the evidence query contract.

## Impact

Implementation is confined to `src/host/tools.ts`, its colocated tests and `README.md`, plus OpenSpec artifacts and the merged analysis spec. No dependency, storage-schema, permission or threshold changes.
