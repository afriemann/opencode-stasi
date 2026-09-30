import type { WindowStats } from "./stats.ts"

export type TriggerStatus = "ok" | "tripped" | "awaiting_review" | "resolved"

export interface AgentState {
  readonly status: TriggerStatus
  readonly trippedVersion?: string
  readonly lastResolvedAt: number
  readonly cooldownUntil: number
}

export function shouldTrip(state: AgentState, stats: WindowStats, cfg: { readonly threshold: number; readonly minSamples: number }, now: number): boolean {
  if (state.status !== "ok" && state.status !== "resolved") return false
  if (stats.mean === undefined || stats.n < cfg.minSamples) return false
  return stats.mean < cfg.threshold && now >= state.cooldownUntil
}

export const markTripped = (state: AgentState, version: string): AgentState => ({ ...state, status: "tripped", trippedVersion: version })

export const markAwaitingReview = (state: AgentState): AgentState => ({ ...state, status: "awaiting_review" })

export function markResolved(state: AgentState, now: number, cooldownMs: number): AgentState {
  return { ...state, status: "resolved", lastResolvedAt: now, cooldownUntil: now + cooldownMs }
}

export function applyVersion(state: AgentState, version: string, now: number, cooldownMs: number): AgentState {
  const open = state.status === "tripped" || state.status === "awaiting_review"
  return open && version !== state.trippedVersion ? markResolved(state, now, cooldownMs) : state
}
