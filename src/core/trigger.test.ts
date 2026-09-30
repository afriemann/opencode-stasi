import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { applyVersion, markAwaitingReview, markResolved, markTripped, shouldTrip } from "./trigger.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-analysis/spec.md
describe("trip condition", () => {
  const cfg = { threshold: 3, minSamples: 4 }
  const idle = { status: "ok" as const, lastResolvedAt: 0, cooldownUntil: 0 }
  const stats = (n: number, mean: number | undefined) => ({ n, mean, median: mean, shareLow: 0 })

  it("does not trip with too few samples", () => {
    assert.equal(shouldTrip(idle, stats(3, 1), cfg, 100), false)
  })

  it("does not trip when the mean equals the threshold", () => {
    assert.equal(shouldTrip(idle, stats(4, 3), cfg, 100), false)
  })

  it("does not trip while the cooldown is active", () => {
    assert.equal(shouldTrip({ ...idle, cooldownUntil: 200 }, stats(4, 1), cfg, 100), false)
  })

  it("trips when all conditions hold, from ok or resolved", () => {
    assert.equal(shouldTrip(idle, stats(4, 2.9), cfg, 100), true)
    assert.equal(shouldTrip({ ...idle, status: "resolved" }, stats(4, 2.9), cfg, 100), true)
  })

  it("does not re-trip an already tripped or awaiting type", () => {
    assert.equal(shouldTrip({ ...idle, status: "tripped" }, stats(4, 1), cfg, 100), false)
    assert.equal(shouldTrip({ ...idle, status: "awaiting_review" }, stats(4, 1), cfg, 100), false)
  })
})

describe("state transitions", () => {
  const idle = { status: "ok" as const, lastResolvedAt: 0, cooldownUntil: 0 }

  it("records the tripped version and moves through awaiting_review", () => {
    const tripped = markTripped(idle, "v1")
    assert.equal(tripped.status, "tripped")
    assert.equal(tripped.trippedVersion, "v1")
    assert.equal(markAwaitingReview(tripped).status, "awaiting_review")
  })

  it("resolving sets the last resolution time and the cooldown", () => {
    const resolved = markResolved(markTripped(idle, "v1"), 1000, 500)
    assert.equal(resolved.status, "resolved")
    assert.equal(resolved.lastResolvedAt, 1000)
    assert.equal(resolved.cooldownUntil, 1500)
  })

  it("auto-resolves a tripped or awaiting type when the definition version changes", () => {
    const tripped = markTripped(idle, "v1")
    assert.equal(applyVersion(tripped, "v2", 1000, 500).status, "resolved")
    assert.equal(applyVersion(markAwaitingReview(tripped), "v2", 1000, 500).cooldownUntil, 1500)
  })

  it("leaves state unchanged when the version is unchanged or nothing is open", () => {
    const tripped = markTripped(idle, "v1")
    assert.equal(applyVersion(tripped, "v1", 1000, 500), tripped)
    assert.equal(applyVersion(idle, "v2", 1000, 500), idle)
  })
})
