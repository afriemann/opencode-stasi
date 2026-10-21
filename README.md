# opencode-stasi

An [opencode](https://opencode.ai) **V2** server plugin that measures how useful subagents are and, when a subagent type keeps scoring badly, proposes a fix for its definition.

1. After every completed foreground `subagent` call, and at the launch of every background `subagent` call that starts a new child session, a single line is appended to the result asking the calling agent to rate it with the `rate_subagent` tool (1–5 plus a comment).
2. Ratings and comments are stored locally in SQLite, per subagent type and per agent-definition version.
3. When a type's recent mean rating falls below a threshold, the plugin starts an unattended **tuning pass**: a session that edits a copy of your agent-definition repository in a git worktree on a new branch and commits the proposal there.
4. Nothing is ever applied automatically. You review the branch and merge it, or dismiss it.

The tuner is agent-agnostic. Set `pass.agent` to any agent you already have, or leave it unset and the plugin registers its own hidden primary agent, `subagent-tuner`.

## Install

Add the package to your opencode configuration (`plugins` array of `opencode.json`), pointing at the published package or a local checkout. Requires Node ≥ 24 or Bun.

```jsonc
{ "plugins": ["opencode-stasi"] }
```

A local checkout must be given as an absolute path to a *directory* that contains `server.js` (the build output directory `dist`, after `npm run build`); a path to the file itself is rejected by the host.

```jsonc
{ "plugins": ["/path/to/opencode-stasi/dist"] }
```

Logs: the plugin writes lines prefixed `[opencode-stasi]` to stderr, which opencode captures in its own log (`message="[opencode-stasi] ..."`). On load it logs the configuration source, whether `agentConfigRepo` is set, the database location and the registered tools; later it logs each rating request, rating, trip and pass outcome.

Create the configuration file (see below). Without `agentConfigRepo` the plugin still collects ratings and reports trips, but starts no tuning pass ("notify-only").

## Tools

| Tool | Purpose |
|---|---|
| `rate_subagent` `{call, score, comment}` | Called by the agent that made the subagent call. One rating per call, only from the calling session, only while the call is pending (`pendingTtlHours`). |
| `rate_parent` `{call, score, comment}` | Called by a child using the key in its `[rate-parent]` request. Rates the initial delegation brief, not the result. One integer score 1–5 per request, only from the bound child, before expiry. |
| `parent_ratings` `{agent?, limit?}` | Read-only, database-wide upward feedback. Returns `summaries` (`agent`, `n`, `mean`) and newest `ratings` (`agent`, `score`, `comment`, `createdAt`) with a fixed untrusted-data warning. Optional `agent` filters parent agent type; comment limit defaults to 10 and is clamped to 1–50. No reader-role restriction outside tuning passes. |
| `subagent_ratings` `{agent?, limit?}` | Read-only evidence. Both modes include current-window and lifetime average scores and vote counts. Without `agent`: summaries, state and any open pass for each type. With `agent`: additional window statistics and up to `limit` recent ratings (default 10, maximum 50) with comments. Comments are returned inside an `untrusted_comment` field after a fixed warning, because they are text written by other agents. |
| `subagent_tuning_resolve` `{agent, outcome, confirm}` | Closes an open trip as `accepted` or `dismissed` once you have reviewed the branch. `confirm` must equal the agent id. Only usable from a top-level session, and never by the agent the notice is about. |

Rating summaries use the same field names in overview and detail:

- `window.n` and `window.mean`: vote count and arithmetic average score (1–5) for the current window. From the newest 500 stored ratings, keep those for the newest rated definition version and strictly after the last resolution, then take the newest `windowSize` eligible ratings. This preserves the tuning window's scan boundary.
- `lifetime.n` and `lifetime.mean`: count and average across **all stored ratings for that agent**, including older definition versions and ratings before resolutions. Lifetime statistics are informational and never affect tuning decisions.
- Empty populations have `n: 0` with the `mean` key omitted, not a zero score. Agents with only a state record remain in the overview; an unknown agent queried in detail has empty summaries and no ratings.

The detail list limit does not affect either summary. Lifetime reporting reads the full stored history for each requested agent (all listed agents in overview), so query time and memory grow with history size.

### Parent brief feedback

Each eligible delegation, including a resumed request, asks the child to rate its initial brief as its first action: clarity, context, scope and executable instructions. This is **advisory**, not a tool-order or completion gate. A later vote is still accepted before `pendingTtlHours` expires. Overlapping requests have independent keys; an older request remains ratable. Only use keys supplied by `[rate-parent]`, never invent one.

Upward feedback uses `commentMaxChars` and `pendingTtlHours` without new configuration. It stays separate from downward scores, threshold windows and automatic tuning. `agent-engineer` is the usual reader of `parent_ratings`, not a privileged or required identity.

The database may be shared across sessions and projects: any ordinary agent with this tool can read upward comments across that database. Owner-only file permissions are not project isolation. Do not quote briefs, secrets or sensitive values in comments. The plugin stores request identifiers and feedback, not brief text; comments themselves may still reveal sensitive information and reach the querying model's provider. Stored history is retained until you remove the local database while the plugin is stopped; voting expiry does not delete evidence.

If identity verification, storage or safety capacity is unavailable, the plugin omits feedback rather than blocking delegation. Unbound correlation is lost on plugin restart; already-bound requests survive. Improvement-pass sessions cannot submit or query upward feedback. Unknown or incomplete ancestry is ineligible.

## Background subagents

A background launch returns before the work is done, so its `[rate]` line is deferred: it carries the real call key and tells the caller to keep it, read the eventual result or failure report, and rate that work rather than the launch acknowledgement. `rate_subagent` rejects a rating while the child is still running (retry later) and when the child's state cannot be determined. It accepts a rating once the child has finished an execution, including failed or cancelled ones.

Limits:

- The check is "the child has ended an execution and is idle", so a child that is idle between turns counts as finished.
- `pendingTtlHours` runs from launch, so a child that runs longer than that cannot be rated.
- The plugin cannot verify that the caller read the result.
- A background launch that continues an existing child session is not rated. Foreground continuations still are.
- The check waits at most one second per attempt and keeps at most 128 unresolved waits, because the host's wait cannot be aborted. Neither is configurable.

## Configuration

File: `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode-stasi.json` (override with the plugin option `configPath`). An absent file means all defaults. An invalid file or an unknown key disables the plugin with one log line.

| Key | Default | Meaning |
|---|---|---|
| `threshold` | `3.0` | A type trips when its window mean is strictly below this. |
| `windowSize` | `20` | Number of most recent ratings in the window. |
| `minSamples` | `8` | Minimum ratings in the window before a trip is possible. |
| `cooldownHours` | `24` | Quiet period after a resolution. |
| `samplingRate` | `1.0` | Fraction of calls that ask for a rating (deterministic per call). |
| `commentMaxChars` | `500` | Longer comments are rejected, not truncated. |
| `pendingTtlHours` | `24` | Unrated calls older than this can no longer be rated. |
| `dbPath` | `${XDG_DATA_HOME:-~/.local/share}/opencode-stasi/ratings.db` | SQLite file. Refused inside a git work tree. |
| `agentConfigRepo` | unset | Git repository holding your agent definitions. Unset ⇒ notify-only. |
| `baseRef` | `HEAD` | Ref the tuning worktree starts from. |
| `allowedPaths` | `["**/agents/*.md", "**/skills/**", "**/AGENTS.md"]` | Globs a pass may change. A pass touching anything else is discarded, not committed. |
| `triggerExclude` | `[]` | Agent ids whose trips are notify-only. Empty by default: a tuner may tune itself. |
| `pass.agent` | unset | Agent to run the pass. Unset ⇒ built-in `subagent-tuner`. A configured id that does not exist ⇒ notify-only (no fallback). |
| `pass.tools` | `["read","glob","grep","edit","write","patch","skill","subagent_ratings"]` | Allowlist for the pass session. Add `"shell"` or `"subagent"` to opt in. |
| `pass.shellAllow` | `[]` | Shell command patterns allowed when `"shell"` is in `pass.tools`. |
| `pass.timeoutMinutes` | `30` | Hard wall-clock cap. |
| `pass.maxSteps` | `60` | Hard step cap. |
| `pass.maxTokens` | `2000000` | Hard token cap. |
| `pass.model` | unset | Model override for the pass. |

Customise the built-in tuner by defining an agent with id `subagent-tuner` in your own configuration; your fields override the plugin's.

## Safety model

- **Propose-only.** The pass works in a separate worktree on branch `agent-tuning/<agent>-<yyyymmdd>`. The plugin, not the model, commits; it never merges, pushes or edits your live definitions.
- **Contained.** The pass session only sees `pass.tools`; edits are limited to `allowedPaths` inside the worktree; any permission prompt is auto-denied so it can never hang; time, step and token caps interrupt it. Sessions descended from a pass are never asked to rate.
- **Shell is not containable.** If you opt in to `shell`, the host can only check command text, so an allowed command can still write elsewhere through its arguments. The plugin compares the status of your config repository's main checkout before and after and warns when it changed. Keep `shellAllow` narrow. The host parses each command of a compound line separately before checking it against these patterns.
- **Private-local storage.** Ratings live in a local database (directory `0700`, file `0600`). Downward comments are read by the tuning agent; upward comments are readable by ordinary sessions sharing the database. Tool results reach the querying model provider. The plugin does not export ratings automatically.
- **Untrusted comments.** Comments are attacker-influenceable input; the query tool frames them as data, and the tuner brief says so.

## Verification status

Parent-brief feedback is covered by fake-host and SQLite tests, including request binding, resumed requests, single voting, containment and separate evidence. It has not yet been smoke-tested in a live V2 host.

Smoke-tested in a real V2 host: rating capture, `rate_subagent`, `subagent_ratings`, a trip, one improvement pass with the built-in `subagent-tuner` in a fresh worktree (outcome `no_change` with a rationale), the once-per-session reminder, and `subagent_tuning_resolve`. Findings from that run:

- Each pass worktree is a new host location that loads its own plugin instance. Those instances stay passive, and the tuner lookup retries because the built-in agent registers lazily.
- A `commit` outcome (edited agent file) was not exercised in a real host; it is covered by tests with temporary repositories.

## Development

```sh
npm install
npm run typecheck
npm test          # node:test
npm run test:bun  # same suite under Bun
npm run build
```

Repository hygiene: a pre-commit hook rejects absolute home-directory paths, usernames and hostnames in tracked files and commit messages. Use `~`, repo-relative paths or placeholders in docs and fixtures.
