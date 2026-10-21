// spec: openspec/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { openStore, type Store } from "./repo.ts"

const DAY = 86_400_000
let dir: string
let store: Store

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "stasi-store-"))
  store = await openStore(join(dir, "data", "ratings.db"))
})
afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

const call = (id: string) => ({
  callId: id,
  callerSessionId: "ses_caller",
  callerAgent: "build",
  childSessionId: "ses_child",
  agentId: "explore",
  agentVersion: "v1",
  createdAt: 1000,
})

const parentCall = (id: string) => ({
  callId: id, parentSessionId: "parent", parentAgent: "engineer", parentMessageId: "message",
  childSessionId: "child", childMessageId: `prompt-${id}`, createdAt: 1000, expiresAt: 2000,
})

describe("upward persistence", () => {
  it("binding is idempotent per call and rejects conflicting identities", () => {
    const input = parentCall("one")
    const key = store.bindParentCall(input, 1000)
    assert.ok(key)
    assert.equal(store.bindParentCall(input, 1000), key)
    assert.equal(store.bindParentCall({ ...input, childSessionId: "sibling" }, 1000), undefined)
    assert.equal(store.bindParentCall({ ...input, childMessageId: "other" }, 1000), undefined)
  })

  it("pending cap bounds currently eligible unrated bindings", () => {
    for (let n = 0; n < 4096; n++) assert.ok(store.bindParentCall(parentCall(String(n)), 1000))
    assert.equal(store.bindParentCall(parentCall("overflow"), 1000), undefined)
    assert.ok(store.bindParentCall({ ...parentCall("later"), createdAt: 3000, expiresAt: 4000 }, 3000))
  })

  it("Upward votes leave downward scores and state unchanged", async () => {
    store.recordCall(call("down"))
    store.submitRating({ callId: "down", callerSessionId: "ses_caller", score: 4, comment: "good", commentMax: 500, pendingTtlMs: DAY, now: 1000 })
    const downward = store.recentRatings("explore", 10)
    const key = store.bindParentCall(parentCall("one"), 1000)!
    store.close()
    store = await openStore(join(dir, "data", "ratings.db"))
    const vote = { key, childSessionId: "child", score: 1, comment: "Missing context", commentMax: 500, now: 1500 }
    assert.equal(store.submitParentRating(vote).ok, true)
    assert.equal(store.submitParentRating(vote).ok, false)
    store.close()
    store = await openStore(join(dir, "data", "ratings.db"))
    assert.deepEqual(store.parentEvidence(undefined, 10).summaries.map(row => ({ ...row })), [{ agent: "engineer", n: 1, mean: 1 }])
    assert.deepEqual(store.recentRatings("explore", 10), downward)
    assert.deepEqual(store.listAgents(), ["explore"])
    assert.equal(store.getState("engineer").status, "ok")
  })
})

describe("storage layout", () => {
  it("File permissions", () => {
    assert.equal(statSync(join(dir, "data")).mode & 0o777, 0o700)
    assert.equal(statSync(join(dir, "data", "ratings.db")).mode & 0o777, 0o600)
  })

  it("Database inside a git work tree", async () => {
    const repo = mkdtempSync(join(tmpdir(), "stasi-git-"))
    try {
      const { execFileSync } = await import("node:child_process")
      execFileSync("git", ["init", "-q", repo])
      await assert.rejects(openStore(join(repo, "ratings.db")), /git work tree/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it("State survives restart", async () => {
    store.recordCall(call("c1"))
    store.close()
    store = await openStore(join(dir, "data", "ratings.db"))
    assert.equal(store.getCall("c1")?.status, "pending")
  })
})

describe("rating submission", () => {
  it("stores a rating for a pending call by its caller", () => {
    store.recordCall(call("c1"))
    const res = store.submitRating({ callId: "c1", callerSessionId: "ses_caller", score: 4, comment: "good", commentMax: 500, pendingTtlMs: DAY, now: 2000 })
    assert.deepEqual(res, { ok: true })
    assert.equal(store.getCall("c1")?.status, "rated")
    assert.deepEqual(store.recentRatings("explore", 10), [{ score: 4, version: "v1", createdAt: 2000, comment: "good" }])
  })

  it("rejects an unknown call id", () => {
    const res = store.submitRating({ callId: "nope", callerSessionId: "ses_caller", score: 4, comment: "x", commentMax: 500, pendingTtlMs: DAY, now: 1 })
    assert.equal(res.ok, false)
  })

  it("rejects a second rating for the same call", () => {
    store.recordCall(call("c1"))
    const input = { callId: "c1", callerSessionId: "ses_caller", score: 4, comment: "x", commentMax: 500, pendingTtlMs: DAY, now: 1 }
    store.submitRating(input)
    assert.equal(store.submitRating(input).ok, false)
  })

  it("rejects a rating from a session that did not make the call", () => {
    store.recordCall(call("c1"))
    const res = store.submitRating({ callId: "c1", callerSessionId: "ses_other", score: 4, comment: "x", commentMax: 500, pendingTtlMs: DAY, now: 1 })
    assert.equal(res.ok, false)
    assert.equal(store.getCall("c1")?.status, "pending")
  })

  it("rejects an out-of-range score and an over-long comment", () => {
    store.recordCall(call("c1"))
    const base = { callId: "c1", callerSessionId: "ses_caller", now: 1, commentMax: 5, pendingTtlMs: DAY }
    assert.equal(store.submitRating({ ...base, score: 6, comment: "x" }).ok, false)
    assert.equal(store.submitRating({ ...base, score: 3, comment: "toolong" }).ok, false)
  })

  it("Late rating is rejected", () => {
    store.recordCall(call("c1"))
    const res = store.submitRating({ callId: "c1", callerSessionId: "ses_caller", score: 4, comment: "x", commentMax: 500, pendingTtlMs: DAY, now: 1000 + DAY + 1 })
    assert.equal(res.ok, false)
    assert.equal(store.getCall("c1")?.status, "expired")
  })

  it("returns ratings newest first, limited", () => {
    for (const [i, id] of ["a", "b", "c"].entries()) {
      store.recordCall(call(id))
      store.submitRating({ callId: id, callerSessionId: "ses_caller", score: 3, comment: id, commentMax: 500, pendingTtlMs: DAY, now: 10 + i })
    }
    assert.deepEqual(store.recentRatings("explore", 2).map((r) => r.comment), ["c", "b"])
  })
})

describe("agent state and passes", () => {
  it("defaults an unseen agent to ok and round-trips saved state", () => {
    assert.equal(store.getState("explore").status, "ok")
    store.saveState("explore", { status: "tripped", trippedVersion: "v1", lastResolvedAt: 5, cooldownUntil: 9 })
    assert.deepEqual(store.getState("explore"), { status: "tripped", trippedVersion: "v1", lastResolvedAt: 5, cooldownUntil: 9 })
  })

  it("allows only one running pass at a time", () => {
    const first = store.startPass({ agentId: "a", agentVersion: "v", tunerId: "t", tunerVersion: "tv", now: 1 })
    assert.equal(typeof first, "string")
    assert.equal(store.startPass({ agentId: "b", agentVersion: "v", tunerId: "t", tunerVersion: "tv", now: 2 }), undefined)
    store.finishPass(first as string, { status: "no_change", now: 3 })
    assert.equal(typeof store.startPass({ agentId: "b", agentVersion: "v", tunerId: "t", tunerVersion: "tv", now: 4 }), "string")
  })

  it("Stale running pass at startup", () => {
    const id = store.startPass({ agentId: "a", agentVersion: "v", tunerId: "t", tunerVersion: "tv", now: 1 }) as string
    assert.equal(store.reconcileStalePasses(5, 10), 0)
    assert.equal(store.reconcileStalePasses(20, 10), 1)
    assert.equal(store.getPass(id)?.status, "failed")
  })

  it("records a notice once per session", () => {
    assert.equal(store.markNotified("awaiting:explore", "s1", 1), true)
    assert.equal(store.markNotified("awaiting:explore", "s1", 2), false)
    assert.equal(store.markNotified("awaiting:explore", "s2", 3), true)
  })
})

describe("rating preflight", () => {
  const query = (callId: string, over: { callerSessionId?: string; now?: number } = {}) =>
    store.preflightRating({ callId, callerSessionId: over.callerSessionId ?? "ses_caller", pendingTtlMs: DAY, now: over.now ?? 2000 })

  it("returns the pending call without changing it", () => {
    store.recordCall(call("c1"))
    const result = query("c1")
    assert.ok(result.ok && result.call.childSessionId === "ses_child")
    assert.equal(store.getCall("c1")?.status, "pending")
  })

  it("rejects unknown, foreign and rated calls", () => {
    store.recordCall(call("c1"))
    assert.deepEqual(query("nope"), { ok: false, error: "unknown call id nope" })
    assert.deepEqual(query("c1", { callerSessionId: "ses_other" }), { ok: false, error: "call was not made by this session" })
    store.submitRating({ callId: "c1", callerSessionId: "ses_caller", score: 3, comment: "x", commentMax: 500, pendingTtlMs: DAY, now: 2000 })
    assert.deepEqual(query("c1"), { ok: false, error: "call already rated" })
  })

  it("marks an expired call expired", () => {
    store.recordCall(call("c1"))
    assert.equal(query("c1", { now: 1000 + DAY + 1 }).ok, false)
    assert.equal(store.getCall("c1")?.status, "expired")
  })
})
