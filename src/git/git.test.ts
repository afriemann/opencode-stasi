// spec: openspec/changes/subagent-rating-plugin/specs/subagent-improvement-trigger/spec.md
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { createGit, type Git } from "./git.ts"

let root: string
let repo: string
let git: Git

const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "stasi-git-"))
  repo = join(root, "cfg")
  mkdirSync(join(repo, "agents"), { recursive: true })
  sh(root, "init", "-q", "-b", "main", repo)
  sh(repo, "config", "user.name", "Test")
  sh(repo, "config", "user.email", "test@example.invalid")
  sh(repo, "config", "commit.gpgsign", "false")
  writeFileSync(join(repo, "agents", "a.md"), "one\n")
  sh(repo, "add", "-A")
  sh(repo, "commit", "-q", "-m", "init")
  git = createGit()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("tuning worktree", () => {
  it("creates a dated branch in a new worktree from the base ref", async () => {
    const wt = await git.addWorktree({ repo, dir: join(root, "wt"), agentId: "explore", date: "20260930", baseRef: "HEAD" })
    assert.equal(wt.branch, "agent-tuning/explore-20260930")
    assert.equal(sh(wt.dir, "branch", "--show-current").trim(), wt.branch)
  })

  it("Branch name collision", async () => {
    await git.addWorktree({ repo, dir: join(root, "wt1"), agentId: "explore", date: "20260930", baseRef: "HEAD" })
    const second = await git.addWorktree({ repo, dir: join(root, "wt2"), agentId: "explore", date: "20260930", baseRef: "HEAD" })
    assert.equal(second.branch, "agent-tuning/explore-20260930-2")
  })

  it("lists changed paths, including untracked files", async () => {
    const wt = await git.addWorktree({ repo, dir: join(root, "wt"), agentId: "a", date: "20260930", baseRef: "HEAD" })
    writeFileSync(join(wt.dir, "agents", "a.md"), "two\n")
    writeFileSync(join(wt.dir, "new.txt"), "x\n")
    assert.deepEqual((await git.changedPaths(wt.dir)).sort(), ["agents/a.md", "new.txt"])
  })

  it("commits the changed files with the given message and returns the sha", async () => {
    const wt = await git.addWorktree({ repo, dir: join(root, "wt"), agentId: "a", date: "20260930", baseRef: "HEAD" })
    writeFileSync(join(wt.dir, "agents", "a.md"), "two\n")
    const sha = await git.commitAll(wt.dir, "docs: tune\n\nTuning-Pass: p1")
    assert.match(sha, /^[0-9a-f]{40}$/)
    assert.match(sh(wt.dir, "log", "-1", "--format=%B"), /Tuning-Pass: p1/)
    assert.deepEqual(await git.changedPaths(wt.dir), [])
  })

  it("refuses to remove a dirty worktree", async () => {
    const wt = await git.addWorktree({ repo, dir: join(root, "wt"), agentId: "a", date: "20260930", baseRef: "HEAD" })
    writeFileSync(join(wt.dir, "dirty.txt"), "x\n")
    await assert.rejects(git.removeWorktree(repo, wt.dir))
    assert.ok(existsSync(wt.dir))
  })

  it("removes a clean worktree", async () => {
    const wt = await git.addWorktree({ repo, dir: join(root, "wt"), agentId: "a", date: "20260930", baseRef: "HEAD" })
    await git.removeWorktree(repo, wt.dir)
    assert.equal(existsSync(wt.dir), false)
  })

  it("detects a change in the main checkout status", async () => {
    const before = await git.status(repo)
    writeFileSync(join(repo, "stray.txt"), "x\n")
    assert.notEqual(await git.status(repo), before)
  })

  it("reports whether a path is a git repository", async () => {
    assert.equal(await git.isRepo(repo), true)
    assert.equal(await git.isRepo(root), false)
  })
})
