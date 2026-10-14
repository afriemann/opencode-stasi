# Tasks

## 1. Host seam and fake host

- [x] 1.1 Add `time?: { idle?: number }` to `SessionInfo` and `session.wait({sessionID}): Promise<void>` to `HostPort` in `src/host/port.ts`; verify `npm run typecheck` passes including the real-context assignability check.
- [x] 1.2 Extend `src/host/testing/fake-host.ts`: deterministic session state, controllable wait settle/reject with invocation counts, active-session pending wait, unknown id rejects, startup-race model (no idle marker, wait resolves immediately) separate from active execution; verify with fake-host unit tests.

## 2. Deferred solicitation (capture)

- [x] 2.1 Add `deferredRatingRequestLine(callId)` to `src/core/rubric.ts` sharing the rubric text; verify a test asserts the foreground line is byte-identical to today and the deferred line contains key, eventual-result instruction and "never invent".
- [x] 2.2 In `src/host/capture.ts` classify completed foreground / new-child running (no input `sessionID`) / other; share sampling, lineage, identity gates; verify tests named after scenarios "New-child background launch is solicited", "Background call is not solicited" (continuation), plus foreground, errored, sampling and failure scenarios pass.
- [x] 2.3 Update the existing `capture.test.ts` "Background call is not solicited" test to the continuation case and add a foreground-continuation-still-solicited case; verify `npm test` green.

## 3. Rating admission and bounded probe

- [x] 3.1 Add a store preflight operation sharing pending/ownership/expiry checks with `submitRating` in `src/store/repo.ts`; verify store tests (unknown, rated, expired marks expired, foreign session).
- [x] 3.2 Implement the wait registry (one wait per child, cap 128, no eviction, settle cleanup, dispose) as its own module with tests for "Concurrent and repeated attempts share one wait", "Settled wait is released", "Capacity is exhausted", "Unload stops late storage".
- [x] 3.3 Rework `rateSubagentTool` in `src/host/tools.ts`: validate, preflight, probe (`time.idle` set and wait within `CHILD_PROBE_TIMEOUT_MS = 1000` total), fresh `now`, transactional submit, threshold evaluation only on success; verify tests for every "Rating requires a finished child" scenario, including "Invalid key never probes the child" and "Expiry during the probe".
- [x] 3.4 Update the `rate_subagent` description per "Tool guidance forbids invented keys"; verify a test asserts the description content.
- [x] 3.5 Wire dispose into `src/server.ts` teardown before `store.close()`; verify a teardown test or typecheck plus manual read.

## 4. Documentation and integration

- [x] 4.1 Document background rating and the accepted limits (launch-based TTL, idle-between-turns, no read enforcement, continuations unrated, failed/cancelled ratable) in `README.md`; verify against the design's D6 list.
- [x] 4.2 Run `npm run typecheck`, `npm run build`, `npm test` and `scripts/hygiene.ts`; verify all pass with nothing suppressed.
