import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

export interface Worktree {
  readonly dir: string
  readonly branch: string
}

export interface Git {
  isRepo(dir: string): Promise<boolean>
  addWorktree(input: { repo: string; dir: string; agentId: string; date: string; baseRef: string }): Promise<Worktree>
  /** Paths with any change (staged, unstaged, untracked), repo-relative. */
  changedPaths(dir: string): Promise<string[]>
  /** Stages everything and commits; returns the commit sha. */
  commitAll(dir: string, message: string): Promise<string>
  /** Never forces: a dirty worktree makes this reject. */
  removeWorktree(repo: string, dir: string): Promise<void>
  /** Porcelain status text, for before/after comparison. */
  status(dir: string): Promise<string>
}

const MAX_BRANCH_SUFFIX = 50

/** All git access goes through execFile with an argument vector: no shell, no interpolation. */
export function createGit(): Git {
  const git = async (cwd: string, ...args: string[]): Promise<string> => (await run("git", args, { cwd, encoding: "utf8" })).stdout

  const branchExists = async (repo: string, branch: string) =>
    git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`).then(
      () => true,
      () => false,
    )

  return {
    isRepo: (dir) => git(dir, "rev-parse", "--git-dir").then(() => true, () => false),

    async addWorktree({ repo, dir, agentId, date, baseRef }) {
      const base = `agent-tuning/${agentId}-${date}`
      let branch = base
      for (let n = 2; await branchExists(repo, branch); n++) {
        if (n > MAX_BRANCH_SUFFIX) throw new Error(`no free branch name for ${base}`)
        branch = `${base}-${n}`
      }
      await git(repo, "worktree", "add", "-b", branch, dir, baseRef)
      return { dir, branch }
    },

    async changedPaths(dir) {
      const out = await git(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all")
      return out
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(3))
    },

    async commitAll(dir, message) {
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", message)
      return (await git(dir, "rev-parse", "HEAD")).trim()
    },

    async removeWorktree(repo, dir) {
      await git(repo, "worktree", "remove", dir)
    },

    status: (dir) => git(dir, "status", "--porcelain=v1", "--untracked-files=all"),
  }
}
