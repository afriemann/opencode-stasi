import { randomBytes } from "node:crypto"
import type { Config } from "../core/config.ts"
import type { ParentCall, Store } from "../store/repo.ts"
import { PASS_METADATA_KEY } from "./lineage.ts"
import type { HostPort, PromptEvent, SessionInfo, ToolBeforeEvent } from "./port.ts"

const NONCE_TTL_MS = 5 * 60_000
const MAX_NONCES = 1024
const MAX_LOOKUPS = 128
const LOOKUP_TIMEOUT_MS = 1000
const MAX_ANCESTORS = 32
const HOUR_MS = 3_600_000
const envelope = /\n?<stasi-parent nonce="([a-f0-9]{64})"[ \t]*\/>\n?/g

interface Pending {
  readonly call: Omit<ParentCall, "childSessionId" | "childMessageId">
  readonly expectedChild: string | undefined
  readonly nonceExpiresAt: number
}

interface ParentCaptureDeps {
  readonly port: HostPort
  readonly store: Store
  readonly config: Config
  readonly now: () => number
  readonly passSessionIds: () => ReadonlySet<string>
  readonly passive: boolean
  readonly log: (message: string) => void
}

/** Early correlation needs a complete, fresh lineage walk, unlike the cached downward exclusion. */
export function createParentCapture(deps: ParentCaptureDeps) {
  const pending = new Map<string, Pending>()
  let active = true
  let lookups = 0
  const prune = () => {
    for (const [key, value] of pending) if (deps.now() >= value.nonceExpiresAt) pending.delete(key)
  }
  const lookup = async (id: string): Promise<SessionInfo> => {
    if (!active || lookups >= MAX_LOOKUPS) throw new Error("identity lookup unavailable")
    lookups++
    // The host cannot cancel get(); keep the slot occupied after a deadline until it settles.
    const work = Promise.resolve().then(() => deps.port.session.get({ sessionID: id as never }))
      .finally(() => { lookups-- })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("identity lookup deadline")), LOOKUP_TIMEOUT_MS)
      })])
      if (!active || result.id !== id) throw new Error("identity lookup unavailable")
      return result
    } finally { clearTimeout(timer) }
  }
  const isEligible = async (sessionId: string): Promise<boolean> => {
    if (!active || deps.passive) return false
    const seen = new Set<string>()
    try {
      let id: string | undefined = sessionId
      while (id !== undefined && seen.size < MAX_ANCESTORS) {
        if (seen.has(id) || deps.passSessionIds().has(id)) return false
        seen.add(id)
        const session = await lookup(id)
        const marker = session.metadata?.[PASS_METADATA_KEY]
        if (marker && typeof marker === "object" && typeof (marker as { passId?: unknown }).passId === "string") return false
        id = session.parentID
      }
      return active && id === undefined
    } catch { return false }
  }
  return {
    isEligible,
    isActive: () => active,
    dispose() { active = false; pending.clear() },
    async before(event: ToolBeforeEvent): Promise<void> {
      try {
        if (!active || event.tool !== "subagent" || !event.input || typeof event.input !== "object") return
        const input = event.input as { prompt?: unknown; sessionID?: unknown }
        if (typeof input.prompt !== "string" || (input.sessionID !== undefined && typeof input.sessionID !== "string")) return
        prune()
        if (pending.size >= MAX_NONCES || !(await isEligible(event.sessionID))) return
        if (!active || pending.size >= MAX_NONCES) return
        const nonce = randomBytes(32).toString("hex")
        const createdAt = deps.now()
        pending.set(nonce, {
          call: { callId: event.id, parentSessionId: event.sessionID, parentAgent: event.agent, parentMessageId: event.messageID, createdAt, expiresAt: createdAt + deps.config.pendingTtlHours * HOUR_MS },
          expectedChild: input.sessionID as string | undefined,
          nonceExpiresAt: createdAt + NONCE_TTL_MS,
        })
        input.prompt += `\n<stasi-parent nonce="${nonce}"/>\n`
      } catch { deps.log("upward capture omitted: before hook failed") }
    },
    async prompt(event: PromptEvent): Promise<void> {
      const text = event.prompt.text
      if (typeof text !== "string") return
      const matches = [...text.matchAll(envelope)]
      if (!matches.length) return
      // Strip correlation even when lookup, persistence, restart, expiry or unload prevents feedback.
      event.prompt.text = text.replace(envelope, "")
      try {
        prune()
        if (!active || matches.length !== 1) return
        const entry = pending.get(matches[0]![1]!)
        if (!entry || (entry.expectedChild !== undefined && entry.expectedChild !== event.sessionID)) return
        const child = await lookup(event.sessionID)
        if (child.parentID !== entry.call.parentSessionId) return
        if (!(await isEligible(event.sessionID)) || !(await isEligible(entry.call.parentSessionId))) return
        if (!active || deps.now() >= entry.nonceExpiresAt) return
        const key = deps.store.bindParentCall({ ...entry.call, childSessionId: event.sessionID, childMessageId: event.messageID }, deps.now())
        if (!key) return
        event.prompt.text += `\n\n[rate-parent] rate_parent {call:"${key}", score:1-5, comment} — As your first action, assess the initial brief's clarity, context, scope and executable instructions, not your eventual result. This is advisory: do not block work or completion if unavailable. Do not quote the brief, secrets or sensitive values. 1 unusable · 2 major gaps · 3 workable · 4 clear · 5 excellent.`
      } catch { deps.log("upward capture omitted: prompt binding failed") }
    },
  }
}

export type ParentCapture = ReturnType<typeof createParentCapture>
