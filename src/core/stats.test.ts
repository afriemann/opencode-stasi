import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { windowStats } from "./stats.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-analysis/spec.md
describe("rolling-window statistics", () => {
  const row = (score: number, createdAt: number, version = "v1") => ({ score, createdAt, version })
  const opts = { windowSize: 3, version: "v1", resolvedAt: 0 }

  it("Window keeps the most recent ratings", () => {
    const rows = [row(1, 1), row(1, 2), row(5, 3), row(5, 4), row(5, 5)]
    const stats = windowStats(rows, opts)
    assert.equal(stats.n, 3)
    assert.equal(stats.mean, 5)
  })

  it("Ratings of an older definition version are ignored", () => {
    const stats = windowStats([row(1, 1, "old"), row(5, 2)], opts)
    assert.equal(stats.n, 1)
    assert.equal(stats.mean, 5)
  })

  it("Ratings before the last resolution are ignored", () => {
    const stats = windowStats([row(1, 10), row(5, 11)], { ...opts, resolvedAt: 10 })
    assert.equal(stats.n, 1)
    assert.equal(stats.mean, 5)
  })

  it("reports median and share of ratings at or below 2", () => {
    const stats = windowStats([row(1, 1), row(2, 2), row(5, 3)], opts)
    assert.equal(stats.median, 2)
    assert.equal(stats.shareLow, 2 / 3)
  })

  it("reports an empty window without a mean", () => {
    const stats = windowStats([], opts)
    assert.equal(stats.n, 0)
    assert.equal(stats.mean, undefined)
  })
})
