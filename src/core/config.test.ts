import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseConfig } from "./config.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-capture/spec.md
describe("configuration", () => {
  it("applies defaults when the configuration is empty", () => {
    const result = parseConfig({})
    assert.ok(result.ok)
    assert.equal(result.config.threshold, 3.0)
    assert.equal(result.config.windowSize, 20)
    assert.equal(result.config.minSamples, 8)
    assert.equal(result.config.cooldownHours, 24)
    assert.equal(result.config.samplingRate, 1.0)
    assert.equal(result.config.commentMaxChars, 500)
    assert.equal(result.config.pendingTtlHours, 24)
    assert.deepEqual(result.config.triggerExclude, [])
    assert.equal(result.config.pass.agent, undefined)
    assert.ok(!result.config.pass.tools.includes("shell"))
    assert.ok(result.config.pass.tools.includes("subagent_ratings"))
  })

  it("rejects an unknown key", () => {
    const result = parseConfig({ thresold: 2 })
    assert.ok(!result.ok)
    assert.match(result.error, /thresold/)
  })

  it("rejects an unknown nested pass key", () => {
    const result = parseConfig({ pass: { agnet: "x" } })
    assert.ok(!result.ok)
    assert.match(result.error, /agnet/)
  })

  it("rejects wrongly typed and out-of-range values", () => {
    assert.ok(!parseConfig({ threshold: "3" }).ok)
    assert.ok(!parseConfig({ samplingRate: 1.5 }).ok)
    assert.ok(!parseConfig({ windowSize: 0 }).ok)
    assert.ok(!parseConfig({ minSamples: 1.5 }).ok)
    assert.ok(!parseConfig(null).ok)
  })

  it("accepts overrides including a configured tuning agent and shell opt-in", () => {
    const result = parseConfig({
      threshold: 2.5,
      agentConfigRepo: "~/cfg",
      pass: { agent: "my-tuner", tools: ["read", "shell"], shellAllow: ["ls *"] },
    })
    assert.ok(result.ok)
    assert.equal(result.config.threshold, 2.5)
    assert.equal(result.config.pass.agent, "my-tuner")
    assert.deepEqual(result.config.pass.shellAllow, ["ls *"])
  })
})
