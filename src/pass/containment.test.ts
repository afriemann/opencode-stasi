// spec: openspec/specs/subagent-improvement-trigger/spec.md
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createContainment } from "./containment.ts"

const passSessions = new Set(["ses_pass"])
const containment = createContainment({
  inPassLineage: async (id) => passSessions.has(id),
  allowedTools: ["read", "edit", "subagent_ratings", "rate_subagent", "correct_subagent_rating", "rate_parent", "parent_ratings"],
})

describe("containment", () => {
  it("Tools outside the allowlist are removed", async () => {
    const event = { sessionID: "ses_pass", tools: { read: 1, edit: 1, shell: 1, subagent: 1, question: 1, subagent_ratings: 1, rate_subagent: 1, correct_subagent_rating: 1, subagent_tuning_resolve: 1, rate_parent: 1, parent_ratings: 1 } }
    await containment.onContext(event)
    assert.deepEqual(Object.keys(event.tools).sort(), ["edit", "read", "subagent_ratings"])
  })

  it("leaves other sessions untouched", async () => {
    const event = { sessionID: "ses_root", tools: { shell: 1 } }
    await containment.onContext(event)
    assert.deepEqual(Object.keys(event.tools), ["shell"])
  })

  it("Ask becomes deny", async () => {
    const event: { sessionID: string; effect: "allow" | "deny" | "ask"; message?: string } = { sessionID: "ses_pass", effect: "ask" }
    await containment.onPermission(event)
    assert.equal(event.effect, "deny")
    assert.ok(event.message)
  })

  it("does not change allow decisions or other sessions", async () => {
    const allow = { sessionID: "ses_pass", effect: "allow" as const }
    const other = { sessionID: "ses_root", effect: "ask" as const }
    await containment.onPermission(allow)
    await containment.onPermission(other)
    assert.equal(allow.effect, "allow")
    assert.equal(other.effect, "ask")
  })
})
