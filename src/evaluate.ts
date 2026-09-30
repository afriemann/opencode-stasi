import type { Config } from "./core/config.ts"
import { windowStats, type WindowStats } from "./core/stats.ts"
import { applyVersion, markTripped, shouldTrip } from "./core/trigger.ts"
import type { Store } from "./store/repo.ts"

const HOUR_MS = 3_600_000
const RATING_SCAN_LIMIT = 500

export interface Evaluation {
  readonly stats: WindowStats
  /** True when this evaluation moved the agent from ok/resolved to tripped. */
  readonly newlyTripped: boolean
}

export type EvaluationConfig = Pick<Config, "threshold" | "windowSize" | "minSamples" | "cooldownHours">

/** Applies auto-resolution for a changed definition version, then the trip rule, and persists the result. */
export function evaluateAgent(store: Store, config: EvaluationConfig, agentId: string, version: string, now: number): Evaluation {
  const before = store.getState(agentId)
  let state = applyVersion(before, version, now, config.cooldownHours * HOUR_MS)
  const stats = windowStats(store.recentRatings(agentId, RATING_SCAN_LIMIT), {
    windowSize: config.windowSize,
    version,
    resolvedAt: state.lastResolvedAt,
  })
  const newlyTripped = shouldTrip(state, stats, config, now)
  if (newlyTripped) state = markTripped(state, version)
  if (state !== before) store.saveState(agentId, state)
  return { stats, newlyTripped }
}
