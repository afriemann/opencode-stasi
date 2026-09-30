// spec: openspec/changes/subagent-rating-plugin/specs/subagent-improvement-trigger/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { parseConfig, type Config } from "../core/config.ts"
import type { Git } from "../git/git.ts"
import { openStore, type Store } from "../store/repo.ts"
import { BUILTIN_TUNER_ID, createPassRunner, type PassPorts, type SessionRequest } from "./runner.ts"

const NOW = Date.UTC(2026, 8, 30)
let dir: string
let store: Store

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "stasi-pass-"))
  store = await openStore(join(dir, "data", "ratings.db"))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

function config(raw: Record<string, unknown> = {}): Config {
  const parsed = parseConfig({ agentConfigRepo: "/cfg", ...raw })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.config
}

interface Fixture {
  ports: PassPorts
  git: { changed: string[]; status: string[]; commits: string[]; worktrees: string[]; failWorktree?: boolean; isRepo: boolean }
  sessions: SessionRequest[]
  prompts: string[]
  interrupted: string[]
  agents: Record<string, { version: string }>
  wait: () => Promise<void>
  usage: { steps: number; tokens: number }
  failCreate?: boolean
}

function fixture(): Fixture {
  const f: Fixture = {
    git: { changed: [], status: [""], commits: [], worktrees: [], isRepo: true },
    sessions: [],
    prompts: [],
    interrupted: [],
    agents: { [BUILTIN_TUNER_ID]: { version: "t1" }, custom: { version: "c1" } },
    wait: async () => undefined,
    usage: { steps: 0, tokens: 0 },
    ports: undefined as unknown as PassPorts,
  }
  const git: Git = {
    isRepo: async () => f.git.isRepo,
    addWorktree: async ({ dir: d, agentId, date }) => {
      if (f.git.failWorktree) throw new Error("boom")
      f.git.worktrees.push(d)
      return { dir: d, branch: `agent-tuning/${agentId}-${date}` }
    },
    changedPaths: async () => f.git.changed,
    commitAll: async (_d, message) => (f.git.commits.push(message), "sha1"),
    removeWorktree: async () => undefined,
    status: async () => f.git.status.shift() ?? "",
  }
  f.ports = {
    git,
    resolveAgent: async (id) => f.agents[id],
    createSession: async (request) => {
      if (f.failCreate) throw new Error("rejected")
      f.sessions.push(request)
      return { id: "ses_pass" }
    },
    prompt: async (_s, text) => void f.prompts.push(text),
    wait: () => f.wait(),
    interrupt: async (s) => void f.interrupted.push(s),
    onSession: () => undefined,
    usage: () => f.usage,
    finalText: () => "Tightened the description.",
    release: () => undefined,
  }
  return f
}

function setup(f: Fixture, cfg: Config, extra: { builtinTunerEnabled?: boolean; timeoutMs?: number } = {}) {
  store.saveState("explore", { status: "tripped", trippedVersion: "v1", lastResolvedAt: 0, cooldownUntil: 0 })
  return createPassRunner({
    store,
    config: cfg,
    ports: f.ports,
    worktreeRoot: join(dir, "wt"),
    now: () => NOW,
    log: () => undefined,
    builtinTunerEnabled: extra.builtinTunerEnabled ?? cfg.pass.agent === undefined,
    pollMs: 5,
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  })
}

describe("improvement pass", () => {
  it("Successful pass", async () => {
    const f = fixture()
    f.git.changed = ["dot_config/opencode/agents/explore.md"]
    await setup(f, config()).runPass("explore", "v1")
    const pass = store.latestPass("explore")!
    assert.equal(pass.status, "committed")
    assert.equal(pass.branch, "agent-tuning/explore-20260930")
    assert.equal(store.getState("explore").status, "awaiting_review")
    assert.equal(f.git.commits.length, 1)
    assert.match(f.git.commits[0]!, /Tuning-Pass: /)
    assert.match(f.git.commits[0]!, /Tuning-Agent: subagent-tuner@t1/)
    assert.equal(f.sessions[0]!.agent, BUILTIN_TUNER_ID)
  })

  it("Pass made no changes", async () => {
    const f = fixture()
    await setup(f, config()).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "no_change")
    assert.equal(store.getState("explore").status, "awaiting_review")
    assert.equal(f.git.commits.length, 0)
  })

  it("Change outside allowed paths", async () => {
    const f = fixture()
    f.git.changed = ["agents/x.md", "src/evil.ts"]
    await setup(f, config()).runPass("explore", "v1")
    const pass = store.latestPass("explore")!
    assert.equal(pass.status, "failed_scope")
    assert.ok(pass.worktreePath)
    assert.equal(f.git.commits.length, 0)
    assert.equal(store.getState("explore").status, "tripped")
  })

  it("Brief content", async () => {
    const f = fixture()
    store.recordCall({ callId: "c1", callerSessionId: "s", callerAgent: "build", childSessionId: "c", agentId: "explore", agentVersion: "v1", createdAt: 1 })
    store.submitRating({ callId: "c1", callerSessionId: "s", score: 1, comment: "SECRET-COMMENT-TEXT", commentMax: 500, pendingTtlMs: 1e9, now: 2 })
    await setup(f, config()).runPass("explore", "v1")
    assert.match(f.prompts[0]!, /explore/)
    assert.match(f.prompts[0]!, /subagent_ratings/)
    assert.doesNotMatch(f.prompts[0]!, /SECRET-COMMENT-TEXT/)
  })

  it("Timeout", async () => {
    const f = fixture()
    f.wait = () => new Promise(() => undefined)
    let clock = NOW
    const runner = createPassRunner({
      store,
      config: config(),
      ports: f.ports,
      worktreeRoot: join(dir, "wt"),
      now: () => (clock += 100),
      log: () => undefined,
      builtinTunerEnabled: true,
      pollMs: 5,
      timeoutMs: 300,
    })
    store.saveState("explore", { status: "tripped", trippedVersion: "v1", lastResolvedAt: 0, cooldownUntil: 0 })
    await runner.runPass("explore", "v1")
    const pass = store.latestPass("explore")!
    assert.equal(pass.status, "interrupted")
    assert.deepEqual(f.interrupted, ["ses_pass"])
    assert.equal(f.git.commits.length, 0)
  })

  it("interrupts when the step cap is exceeded", async () => {
    const f = fixture()
    f.wait = () => new Promise(() => undefined)
    f.usage = { steps: 999, tokens: 0 }
    await setup(f, config()).runPass("explore", "v1")
    assert.match(store.latestPass("explore")!.reason ?? "", /steps/)
  })

  it("Built-in tuner used when none configured", async () => {
    const f = fixture()
    await setup(f, config()).runPass("explore", "v1")
    assert.equal(f.sessions[0]!.agent, BUILTIN_TUNER_ID)
  })

  it("Configured agent takes precedence", async () => {
    const f = fixture()
    await setup(f, config({ pass: { agent: "custom" } })).runPass("explore", "v1")
    assert.equal(f.sessions[0]!.agent, "custom")
  })

  it("A tuning agent may tune itself", async () => {
    const f = fixture()
    store.saveState("custom", { status: "tripped", trippedVersion: "c1", lastResolvedAt: 0, cooldownUntil: 0 })
    await setup(f, config({ pass: { agent: "custom" } })).runPass("custom", "c1")
    assert.equal(store.latestPass("custom")!.status, "no_change")
  })
})

describe("notify-only fallback", () => {
  it("agentConfigRepo unset", async () => {
    const f = fixture()
    const cfg = parseConfig({})
    assert.ok(cfg.ok)
    await setup(f, cfg.config).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "notify_only")
    assert.equal(f.git.worktrees.length, 0)
    assert.equal(f.sessions.length, 0)
    assert.equal(store.getState("explore").status, "tripped")
  })

  it("Excluded agent", async () => {
    const f = fixture()
    await setup(f, config({ triggerExclude: ["explore"] })).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "notify_only")
    assert.equal(f.sessions.length, 0)
  })

  it("Configured tuning agent does not exist", async () => {
    const f = fixture()
    await setup(f, config({ pass: { agent: "ghost" } })).runPass("explore", "v1")
    const pass = store.latestPass("explore")!
    assert.equal(pass.status, "failed")
    assert.match(pass.reason ?? "", /ghost/)
    assert.equal(f.sessions.length, 0)
  })

  it("Session creation fails", async () => {
    const f = fixture()
    f.failCreate = true
    await setup(f, config()).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "failed")
    assert.equal(store.getState("explore").status, "tripped")
  })

  it("built-in tuner disabled while pass.agent is unset", async () => {
    const f = fixture()
    await setup(f, config(), { builtinTunerEnabled: false }).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "notify_only")
  })

  it("agentConfigRepo not a git repository", async () => {
    const f = fixture()
    f.git.isRepo = false
    await setup(f, config()).runPass("explore", "v1")
    assert.equal(store.latestPass("explore")!.status, "notify_only")
  })
})

describe("one pass per trip", () => {
  it("A failed pass is not retried for the same tripped version", async () => {
    const f = fixture()
    f.failCreate = true
    const runner = setup(f, config())
    await runner.drain()
    await runner.drain()
    assert.equal(f.git.worktrees.length, 1)
    assert.equal(store.latestPass("explore")!.status, "failed")
  })

  it("Tuning agent lookup error is reported", async () => {
    const f = fixture()
    f.ports = { ...f.ports, resolveAgent: async () => Promise.reject(new Error("no such location")) }
    await setup(f, config()).runPass("explore", "v1")
    assert.match(store.latestPass("explore")!.reason ?? "", /no such location/)
  })
})

describe("single pass at a time", () => {
  it("Second trip while a pass runs", async () => {
    const f = fixture()
    let release!: () => void
    f.wait = () => new Promise<void>((resolve) => (release = resolve))
    const runner = setup(f, config())
    store.saveState("other", { status: "tripped", trippedVersion: "o1", lastResolvedAt: 0, cooldownUntil: 0 })
    const first = runner.runPass("explore", "v1")
    await new Promise((resolve) => setTimeout(resolve, 20))
    await runner.runPass("other", "o1")
    assert.equal(f.sessions.length, 1)
    assert.equal(store.getState("other").status, "tripped")
    release()
    f.wait = async () => undefined
    await first
    await runner.drain()
    assert.equal(store.latestPass("other")!.status, "no_change")
  })
})
