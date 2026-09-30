/** Tools a pass session must never have, even when listed in `pass.tools`. */
export const NEVER_IN_PASS: ReadonlySet<string> = new Set(["rate_subagent", "subagent_tuning_resolve"])

export interface ContainmentDeps {
  readonly inPassLineage: (sessionId: string) => Promise<boolean>
  readonly allowedTools: readonly string[]
}

export interface ContextEvent {
  readonly sessionID: string
  tools: Record<string, unknown>
}

export interface PermissionEvent {
  readonly sessionID: string
  effect: "allow" | "deny" | "ask"
  message?: string | undefined
}

/** Hooks that keep a tuning-pass lineage inside its allowlist and away from human prompts. */
export function createContainment(deps: ContainmentDeps) {
  const allowed = new Set(deps.allowedTools.filter((tool) => !NEVER_IN_PASS.has(tool)))
  return {
    async onContext(event: ContextEvent): Promise<void> {
      if (!(await deps.inPassLineage(event.sessionID))) return
      for (const name of Object.keys(event.tools)) if (!allowed.has(name)) delete event.tools[name]
    },
    async onPermission(event: PermissionEvent): Promise<void> {
      if (event.effect !== "ask" || !(await deps.inPassLineage(event.sessionID))) return
      event.effect = "deny"
      event.message = "Unattended tuning pass: this action needs approval that cannot be given."
    },
  }
}
