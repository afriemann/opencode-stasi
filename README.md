# opencode-stasi

An [opencode](https://opencode.ai) **V2** server plugin that measures how useful subagents are and, when a subagent type keeps scoring badly, proposes a fix for its definition.

1. After every completed foreground `subagent` call, a single line is appended to the result asking the calling agent to rate it with the `rate_subagent` tool (1–5 plus a comment).
2. Ratings and comments are stored locally in SQLite, per subagent type and per agent-definition version.
3. When a type's recent mean rating falls below a threshold, the plugin starts an unattended **tuning pass**: a session that edits a copy of your agent-definition repository in a git worktree on a new branch and commits the proposal there.
4. Nothing is ever applied automatically. You review the branch and merge it, or dismiss it.

The tuner is agent-agnostic. Set `pass.agent` to any agent you already have, or leave it unset and the plugin registers its own hidden primary agent, `subagent-tuner`.

## Install

Add the package to your opencode configuration (`plugins` array of `opencode.json`), pointing at the published package or a local checkout. Requires Node ≥ 24 or Bun.

```jsonc
{ "plugins": ["opencode-stasi"] }
```

Create the configuration file (see below). Without `agentConfigRepo` the plugin still collects ratings and reports trips, but starts no tuning pass ("notify-only").

## Tools

| Tool | Purpose |
|---|---|
| `rate_subagent` `{call, score, comment}` | Called by the agent that made the subagent call. One rating per call, only from the calling session, only while the call is pending (`pendingTtlHours`). |
| `subagent_ratings` `{agent?, limit?}` | Read-only evidence. Without `agent`: the state of every rated type and any open pass. With `agent`: window statistics and up to 50 recent ratings with comments. Comments are returned inside an `untrusted_comment` field after a fixed warning, because they are text written by other agents. |
| `subagent_tuning_resolve` `{agent, outcome, confirm}` | Closes an open trip as `accepted` or `dismissed` once you have reviewed the branch. `confirm` must equal the agent id. Only usable from a top-level session. |

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
- **Shell is not containable.** If you opt in to `shell`, the host can only check command text, so an allowed command can still write elsewhere through its arguments. The plugin compares the status of your config repository's main checkout before and after and warns when it changed. Keep `shellAllow` narrow.
- **Private.** Ratings live in a local database (directory `0700`, file `0600`) and are never sent anywhere by this plugin. Be aware that comments are read by the tuning agent and therefore reach your model provider.
- **Untrusted comments.** Comments are attacker-influenceable input; the query tool frames them as data, and the tuner brief says so.

## Development

```sh
npm install
npm run typecheck
npm test          # node:test
npm run test:bun  # same suite under Bun
npm run build
```

Repository hygiene: a pre-commit hook rejects absolute home-directory paths, usernames and hostnames in tracked files and commit messages. Use `~`, repo-relative paths or placeholders in docs and fixtures.
