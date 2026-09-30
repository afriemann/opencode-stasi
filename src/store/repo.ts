import { randomUUID } from "node:crypto"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs"
import { dirname, join, parse } from "node:path"
import type { AgentState } from "../core/trigger.ts"
import { validateRating } from "../core/validate.ts"
import { openDriver, type Driver } from "./driver.ts"
import { migrate } from "./migrate.ts"

export interface CallInput {
  readonly callId: string
  readonly callerSessionId: string
  readonly callerAgent: string
  readonly childSessionId: string
  readonly agentId: string
  readonly agentVersion: string
  readonly createdAt: number
}
export interface CallRow extends CallInput {
  readonly status: "pending" | "rated" | "expired"
}
export interface RatingInput {
  readonly callId: string
  readonly callerSessionId: string
  readonly score: number
  readonly comment: string
  readonly commentMax: number
  readonly pendingTtlMs: number
  readonly now: number
}
export interface RatingRow {
  readonly score: number
  readonly version: string
  readonly createdAt: number
  readonly comment: string
}
export type SubmitResult = { readonly ok: true } | { readonly ok: false; readonly error: string }

export type PassStatus = "running" | "committed" | "no_change" | "notify_only" | "failed" | "failed_scope" | "failed_commit" | "interrupted"
export interface PassStart {
  readonly agentId: string
  readonly agentVersion: string
  readonly tunerId: string
  readonly tunerVersion: string
  readonly now: number
}
export interface PassFinish {
  readonly status: Exclude<PassStatus, "running">
  readonly now: number
  readonly reason?: string
  readonly sessionId?: string
  readonly worktreePath?: string
  readonly branch?: string
  readonly commitSha?: string
  readonly rationale?: string
  readonly mainCheckoutChanged?: boolean
}
export interface PassRow {
  readonly id: string
  readonly agentId: string
  readonly status: PassStatus
  readonly sessionId: string | undefined
  readonly branch: string | undefined
  readonly worktreePath: string | undefined
  readonly reason: string | undefined
  readonly agentVersion: string
}

export interface Store {
  recordCall(call: CallInput): void
  getCall(callId: string): CallRow | undefined
  submitRating(input: RatingInput): SubmitResult
  /** Newest first. */
  recentRatings(agentId: string, limit: number): RatingRow[]
  getState(agentId: string): AgentState
  /** Every agent type that has a rating or a state record. */
  listAgents(): string[]
  /** Latest pass for the agent, if any. */
  latestPass(agentId: string): PassRow | undefined
  saveState(agentId: string, state: AgentState): void
  /** Returns the new pass id, or undefined when another pass is already running. */
  startPass(input: PassStart): string | undefined
  updatePassSession(passId: string, sessionId: string): void
  updatePassTuner(passId: string, tunerVersion: string): void
  finishPass(passId: string, result: PassFinish): void
  getPass(passId: string): PassRow | undefined
  runningPass(): PassRow | undefined
  /** Marks `running` passes that started before `now - olderThanMs` as failed; returns how many. */
  reconcileStalePasses(now: number, olderThanMs: number): number
  /** True the first time (key, session) is recorded. */
  markNotified(noticeKey: string, sessionId: string, now: number): boolean
  close(): void
}

/** A database inside a git work tree could be committed by accident. */
function insideGitWorkTree(path: string): boolean {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return true
    if (dir === parse(dir).root) return false
  }
}

export async function openStore(path: string): Promise<Store> {
  if (insideGitWorkTree(path)) throw new Error("refusing to store ratings inside a git work tree")
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  closeSync(openSync(path, "a", 0o600))
  chmodSync(path, 0o600)
  const db = await openDriver(path)
  migrate(db)
  return createStore(db)
}

interface PassDbRow {
  id: string
  agent_id: string
  agent_version: string
  status: PassStatus
  session_id: string | null
  branch: string | null
  worktree_path: string | null
  reason: string | null
}
const toPassRow = (r: PassDbRow): PassRow => ({
  id: r.id,
  agentId: r.agent_id,
  status: r.status,
  sessionId: r.session_id ?? undefined,
  branch: r.branch ?? undefined,
  worktreePath: r.worktree_path ?? undefined,
  reason: r.reason ?? undefined,
  agentVersion: r.agent_version,
})

interface StateDbRow {
  agent_id: string
  state: AgentState["status"]
  tripped_version: string | null
  last_resolved_at: number
  cooldown_until: number
}
const toState = (r: StateDbRow): AgentState => ({
  status: r.state,
  ...(r.tripped_version === null ? {} : { trippedVersion: r.tripped_version }),
  lastResolvedAt: r.last_resolved_at,
  cooldownUntil: r.cooldown_until,
})

function createStore(db: Driver): Store {
  return {
    recordCall: (c) => {
      db.run(
        "INSERT OR IGNORE INTO calls (call_id, caller_session_id, caller_agent, child_session_id, agent_id, agent_version, status, created_at) VALUES (?,?,?,?,?,?,'pending',?)",
        c.callId, c.callerSessionId, c.callerAgent, c.childSessionId, c.agentId, c.agentVersion, c.createdAt,
      )
    },

    getCall(callId) {
      const r = db.get<Record<string, string | number>>("SELECT * FROM calls WHERE call_id = ?", callId)
      if (!r) return undefined
      return {
        callId: r["call_id"] as string,
        callerSessionId: r["caller_session_id"] as string,
        callerAgent: r["caller_agent"] as string,
        childSessionId: r["child_session_id"] as string,
        agentId: r["agent_id"] as string,
        agentVersion: r["agent_version"] as string,
        createdAt: r["created_at"] as number,
        status: r["status"] as CallRow["status"],
      }
    },

    submitRating(input) {
      const invalid = validateRating({ score: input.score, comment: input.comment }, input.commentMax)
      if (invalid) return { ok: false, error: invalid }
      return db.transaction<SubmitResult>(() => {
        const call = this.getCall(input.callId)
        if (!call) return { ok: false, error: `unknown call id ${input.callId}` }
        if (call.callerSessionId !== input.callerSessionId) return { ok: false, error: "call was not made by this session" }
        if (call.status !== "pending") return { ok: false, error: `call already ${call.status}` }
        if (input.now - call.createdAt > input.pendingTtlMs) {
          db.run("UPDATE calls SET status = 'expired' WHERE call_id = ?", call.callId)
          return { ok: false, error: "call expired: ratings must be submitted promptly" }
        }
        db.run(
          "INSERT INTO ratings (call_id, agent_id, agent_version, score, comment, caller_session_id, child_session_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
          call.callId, call.agentId, call.agentVersion, input.score, input.comment, call.callerSessionId, call.childSessionId, input.now,
        )
        db.run("UPDATE calls SET status = 'rated' WHERE call_id = ?", call.callId)
        return { ok: true }
      })
    },

    recentRatings: (agentId, limit) =>
      db
        .all<{ score: number; agent_version: string; created_at: number; comment: string }>(
          "SELECT score, agent_version, created_at, comment FROM ratings WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          agentId, limit,
        )
        .map((r) => ({ score: r.score, version: r.agent_version, createdAt: r.created_at, comment: r.comment })),

    getState(agentId) {
      const r = db.get<StateDbRow>("SELECT * FROM agent_state WHERE agent_id = ?", agentId)
      return r ? toState(r) : { status: "ok", lastResolvedAt: 0, cooldownUntil: 0 }
    },

    listAgents: () =>
      db
        .all<{ agent_id: string }>("SELECT agent_id FROM ratings UNION SELECT agent_id FROM agent_state ORDER BY agent_id")
        .map((r) => r.agent_id),

    latestPass(agentId) {
      const r = db.get<PassDbRow>(
        "SELECT id, agent_id, agent_version, status, session_id, branch, worktree_path, reason FROM passes WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1",
        agentId,
      )
      return r && toPassRow(r)
    },

    saveState: (agentId, s) => {
      db.run(
        `INSERT INTO agent_state (agent_id, state, tripped_version, last_resolved_at, cooldown_until) VALUES (?,?,?,?,?)
         ON CONFLICT(agent_id) DO UPDATE SET state = excluded.state, tripped_version = excluded.tripped_version,
           last_resolved_at = excluded.last_resolved_at, cooldown_until = excluded.cooldown_until`,
        agentId, s.status, s.trippedVersion ?? null, s.lastResolvedAt, s.cooldownUntil,
      )
    },

    startPass(p) {
      const id = randomUUID()
      try {
        db.run(
          "INSERT INTO passes (id, agent_id, agent_version, tuner_id, tuner_version, status, started_at) VALUES (?,?,?,?,?,'running',?)",
          id, p.agentId, p.agentVersion, p.tunerId, p.tunerVersion, p.now,
        )
        return id
      } catch (err) {
        if (err instanceof Error && /UNIQUE/i.test(err.message)) return undefined
        throw err
      }
    },

    updatePassTuner: (passId, tunerVersion) => {
      db.run("UPDATE passes SET tuner_version = ? WHERE id = ?", tunerVersion, passId)
    },

    updatePassSession: (passId, sessionId) => {
      db.run("UPDATE passes SET session_id = ? WHERE id = ?", sessionId, passId)
    },

    finishPass: (passId, r) => {
      db.run(
        `UPDATE passes SET status = ?, ended_at = ?, reason = ?, session_id = COALESCE(?, session_id), worktree_path = ?, branch = ?,
           commit_sha = ?, rationale = ?, main_checkout_changed = ? WHERE id = ?`,
        r.status, r.now, r.reason ?? null, r.sessionId ?? null, r.worktreePath ?? null, r.branch ?? null,
        r.commitSha ?? null, r.rationale ?? null, r.mainCheckoutChanged ? 1 : 0, passId,
      )
    },

    getPass(passId) {
      const r = db.get<PassDbRow>("SELECT id, agent_id, agent_version, status, session_id, branch, worktree_path, reason FROM passes WHERE id = ?", passId)
      return r && toPassRow(r)
    },

    runningPass() {
      const r = db.get<PassDbRow>("SELECT id, agent_id, agent_version, status, session_id, branch, worktree_path, reason FROM passes WHERE status = 'running'")
      return r && toPassRow(r)
    },

    reconcileStalePasses: (now, olderThanMs) =>
      db.run("UPDATE passes SET status = 'failed', ended_at = ?, reason = 'stale at startup' WHERE status = 'running' AND started_at < ?", now, now - olderThanMs).changes,

    markNotified: (noticeKey, sessionId, now) =>
      db.run("INSERT OR IGNORE INTO notifications (notice_key, session_id, created_at) VALUES (?,?,?)", noticeKey, sessionId, now).changes === 1,

    close: () => db.close(),
  }
}
