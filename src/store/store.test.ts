// spec: openspec/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { openStore, type Store } from "./repo.ts"
import { openDriver } from "./driver.ts"

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

describe("Session-owned rating corrections", () => {
  const vote = (id = "c1", now = 2000, version = "v1") => {
    store.recordCall({ ...call(id), agentVersion: version })
    assert.equal(store.submitRating({ callId: id, callerSessionId: "ses_caller", score: 2, comment: id, commentMax: 500, pendingTtlMs: DAY, now }).ok, true)
  }
  const correction = (over = {}) => ({ callId: "c1", callerSessionId: "ses_caller", action: "edit", score: 5, comment: "corrected", commentMax: 500, now: DAY * 2, ...over })

  it("Owner edits a rating without changing its identity or age", async () => {
    assert.equal(typeof store.correctRating, "function", "store must support corrections")
    vote()
    vote("c2", 2000, "v2")
    store.saveState("explore", { status: "resolved", lastResolvedAt: 3000, cooldownUntil: DAY * 3 })
    const db = await openDriver(join(dir, "data", "ratings.db"))
    try {
      const before = db.get<Record<string, unknown>>("SELECT * FROM ratings WHERE call_id = 'c1'")!
      assert.equal(store.correctRating(correction()).ok, true)
      const after = db.get<Record<string, unknown>>("SELECT * FROM ratings WHERE call_id = 'c1'")!
      assert.deepEqual({ ...after }, { ...before, score: 5, comment: "corrected" })
      assert.deepEqual(store.recentRatings("explore", 10).map(row => row.comment), ["c2", "corrected"])
      assert.equal(store.getCall("c1")?.status, "rated")
    } finally { db.close() }
  })

  it("Invalid corrections cannot mutate or disclose feedback", () => {
    assert.equal(typeof store.correctRating, "function", "store must support corrections")
    vote()
    store.recordCall(call("pending"))
    const before = store.recentRatings("explore", 10)
    for (const over of [
      { callId: "unknown" }, { callerSessionId: "foreign" }, { callId: "pending" }, { action: "move" },
      { score: 0 }, { score: 6 }, { score: 2.5 }, { score: undefined }, { comment: undefined },
      { comment: "  " }, { comment: "x".repeat(501) },
    ]) {
      const result = store.correctRating(correction(over))
      assert.equal(result.ok, false)
      assert.deepEqual(store.recentRatings("explore", 10), before)
      if (!result.ok) assert.doesNotMatch(result.error, /corrected|ses_child/)
    }
  })

  it("Corrections retain history across reopen", async () => {
    assert.equal(typeof store.correctRating, "function", "store must support corrections")
    vote()
    const path = join(dir, "data", "ratings.db")
    store.close()
    const legacy = await openDriver(path)
    legacy.exec("DROP TABLE IF EXISTS rating_corrections; ALTER TABLE calls DROP COLUMN task_description; PRAGMA user_version = 2")
    legacy.close()
    store = await openStore(path)
    assert.equal(store.getCall("c1")?.taskDescription, undefined)
    assert.equal(store.correctRating(correction()).ok, true)
    assert.equal(store.correctRating(correction({ action: "retract", now: DAY * 3 })).ok, true)
    store.close()
    store = await openStore(path)
    assert.deepEqual(store.recentRatings("explore", 10), [])
    assert.equal(store.getCall("c1")?.status, "pending")
    const db = await openDriver(path)
    try {
      const history = db.all<Record<string, unknown>>("SELECT * FROM rating_corrections ORDER BY id")
      assert.equal(history.length, 2)
      assert.deepEqual(history.map(row => [row.action, row.before_score, row.before_comment, row.after_score, row.after_comment]), [
        ["edit", 2, "c1", 5, "corrected"], ["retract", 5, "corrected", null, null],
      ])
      for (const row of history) {
        assert.equal(row.call_id, "c1")
        assert.equal(row.actor_session_id, "ses_caller")
        assert.equal(row.agent_id, "explore")
        assert.equal(row.agent_version, "v1")
        assert.equal(row.rating_created_at, 2000)
      }
    } finally { db.close() }
  })

  it("Failed and competing corrections preserve one current vote", async () => {
    assert.equal(typeof store.correctRating, "function", "store must support corrections")
    vote()
    const path = join(dir, "data", "ratings.db")
    const db = await openDriver(path)
    const other = await openStore(path)
    try {
      db.exec("CREATE TRIGGER reject_correction BEFORE INSERT ON rating_corrections BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END")
      for (const action of ["edit", "retract"]) {
        assert.throws(() => store.correctRating(correction({ action })), /audit unavailable/)
        assert.equal(store.getCall("c1")?.status, "rated")
        assert.equal(store.recentRatings("explore", 1)[0]?.score, 2)
        assert.equal(db.all("SELECT * FROM rating_corrections").length, 0)
      }
      db.exec("DROP TRIGGER reject_correction")
      assert.equal(store.correctRating(correction()).ok, true)
      assert.equal(other.correctRating(correction({ action: "retract" })).ok, true)
      assert.equal(store.correctRating(correction({ action: "retract" })).ok, false)
      const input = { callId: "c1", callerSessionId: "ses_caller", score: 4, comment: "new vote", commentMax: 500, pendingTtlMs: DAY, now: 3000 }
      assert.equal(other.submitRating(input).ok, true)
      assert.equal(store.submitRating(input).ok, false)
      assert.equal(store.recentRatings("explore", 10).length, 1)
      assert.equal(db.all("SELECT * FROM rating_corrections").length, 2)
    } finally { other.close(); db.close() }
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
