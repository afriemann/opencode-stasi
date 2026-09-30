// spec: openspec/changes/subagent-rating-plugin/specs/subagent-improvement-trigger/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { parseConfig } from "../core/config.ts"
import { openStore, type Store } from "../store/repo.ts"
import { createReminder } from "./reminder.ts"
import { subagentTuningResolveTool } from "./resolve.ts"

let dir: string
let store: Store
const NOW = 1_000_000

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "stasi-resolve-"))
  store = await openStore(join(dir, "data", "ratings.db"))
  store.saveState("explore", { status: "awaiting_review", trippedVersion: "v1", lastResolvedAt: 0, cooldownUntil: 0 })
  const id = store.startPass({ agentId: "explore", agentVersion: "v1", tunerId: "t", tunerVersion: "1", now: 1 })!
  store.finishPass(id, { status: "committed", now: 2, branch: "agent-tuning/explore-20260930", worktreePath: "/wt/p1" })
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const config = (() => {
  const parsed = parseConfig({ agentConfigRepo: "/cfg" })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.config
})()

function tool(removeOutcome: "ok" | "dirty" = "ok") {
  const removed: string[] = []
  const t = subagentTuningResolveTool({
    store,
    config,
    now: () => NOW,
    isRootOutsidePass: async (id) => id === "ses_root",
    git: {
      removeWorktree: async (_repo, path) => {
        if (removeOutcome === "dirty") throw new Error("dirty")
        removed.push(path)
      },
    },
  })
  return { t, removed }
}

const call = { agent: "explore", outcome: "accepted", confirm: "explore" }

describe("subagent_tuning_resolve", () => {
  it("Confirmed resolution", async () => {
    const { t, removed } = tool()
    await t.execute(call, { sessionID: "ses_root", agent: "build" })
    const state = store.getState("explore")
    assert.equal(state.status, "resolved")
    assert.ok(state.cooldownUntil > NOW)
    assert.deepEqual(removed, ["/wt/p1"])
  })

  it("keeps a dirty worktree and still resolves", async () => {
    const { t } = tool("dirty")
    const result = await t.execute(call, { sessionID: "ses_root", agent: "build" })
    assert.match(result.content, /kept/)
    assert.equal(store.getState("explore").status, "resolved")
  })

  it("Wrong confirmation or non-root caller", async () => {
    const { t } = tool()
    await assert.rejects(t.execute({ ...call, confirm: "other" }, { sessionID: "ses_root", agent: "build" }))
    await assert.rejects(t.execute(call, { sessionID: "ses_sub", agent: "build" }))
    assert.equal(store.getState("explore").status, "awaiting_review")
  })
})

describe("self-resolution", () => {
  it("An agent cannot resolve a notice about itself", async () => {
    const { t } = tool()
    await assert.rejects(t.execute(call, { sessionID: "ses_root", agent: "explore" }), /itself/)
    assert.equal(store.getState("explore").status, "awaiting_review")
    await t.execute(call, { sessionID: "ses_root", agent: "build" })
    assert.equal(store.getState("explore").status, "resolved")
  })
})

describe("reminder", () => {
  it("Reminder shown once", async () => {
    const sent: string[] = []
    const remind = createReminder({
      store,
      now: () => NOW,
      isRootOutsidePass: async (id) => id.startsWith("ses_root"),
      notify: async (_id, text) => void sent.push(text),
      log: () => undefined,
    })
    await remind("ses_root")
    await remind("ses_root")
    await remind("ses_child")
    assert.equal(sent.length, 1)
    assert.match(sent[0]!, /explore/)
    assert.match(sent[0]!, /agent-tuning\/explore-20260930/)
    await remind("ses_root2")
    assert.equal(sent.length, 2)
  })
})
