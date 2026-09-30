import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { findLeaks } from "./hygiene.ts"

// spec: openspec/changes/subagent-rating-plugin/tasks.md (task 1.3)
describe("hygiene check", () => {
  const ctx = { username: "alice", hostname: "box-42" }
  const home = ["", "home", "alice", "x"].join("/")

  it("flags an absolute home-directory path", () => {
    assert.ok(findLeaks(`see ${home}`, ctx).length > 0)
  })

  it("flags macOS and Windows home paths", () => {
    assert.equal(findLeaks(["", "Users", "bob", "x"].join("/"), ctx).length, 1)
    assert.equal(findLeaks(["C:", "Users", "bob", "x"].join("\\"), ctx).length, 1)
  })

  it("flags the local username and hostname as whole words", () => {
    assert.equal(findLeaks("owner: alice", ctx).length, 1)
    assert.equal(findLeaks("host box-42", ctx).length, 1)
  })

  it("passes portable notation and placeholders", () => {
    assert.deepEqual(findLeaks("~/x and ./src and /home/<user>/x and malice", ctx), [])
  })
})
