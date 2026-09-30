import { isPassLineage, type LineageSession } from "../core/exclusion.ts"
import type { HostPort } from "./port.ts"

/** Session metadata key under which a pass's sessions carry `{ passId }`. */
export const PASS_METADATA_KEY = "opencodeStasi"

const MAX_DEPTH = 32

const passIdOf = (metadata: Readonly<Record<string, unknown>> | undefined): string | undefined => {
  const marker = metadata?.[PASS_METADATA_KEY]
  const passId = marker !== null && typeof marker === "object" ? (marker as { passId?: unknown }).passId : undefined
  return typeof passId === "string" ? passId : undefined
}

/**
 * Whether a session descends from an improvement pass. Fails closed: a session
 * whose ancestry cannot be read is treated as pass lineage, so it is never asked to rate.
 */
export function createLineageCheck(
  port: Pick<HostPort, "session">,
  passSessionIds: () => ReadonlySet<string>,
  onError: (error: unknown) => void,
): (sessionId: string) => Promise<boolean> {
  const cache = new Map<string, boolean>()
  return async (sessionId) => {
    const cached = cache.get(sessionId)
    if (cached !== undefined) return cached
    const chain: LineageSession[] = []
    try {
      for (let id: string | undefined = sessionId; id !== undefined && chain.length < MAX_DEPTH; ) {
        const info = await port.session.get({ sessionID: id as never })
        const passId = passIdOf(info.metadata)
        chain.push(passId === undefined ? { id } : { id, passId })
        id = info.parentID
      }
    } catch (error) {
      onError(error)
      return true
    }
    const result = isPassLineage(chain, passSessionIds())
    cache.set(sessionId, result)
    return result
  }
}
