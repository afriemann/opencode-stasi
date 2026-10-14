import { agentVersion } from "../core/version.ts"
import { isSampled } from "../core/sampling.ts"
import { deferredRatingRequestLine, ratingRequestLine } from "../core/rubric.ts"
import type { Config } from "../core/config.ts"
import type { Store } from "../store/repo.ts"
import type { HostPort, ToolAfterEvent, ToolResult } from "./port.ts"

export const SUBAGENT_TOOL = "subagent"

export interface CaptureDeps {
  readonly port: Pick<HostPort, "agent">
  readonly store: Store
  readonly config: Pick<Config, "samplingRate">
  readonly inPassLineage: (sessionId: string) => Promise<boolean>
  readonly now: () => number
  readonly log: (message: string, error?: unknown) => void
  readonly info?: (message: string) => void
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined

const hasContent = (result: ToolResult): boolean => typeof result.content === "string" || Array.isArray(result.content)

function appendLine(result: ToolResult, line: string): void {
  const { content } = result
  result.content = typeof content === "string" ? `${content}\n\n${line}` : [...(content ?? []), { type: "text", text: line }]
}

/** Records a pending call and appends the rating request to a completed foreground or new-child background `subagent` result. Never throws. */
export function createCaptureHook(deps: CaptureDeps): (event: ToolAfterEvent) => Promise<void> {
  return async (event) => {
    try {
      if (event.tool !== SUBAGENT_TOOL || event.status !== "completed") return
      const output = asRecord(event.result.output)
      const childSessionId = output?.["sessionID"]
      if (typeof childSessionId !== "string") return
      const input = asRecord(event.input)
      // A launch that names an existing session continues a child whose idle marker may be stale.
      const line =
        output?.["status"] === "completed"
          ? ratingRequestLine
          : output?.["status"] === "running" && input?.["sessionID"] === undefined
            ? deferredRatingRequestLine
            : undefined
      if (!line) return
      const requested = input?.["agent"]
      if (typeof requested !== "string") return
      if (!isSampled(event.id, deps.config.samplingRate)) return
      if (await deps.inPassLineage(event.sessionID)) return

      if (!hasContent(event.result)) return

      const { data } = await deps.port.agent.get({ agentID: requested as never })
      deps.store.recordCall({
        callId: event.id,
        callerSessionId: event.sessionID,
        callerAgent: event.agent,
        childSessionId,
        agentId: data.id,
        agentVersion: agentVersion(data),
        createdAt: deps.now(),
      })
      appendLine(event.result, line(event.id))
      deps.info?.(`rating requested: call ${event.id} to ${data.id}`)
    } catch (error) {
      deps.log("capture hook failed", error)
    }
  }
}
