# Tasks

## 1. Recognizable targets

- [x] 1.1 Red-green “Completed foreground call is solicited”, “New-child background launch is solicited” and “Untrusted task descriptions remain single-line labels” using design Recognizable targets; preserve existing exclusion scenarios.
- [x] 1.2 Red-green “Accepted feedback identifies its target”, retaining legacy-call fallback and initial tool inputs; document target labels in README.

## 2. Session-owned recovery

- [x] 2.1 Red-green “Owner edits a rating without changing its identity or age” and “Owner retracts and can rate again under original admission rules” using design Correction boundary and Current evidence plus audit.
- [x] 2.2 Red-green “Invalid corrections cannot mutate or disclose feedback”, “Corrections retain history across reopen” and “Failed and competing corrections preserve one current vote”.
- [x] 2.3 Register and contain the correction tool; verify server and pass-containment tests, and document edit/retract usage in README.

## 3. Evidence and verification

- [x] 3.1 Red-green “Corrected evidence excludes retracted votes and audit history” and “Corrections leave tuning decisions untouched”.
- [x] 3.2 Run npm test, npm run typecheck, npm run build and configured pre-commit hooks; self-review simplification and resolve reviewer findings.

## Confirmed inventory and dispositions

User confirmed: rubric/capture key-only targets → agent/task/key; tools generic acknowledgement → stored target/score; separate same-session edit/retract tool registered by server and denied by containment; migrate/repo → optional task label and transactional local correction history; existing core/rating, host/capture, host/tools, store/store, server and pass/containment tests plus README updated. No other runtime files, dependencies, parent-rating changes, cross-session editing, reassignment or tuning rollback. Existing calls without labels retain agent/key fallback. Branch: feat/rating-corrections from origin/main.

Proposal review accepted: original capture TTL on reopening, unrestricted-age same-session corrections, complete edit validation, immutable rating identity/order, atomic audit, bounded escaped labels, and no correction-triggered evaluation. History stays private-local and outside evidence. No trigger-domain delta: its existing containment requirement already forbids all rating tools. Security review: no findings; its initial no-reopen suggestion was explicitly withdrawn as a misunderstanding. Remaining proposal observations refine already-confirmed scope rather than add features.

## Workflow follow-up

- Verification: 180 tests pass; typecheck, build and configured hooks pass. Red steps observed for label injection, correction/store behavior and registration/containment. Self-review: shared validation/presentation reused; no speculative abstraction or historical comments; explicit storage transaction retained for atomicity.
- Implementation reviews at diff hash 137a21ba: code-reviewer and plugin-conformance reviewer found zero blockers and the same acknowledgement warning; accepted, retract no longer displays a current score. Security reviewer found no issues. Conformance security suggestion accepted: unknown and foreign correction keys now share one non-disclosing error.
- Other suggestions: keep duplicate call keys intentionally for copyable invocation plus recognizable target; keep the existing UTF-16 label cap because JSON safely escapes a split surrogate and the bound holds; extra equivalent label/foreign-session tests not added because current scenario tests cover those outcomes. The checked-call simplification is retained.
- Re-review at diff hash 1e11f114: code-reviewer approved without blockers/warnings; security and plugin-conformance reviewers found no issues. Acknowledgement and non-disclosure fixes are verified by strengthened scenario tests.
- Dependency audit: existing transitive development dependency ip-address 10.7.3 has GHSA-rxp7-6hxx-x8q5 (patched in 10.7.4). No manifest or lockfile changes. User explicitly confirmed “Defer fix (Recommended)” to a separate follow-up before commit.

- Commit reviewed implementation, archive through OpenSpec, commit archival separately, push and open the task PR.
