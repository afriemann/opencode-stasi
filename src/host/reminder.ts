import type { Store } from "../store/repo.ts"

export interface ReminderDeps {
  readonly store: Store
  readonly now: () => number
  readonly isRootOutsidePass: (sessionId: string) => Promise<boolean>
  /** Persists a hidden message in the session without starting a turn. */
  readonly notify: (sessionId: string, text: string) => Promise<void>
  readonly log: (message: string) => void
}

/** One reminder per root session for each open tripped or awaiting_review notice. */
export function createReminder(deps: ReminderDeps) {
  const { store } = deps
  return async (sessionId: string): Promise<void> => {
    try {
      const open = store.listAgents().flatMap((agent) => {
        const { status } = store.getState(agent)
        if (status !== "tripped" && status !== "awaiting_review") return []
        const pass = store.latestPass(agent)
        return [{ agent, status, pass, key: `${agent}:${status}:${pass?.id ?? "none"}` }]
      })
      if (open.length === 0 || !(await deps.isRootOutsidePass(sessionId))) return
      const fresh = open.filter((notice) => store.markNotified(notice.key, sessionId, deps.now()))
      if (fresh.length === 0) return
      const lines = fresh.map(
        (n) => `- ${n.agent}: ${n.status.replace("_", " ")}${n.pass?.status === "committed" ? `, proposed branch ${n.pass.branch}` : ` (pass ${n.pass?.status ?? "not started"})`}`,
      )
      await deps.notify(
        sessionId,
        `[opencode-stasi] Subagent quality notice:\n${lines.join("\n")}\nInspect with subagent_ratings; close with subagent_tuning_resolve after review.`,
      )
    } catch (error) {
      deps.log(`reminder failed: ${String(error)}`)
    }
  }
}
