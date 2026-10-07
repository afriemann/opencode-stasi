# opencode-stasi

opencode V2 server plugin that collects subagent ratings (SQLite) and, when a subagent type scores badly, starts a propose-only tuning pass that commits an agent-definition proposal on a git-worktree branch. Nothing is applied automatically.

- Runtime: V2 (`@opencode/plugin`) only; entry `src/server.ts` (built to `dist/server.js`, export `./server`). Tools: `rate_subagent`, `subagent_ratings`, `subagent_tuning_resolve`. Hooks: `ctx.tool.hook("execute.after")`, `ctx.session.hook("context")`, `ctx.permission.hook("evaluate")`.
- Layout: `src/core/` (config, rules, stats, trigger, validation), `src/host/` (host port, capture, tools, fake host for tests), `src/store/` (SQLite), `src/git/`, `src/pass/` (tuning pass), `src/config-file.ts`, `src/evaluate.ts`; `scripts/hygiene.ts` (detects home paths, username, hostname in text). Tests are colocated `*.test.ts`. `openspec/` holds specs.
- Commands: `npm run build`, `npm run typecheck`, `npm test` (node --test; `npm run test:bun` for bun). Node >= 24 (`.node-version`). CI: `.github/workflows/ci.yml`.
- Gotcha: a local checkout is loaded by absolute path to the `dist` directory (containing `server.js`), not to the file.
- Configuration and tool details: see `README.md`.
