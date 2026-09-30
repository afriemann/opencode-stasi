import type { Config } from "../core/config.ts"
import { markResolved } from "../core/trigger.ts"
import type { Git } from "../git/git.ts"
import type { Store } from "../store/repo.ts"
import type { ToolDefinition } from "./port.ts"

const HOUR_MS = 3_600_000

export interface ResolveDeps {
  readonly store: Store
  readonly config: Config
  readonly git: Pick<Git, "removeWorktree">
  readonly now: () => number
  /** True only for a root session that is not part of a tuning pass. */
  readonly isRootOutsidePass: (sessionId: string) => Promise<boolean>
}

export function subagentTuningResolveTool(deps: ResolveDeps): ToolDefinition {
  const { store, config } = deps
  return {
    name: "subagent_tuning_resolve",
    description:
      "Close the open improvement notice for a subagent type after you reviewed (or decided to ignore) the proposed branch. " +
      "`outcome` is accepted or dismissed; `confirm` must repeat the agent id exactly. Only a top-level session may call it, and never the agent the notice is about. " +
      "The pass worktree is removed unless it has uncommitted changes; the branch is kept.",
    input: {
      type: "object",
      properties: {
        agent: { type: "string" },
        outcome: { type: "string", enum: ["accepted", "dismissed"] },
        confirm: { type: "string", description: "Repeat the agent id to confirm." },
      },
      required: ["agent", "outcome", "confirm"],
    },
    options: { codemode: false },
    async execute(input: { agent?: unknown; outcome?: unknown; confirm?: unknown }, context) {
      if (typeof input.agent !== "string" || input.confirm !== input.agent) throw new Error("confirm must equal the agent id")
      if (input.outcome !== "accepted" && input.outcome !== "dismissed") throw new Error("outcome must be accepted or dismissed")
      if (context.agent === input.agent) throw new Error("an agent cannot resolve a notice about itself; ask the user or another agent")
      if (!(await deps.isRootOutsidePass(context.sessionID))) throw new Error("only a top-level session may resolve a tuning notice")
      const state = store.getState(input.agent)
      if (state.status !== "tripped" && state.status !== "awaiting_review") throw new Error(`no open notice for "${input.agent}"`)
      store.saveState(input.agent, markResolved(state, deps.now(), config.cooldownHours * HOUR_MS))
      const pass = store.latestPass(input.agent)
      let cleanup = "no worktree to remove"
      if (pass?.worktreePath && config.agentConfigRepo) {
        cleanup = await deps.git.removeWorktree(config.agentConfigRepo, pass.worktreePath).then(
          () => "worktree removed",
          () => "worktree kept (uncommitted changes or already gone)",
        )
      }
      return { content: `Resolved "${input.agent}" as ${input.outcome}; ${cleanup}${pass?.branch ? `; branch ${pass.branch} kept` : ""}.` }
    },
  }
}
