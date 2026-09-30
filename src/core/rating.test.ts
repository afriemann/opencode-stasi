import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ratingRequestLine } from "./rubric.ts"
import { validateRating } from "./validate.ts"
import { isSampled } from "./sampling.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-capture/spec.md
describe("rating request line", () => {
  it("names the call key and the five rubric levels on one line", () => {
    const line = ratingRequestLine("call_123")
    assert.ok(line.includes("call_123"))
    assert.ok(!line.includes("\n"))
    for (const level of ["1", "2", "3", "4", "5"]) assert.ok(line.includes(level))
    assert.match(line, /rate_subagent/)
    assert.match(line, /brief/)
  })
})

describe("rate_subagent input validation", () => {
  const cap = 10
  const ok = (score: unknown, comment: unknown) => validateRating({ score, comment }, cap)

  it("accepts scores 1 through 5 with a comment", () => {
    for (const score of [1, 2, 3, 4, 5]) assert.equal(ok(score, "fine"), undefined)
  })

  it("rejects out-of-range or non-integer scores", () => {
    for (const score of [0, 6, 3.5, "4", undefined, Number.NaN]) assert.ok(ok(score, "fine"))
  })

  it("enforces comment length boundaries without truncating", () => {
    assert.ok(ok(3, ""))
    assert.ok(ok(3, "   "))
    assert.equal(ok(3, "x".repeat(cap)), undefined)
    assert.match(ok(3, "x".repeat(cap + 1)) ?? "", /10/)
    assert.ok(ok(3, 42))
  })
})

describe("deterministic sampling", () => {
  it("always samples at rate 1 and never at rate 0", () => {
    assert.ok(isSampled("a", 1))
    assert.ok(!isSampled("a", 0))
  })

  it("gives the same decision for the same call key", () => {
    assert.equal(isSampled("call_1", 0.5), isSampled("call_1", 0.5))
  })

  it("samples roughly the requested fraction", () => {
    let hits = 0
    for (let i = 0; i < 2000; i++) if (isSampled(`call_${i}`, 0.25)) hits++
    assert.ok(hits > 400 && hits < 600, `hits=${hits}`)
  })
})
