import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildPassRules, toWildcard, type PermissionRule } from "./rules.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-improvement-trigger/spec.md

/** Last-match-wins evaluation with the host's `*` → `.*` wildcard. */
function decide(rules: readonly PermissionRule[], action: string, resource: string): string {
  let effect = "ask"
  for (const r of rules) {
    const re = new RegExp(`^${r.resource.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`)
    if (r.action === action && re.test(resource)) effect = r.effect
  }
  return effect
}

const base = { tools: ["read", "glob", "edit", "write"], shellAllow: [], allowedPaths: ["**/agents/*.md", "**/AGENTS.md"] }

describe("buildPassRules", () => {
  it("Writes outside the worktree are denied", () => {
    const rules = buildPassRules(base)
    assert.equal(decide(rules, "edit", "agents/foo.md"), "allow")
    assert.equal(decide(rules, "edit", "dot_config/opencode/agents/foo.md"), "allow")
    assert.equal(decide(rules, "edit", "AGENTS.md"), "allow")
    assert.equal(decide(rules, "edit", "src/index.ts"), "deny")
    assert.equal(decide(rules, "external_directory", "/etc"), "deny")
  })

  it("Shell is denied unless a pattern allows it", () => {
    assert.equal(decide(buildPassRules(base), "shell", "ls"), "deny")
    const rules = buildPassRules({ ...base, tools: [...base.tools, "shell"], shellAllow: ["ls *"] })
    assert.equal(decide(rules, "shell", "ls -la"), "allow")
    assert.equal(decide(rules, "shell", "ls > out"), "deny")
    assert.equal(decide(rules, "shell", "rm -rf x"), "deny")
  })

  it("denies env files but reads other files", () => {
    const rules = buildPassRules(base)
    assert.equal(decide(rules, "read", "agents/a.md"), "allow")
    assert.equal(decide(rules, "read", ".env"), "deny")
    assert.equal(decide(rules, "read", "x.env.local"), "deny")
  })

  it("does not allow tools outside the allowlist", () => {
    assert.equal(decide(buildPassRules(base), "subagent", "*"), "ask")
  })
})

describe("toWildcard", () => {
  it("also emits the form without a leading directory wildcard", () => {
    assert.deepEqual(toWildcard("**/skills/**"), ["*/skills/*", "skills/*"])
    assert.deepEqual(toWildcard("docs/*.md"), ["docs/*.md"])
  })
})
