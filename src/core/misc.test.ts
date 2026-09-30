import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isPassLineage } from "./exclusion.ts"
import { agentVersion } from "./version.ts"
import { disallowedPaths, matchesGlob } from "./scope.ts"

// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-capture/spec.md
describe("pass lineage exclusion", () => {
  const passSessions = new Set(["pass_root"])

  it("excludes a session whose ancestry contains a pass session", () => {
    assert.equal(isPassLineage([{ id: "child" }, { id: "pass_root" }], passSessions), true)
  })

  it("excludes a session whose ancestry carries pass metadata", () => {
    assert.equal(isPassLineage([{ id: "child" }, { id: "root", passId: "p1" }], passSessions), true)
  })

  it("does not exclude an ordinary lineage", () => {
    assert.equal(isPassLineage([{ id: "child" }, { id: "root" }], passSessions), false)
  })
})

describe("agent definition version", () => {
  const info = { system: "s", description: "d", mode: "subagent", model: undefined, steps: 5, permissions: [{ a: 1, b: 2 }] }

  it("is stable regardless of key order and ignores unrelated fields", () => {
    const reordered = { permissions: [{ b: 2, a: 1 }], steps: 5, mode: "subagent", description: "d", system: "s", request: { secret: "x" } }
    assert.equal(agentVersion(info), agentVersion(reordered))
    assert.match(agentVersion(info), /^[0-9a-f]{16}$/)
  })

  it("changes when behaviour-relevant fields change", () => {
    assert.notEqual(agentVersion(info), agentVersion({ ...info, system: "other" }))
  })
})

describe("allowed path scope", () => {
  const defaults = ["**/agents/*.md", "**/skills/**", "**/AGENTS.md"]

  it("matches the default patterns against a prefixed-directory layout", () => {
    for (const path of ["dot_config/opencode/agents/x.md", "dot_agents/skills/a/SKILL.md", "dot_config/opencode/skills/a/b.md", "AGENTS.md", "agents/y.md"]) {
      assert.equal(matchesGlob(path, "**/agents/*.md") || matchesGlob(path, "**/skills/**") || matchesGlob(path, "**/AGENTS.md"), true, path)
    }
  })

  it("rejects paths outside the allowed patterns", () => {
    assert.deepEqual(disallowedPaths(["dot_config/opencode/opencode.jsonc", "x.md.tmpl", "agents/a.md"], defaults), ["dot_config/opencode/opencode.jsonc", "x.md.tmpl"])
  })

  it("keeps a single star within one path segment", () => {
    assert.equal(matchesGlob("agents/sub/x.md", "**/agents/*.md"), false)
  })
})
