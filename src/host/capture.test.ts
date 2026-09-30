// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { agentVersion } from "../core/version.ts"
import { openStore, type Store } from "../store/repo.ts"
import { createCaptureHook } from "./capture.ts"
import { createLineageCheck } from "./lineage.ts"
import { createFakeHost, subagentCompleted, type FakeHost } from "./testing/fake-host.ts"

let dir: string
let store: Store
let host: FakeHost
let logged: string[]
let passSessions: Set<string>

const explore = { id: "explore", system: "s", description: "d", mode: "subagent" }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "stasi-capture-"))
  store = await openStore(join(dir, "r.db"))
  host = createFakeHost()
  host.agents["explore"] = explore
  host.sessions["ses_root"] = { id: "ses_root" }
  logged = []
  passSessions = new Set()
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const hook = (samplingRate = 1) =>
  createCaptureHook({
    port: host.port,
    store,
    config: { samplingRate },
    inPassLineage: createLineageCheck(host.port, () => passSessions, (e) => logged.push(String(e))),
    now: () => 42,
    log: (message) => logged.push(message),
  })

const text = (event: ReturnType<typeof subagentCompleted>) => {
  if (event.status !== "completed") throw new Error("fixture must be completed")
  return JSON.stringify(event.result.content)
}

describe("Rating request injection", () => {
  it("Completed foreground call is solicited", async () => {
    const event = subagentCompleted("call_1")
    await hook()(event)
    assert.match(text(event), /rate_subagent \{call:\\"call_1\\"/)
    assert.equal(event.status === "completed" && (event.result.content as unknown[]).length, 2)
    assert.deepEqual(store.getCall("call_1"), {
      callId: "call_1",
      callerSessionId: "ses_root",
      callerAgent: "build",
      childSessionId: "ses_child",
      agentId: "explore",
      agentVersion: agentVersion(explore),
      createdAt: 42,
      status: "pending",
    })
  })

  it("Rater cannot supply the subagent type", async () => {
    await hook()(subagentCompleted("call_r"))
    const result = store.submitRating({ callId: "call_r", callerSessionId: "ses_root", score: 2, comment: "c", commentMax: 500, pendingTtlMs: 1e9, now: 43 })
    assert.ok(result.ok)
    assert.equal(store.getCall("call_r")?.agentId, "explore")
  })

  it("appends to a plain string result", async () => {
    const event = subagentCompleted("call_s")
    if (event.status === "completed") event.result.content = "done"
    await hook()(event)
    assert.match(String((event as { result: { content: string } }).result.content), /^done\n\n\[rate\] /)
  })

  it("Background call is not solicited", async () => {
    const event = subagentCompleted("call_2", { status: "running" })
    const before = text(event)
    await hook()(event)
    assert.equal(text(event), before)
    assert.equal(store.getCall("call_2"), undefined)
  })

  it("Errored call is not solicited", async () => {
    const event = { ...subagentCompleted("call_3"), status: "error" as const }
    await hook()(event)
    assert.equal(store.getCall("call_3"), undefined)
  })

  it("ignores other tools", async () => {
    const event = { ...subagentCompleted("call_4"), tool: "read" }
    await hook()(event)
    assert.equal(store.getCall("call_4"), undefined)
  })

  it("Sampling skips a call deterministically", async () => {
    const event = subagentCompleted("call_5")
    await hook(0)(event)
    assert.equal(store.getCall("call_5"), undefined)
    assert.equal(text(event).includes("[rate]"), false)
  })

  it("Capture failure never alters the result", async () => {
    host.agents = {}
    const event = subagentCompleted("call_6")
    const before = text(event)
    await hook()(event)
    assert.equal(text(event), before)
    assert.equal(store.getCall("call_6"), undefined)
    assert.deepEqual(logged, ["capture hook failed"])
  })
})

describe("Excluded calls are never solicited", () => {
  it("Call inside a pass lineage", async () => {
    host.sessions["ses_pass"] = { id: "ses_pass" }
    host.sessions["ses_root"] = { id: "ses_root", parentID: "ses_pass" }
    passSessions.add("ses_pass")
    const event = subagentCompleted("call_7")
    await hook()(event)
    assert.equal(store.getCall("call_7"), undefined)
  })

  it("excludes a session carrying pass metadata", async () => {
    host.sessions["ses_root"] = { id: "ses_root", metadata: { opencodeStasi: { passId: "p1" } } }
    await hook()(subagentCompleted("call_8"))
    assert.equal(store.getCall("call_8"), undefined)
  })

  it("Ordinary use of the tuned agent is still rated", async () => {
    host.agents["subagent-tuner"] = { id: "subagent-tuner", system: "t" }
    await hook()(subagentCompleted("call_9", { agent: "subagent-tuner" }))
    assert.equal(store.getCall("call_9")?.agentId, "subagent-tuner")
  })

  it("fails closed when ancestry cannot be read", async () => {
    host.sessions = {}
    await hook()(subagentCompleted("call_10"))
    assert.equal(store.getCall("call_10"), undefined)
  })
})
