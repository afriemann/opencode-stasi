# Tasks

## 1. Request feedback

- [x] 1.1 Red-green “New and resumed briefs receive independent advisory keys” with host/server wiring per design binding decision.
- [x] 1.2 Red-green “Siblings and conflicting prompt replays cannot claim requests” and “Prompt retries reuse only their original binding”.
- [x] 1.3 Red-green “Bound children can rate late but only once” and “Invalid foreign and expired votes preserve feedback integrity” with isolated transactional storage.
- [x] 1.4 Red-green “Failure and abandoned correlation leave delegation usable” and “Capacity and unload prevent unbounded or late capture”.
- [x] 1.5 Red-green “Pass and incomplete ancestry cannot produce upward votes” through capture, write tool and containment.
- [x] 1.6 Document advisory usage and privacy in README; verify against the implemented tools and design retention decision.

## 2. Evidence and verification

- [x] 2.1 Red-green “Ordinary readers receive bounded database-wide evidence” and “Empty and failed reads do not fabricate evidence”.
- [x] 2.2 Red-green “Comments are returned verbatim with privacy guidance” and “Upward votes leave downward scores and state unchanged”.
- [x] 2.3 Run build, typecheck, full tests and hooks; self-review and resolve external review findings against the delta scenarios.

## Review dispositions

Architect proposal concerns accepted: pre-execution binding, overlapping requests, advisory timing, safe failure, explicit evidence audience, and containment. Security safeguards accepted. User confirmed database-wide reads without role restrictions; agent-engineer is the usual reader only. Design's proposed automatic retention deletion was removed to preserve the confirmed scope. Plan record not required — this task is intended to finish in this session.

Verification: baseline 155 tests; name-matched capture/tool scenarios failed on absent solicitation/tool exposure before implementation, and containment failed on upward-tool exposure. Current suite: 170 passing. Build and typecheck pass. README checked against tool schemas and privacy/retention behavior. No UI scope. Self-review: isolated upward modules and tables are intentional; complete fresh ancestry checks avoid the existing truncated-walk behavior; no speculative components or historical comments added.

Code review: no blockers. W1 accepted: cover storage failure, 128 occupied lookup slots, one-second deadline and occupied slots after timeout. W2 accepted: query a closed store rather than treating disposed eligibility as query failure. W3 accepted: give store-level cases distinct, accurate names. W4 accepted: whitespace-tolerant marker removal, with trimmed-prompt regression observed failing before the fix. W5 accepted as a verification request: upstream V2 tool hook types expose mutable input; session prompt types expose mutable prompt text; core subagent dispatch uses those fields before child admission. Live-host smoke testing remains unclaimed.

Suggestions: S2 resolved by existing build exclusion of testing directories in tsconfig.build.json. S3 accepted: cover a pass-marked child at binding and voting. S1 rejected with explicit user direction: “same retention as for the other ratings”; verified both histories have no automatic deletion, while TTL only limits eligibility. Security implementation review: no findings. Supplemental failure-path tests passed without production changes; only marker normalization required a new behavioral fix. Full suite remains 170 passing; build and typecheck pass after review fixes.

Security recheck concern accepted: remove unanchored leading unbounded whitespace matching from marker removal. Optional surrounding newlines are bounded, and optional horizontal whitespace occurs only after the fixed marker prefix and nonce. Architecture conformance review found no deviations.

Final revision: code reviewer approved; architect and security returned no findings. All warnings resolved or verified; retention suggestion closed per explicit user direction. Final verification: 170 tests, build, typecheck and all applicable hooks passed. Cosmetic CRLF residue is intentional: marker removal is guaranteed, original prompt whitespace is not normalized.

## Workflow follow-up

- Commit reviewed implementation, archive through OpenSpec, commit archival separately, push and open PR.
