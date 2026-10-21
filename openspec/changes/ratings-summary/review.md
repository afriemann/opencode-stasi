# Review dispositions

## Confirmed inventory

User confirmed on 2026-10-21: `src/host/tools.ts` exposes current-window and lifetime mean (1–5) and count in overview and detail; lifetime covers all stored agent ratings across versions/resolutions; empty count is 0 with mean omitted. `src/host/tools.test.ts` covers summaries, filtering differences and empties. `README.md` and the analysis spec explain the fields. Existing state, pass metadata, recent lists and tuning thresholds remain unchanged. OpenSpec artifacts record this scope.

## Proposal review

- Accepted: preserve the 500-row window scan while lifetime reads complete history; design records retrieval choice.
- Accepted: full-history cost and state-only empty agents; document cost and test empty results.
- Accepted: consistent additive field names, omitted means, unchanged list limits and tool guidance.
- Accepted: version, resolution and window-size distinction tests.
- Accepted: tool description and README updated together.
- Retention concern resolved by the confirmed definition: lifetime means all currently stored ratings, not deleted historical data.

## Design bridge

- One read, bounded window input → Evidence query tool: “Lifetime exceeds the current-window scan”.
- Shared helper and nested summaries → Evidence query tool: overview, detail, filtering and empty-population scenarios.
- Read-error propagation → Evidence query tool: “Rating read fails”.
- O(N) cost → no spec requirement — implementation trade-off, documented for users.

## Implementation verification

- Baseline: 151 tests passed. Seven name-matched scenario tests failed on missing summaries/empty counts or missing overview read rejection before implementation; after implementation all 155 tests pass.
- Build and typecheck pass. Test fixture with 502 ratings proves complete lifetime aggregation and unchanged scan-before-filter window behavior.
- Self-review: shared helper removes overview/detail duplication; no new component, cache or storage abstraction; filtering stays in the existing window calculator. No speculative features or historical-narration comments added.

## Code and domain review

- Code reviewer: approve; all seven scenarios mapped to exact-title tests after a follow-up coverage review. No blockers.
- Warning: full-history load per overview agent — rejected as a request for implementation change: the accepted design explicitly trades O(N) read/memory cost for unchanged storage API; both user-facing contracts document the cost.
- Suggestion: empty detail window shape — no change: explicit empty-count inventory and scenario require this additive output.
- Suggestion: share arithmetic with the core statistics module — rejected: a separate cross-module abstraction for one reduce adds indirection without useful reuse.
- Suggestion: committed-pass metadata/awaiting_review test coverage — accepted: existing overview test now checks both open states and committed branch/worktree metadata.
- Plugin-domain reviewer: approve, no blockers or warnings; confirms output, description, README and design agree.
- Domain suggestions: explain windowSize in plain language — accepted; empty shape already documented; repeated field names across tool and README intentional because each serves different readers.

## Archive scope gate

Pre-archive scan found 18 stale change-directory references in 16 existing test files. User explicitly approved the listed fifteen additional files on 2026-10-21. Expanded inventory: replace only those spec-reference comments with existing main-spec paths, including the already-in-scope tools test; no behavior, configuration or instruction-file changes. Original implementation inventory remains unchanged.

## Final review

Both reviewers verified frozen source/README diff SHA-256 `12aa2906a29a2651c69e974d1cd9c179c9da34e3de4f560cfec1d3c26258dea7` against base `24e1115`. Code review approves with zero remaining blockers, warnings or suggestions. Plugin-domain review confirms conformance; its empty-summary observation remains explicitly resolved by the approved empty-count contract. All 155 tests, build and existing hooks pass after refinements. Comment-only link fixes are reserved for the archive commit.
