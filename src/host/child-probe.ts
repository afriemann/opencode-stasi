import type { HostPort } from "./port.ts"

/** Total budget for one probe: the session lookup plus the wait. Fails closed, never interrupts the child. */
export const CHILD_PROBE_TIMEOUT_MS = 1000
/** Safety ceiling on unresolved host waits per plugin instance; the host's `wait` cannot be aborted. */
export const MAX_IN_FLIGHT_CHILD_WAITS = 128

export type ProbeResult = "finished" | "running" | "unavailable"

export interface ChildProbe {
  /** Finished means: an execution of the child has ended (idle marker set) and a wait for idle resolves in time. */
  probe(childSessionId: string): Promise<ProbeResult>
  /** Wakes pending probes as unavailable and refuses new ones. Host waits cannot be cancelled and settle on their own. */
  dispose(): void
}

export interface ChildProbeOptions {
  readonly timeoutMs?: number
  readonly maxWaits?: number
}

type Raced<T> = { readonly kind: "value"; readonly value: T } | { readonly kind: "timeout" } | { readonly kind: "closed" }

export function createChildProbe(port: Pick<HostPort, "session">, options: ChildProbeOptions = {}): ChildProbe {
  const timeoutMs = options.timeoutMs ?? CHILD_PROBE_TIMEOUT_MS
  const maxWaits = options.maxWaits ?? MAX_IN_FLIGHT_CHILD_WAITS
  // One unresolved wait per child. An attempt that times out leaves its entry so retries join it instead of adding another.
  const waits = new Map<string, Promise<"ok" | "failed">>()
  let closed = false
  const wakers = new Set<() => void>()

  const race = async <T>(work: Promise<T>, ms: number): Promise<Raced<T>> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let waker: (() => void) | undefined
    const interrupted = new Promise<Raced<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), Math.max(ms, 0))
      waker = () => resolve({ kind: "closed" })
      wakers.add(waker)
    })
    try {
      return await Promise.race([work.then((value): Raced<T> => ({ kind: "value", value })), interrupted])
    } finally {
      clearTimeout(timer)
      if (waker) wakers.delete(waker)
    }
  }

  const waitFor = (childSessionId: string): Promise<"ok" | "failed"> | undefined => {
    const existing = waits.get(childSessionId)
    if (existing) return existing
    if (waits.size >= maxWaits) return undefined
    const entry = port.session
      .wait({ sessionID: childSessionId as never })
      .then((): "ok" | "failed" => "ok", (): "ok" | "failed" => "failed")
      .finally(() => {
        if (waits.get(childSessionId) === entry) waits.delete(childSessionId)
      })
    waits.set(childSessionId, entry)
    return entry
  }

  return {
    async probe(childSessionId) {
      try {
        return await attempt(childSessionId)
      } catch {
        return "unavailable"
      }
    },
    dispose() {
      closed = true
      for (const wake of wakers) wake()
      waits.clear()
    },
  }

  async function attempt(childSessionId: string): Promise<ProbeResult> {
    if (closed) return "unavailable"
    const started = Date.now()
    const info = await race(port.session.get({ sessionID: childSessionId as never }), timeoutMs)
    if (closed || info.kind !== "value" || typeof info.value !== "object" || info.value === null) return "unavailable"
    if (info.value.time?.idle === undefined) return "running"

    const entry = waitFor(childSessionId)
    if (!entry) return "unavailable"
    const settled = await race(entry, timeoutMs - (Date.now() - started))
    if (closed || settled.kind === "closed") return "unavailable"
    if (settled.kind === "timeout") return "running"
    return settled.value === "ok" ? "finished" : "unavailable"
  }
}
