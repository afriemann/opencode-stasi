# Tasks

Every group lands its own tests (red first, per the `tdd` skill) and docs. Scenario titles in the specs are the test names.

## 1. Scaffold

- [x] 1.1 Create TypeScript ESM package named `opencode-stasi` (`package.json` with `./server` export, `tsconfig`, `@opencode/plugin` as type-only dev dependency pinned to the host version, `.gitignore` incl. `/.worktrees/`) and verify `build` emits `dist/server.js`
- [x] 1.2 Add Bun and Node test runners plus pre-commit config (lint/format/detect-secrets) and verify both runners pass on an empty suite and pre-commit runs clean
- [x] 1.3 Add a hygiene check (pre-commit hook or test) rejecting absolute home-directory paths, the local username and hostname in tracked files, including commit messages; verify it fails on a planted `/home/<user>/x` and passes on `~/x`

## 2. Core (pure logic)

- [x] 2.1 Config parsing/defaults/unknown-key rejection (`core/config`); verify "Defaults apply" and "Unknown key disables the plugin" tests
- [x] 2.2 Rubric line, score/comment validation and deterministic sampling (`core/rubric`, `validate`, `sampling`); verify score and comment-boundary tests and sampling determinism
- [x] 2.3 Window, mean, median, share-at-or-below-2 (`core/stats`); verify window-size, version and last-resolution scenarios
- [x] 2.4 Trigger state machine incl. cooldown and version-change auto-resolve (`core/trigger`); verify every transition test
- [x] 2.5 Exclusion predicate and agent-definition version hash (`core/exclusion`, `version`); verify lineage, key-order independence tests

## 3. Storage

- [x] 3.1 SQLite driver for bun:sqlite and node:sqlite plus migrations (`PRAGMA user_version`); verify the driver contract test under both runtimes
- [x] 3.2 Typed repository (calls, ratings, agent_state, passes with single-running unique index, notifications); verify unique-constraint, expiry and transaction tests
- [x] 3.3 Owner-only permissions and git-work-tree refusal; verify "File permissions" and "Database inside a git work tree" tests

## 4. Git wrapper

- [x] 4.1 `execFile`-based wrapper: worktree add on new branch with collision suffix, porcelain status parsing, scope check, add/commit with trailers, worktree remove without force; verify with temp-repo tests

## 5. Host adapter: capture and tools

- [x] 5.1 Narrow `HostPort` typed against the pinned plugin types and a fake host with fixtures derived from verified source types; verify `tsc` fails on fixture drift
- [x] 5.2 Capture hook on `execute.after` (eligibility, injection, error safety, exclusion); verify all "Rating request injection", "Excluded calls" scenarios
- [x] 5.3 `rate_subagent` tool (`codemode:false`); verify all "rate_subagent stores a validated rating" and "Unrated calls expire" scenarios
- [x] 5.4 `subagent_ratings` tool with untrusted framing and limit clamp; verify all "Evidence query tool" and "untrusted" scenarios
- [x] 5.5 README documenting install, every config key with default, privacy notes; verify each documented key exists in the config schema test

## 6. Host adapter: improvement pass

- [ ] 6.1 Pass runner: lock, worktree, session create/prompt/wait, brief, caps, scope gate, commit, notify-only paths, startup reconciliation; verify all "Pass produces…", "Unguided brief", "resource caps", "Scope gate", "Single pass", "Notify-only" scenarios with the fake host and temp repos
- [ ] 6.2 Containment hooks (configurable tool allowlist, edit rules from `allowedPaths`, shell deny-unless-`shellAllow`, ask→deny); verify "Pass session containment" scenarios
- [ ] 6.2a Built-in `subagent-tuner` registration via `agent.transform` `update` and configured-agent resolution/missing-agent failure; verify "Built-in tuning agent" and "Configured tuning agent does not exist" scenarios
- [ ] 6.3 `subagent_tuning_resolve` tool and reminder notification; verify "User resolution of a pass" and "User is told a pass awaits review" scenarios
- [ ] 6.4 Wire `Plugin.define` setup/cleanup (config, DB, hooks, tools, startup reconciliation); verify setup and cleanup test with the fake host

## 7. Integration

- [ ] 7.1 Manual smoke in a real V2 host: rate one call, force a trip with `minSamples:1` against a scratch config repo with the built-in tuner and once with a configured agent, observe branch and reminder; record the outcome in the README without local paths (covers the unverified session-in-new-directory behaviour)
- [ ] 7.2 Run the full suite, build, lint and `openspec validate subagent-rating-plugin`; verify all green
