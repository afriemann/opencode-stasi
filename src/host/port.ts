import type { Plugin } from "@opencode/plugin"
import type { Agent } from "@opencode/schema/agent"
import type { Session } from "@opencode/schema/session"

/** Result of the built-in `subagent` tool, as far as this plugin reads or edits it. */
export interface ToolResult {
  output?: unknown
  content?: string | ReadonlyArray<{ readonly type: string; readonly text?: string }>
  metadata?: unknown
}

export type ToolAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly id: string
  readonly input: unknown
} & ({ readonly status: "completed"; result: ToolResult } | { readonly status: "error" })

export interface ToolCallContext {
  readonly sessionID: string
  readonly agent: string
}

export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly input: {
    readonly type: "object"
    readonly properties: Readonly<Record<string, unknown>>
    readonly required?: readonly string[]
  }
  readonly options: { readonly codemode: false }
  readonly execute: (input: any, context: ToolCallContext) => Promise<{ readonly content: string }>
}

export interface SessionInfo {
  readonly id: string
  readonly parentID?: string | undefined
  readonly metadata?: Readonly<Record<string, unknown>> | undefined
}

/** The slice of `Plugin.Context` the capture and tool modules use; fakes implement this. */
export interface HostPort {
  readonly tool: {
    hook(name: "execute.after", callback: (event: ToolAfterEvent) => Promise<void> | void): Promise<unknown>
    transform(callback: (editor: { add(tool: ToolDefinition): void }) => void): Promise<unknown>
  }
  readonly agent: {
    get(input: { readonly agentID: Agent.ID }): Promise<{ readonly data: Readonly<Record<string, unknown>> & { readonly id: string } }>
  }
  readonly session: {
    get(input: { readonly sessionID: Session.ID }): Promise<SessionInfo>
  }
}

/** Compile-time drift check: the real context must remain assignable to the port. */
export const asHostPort = (context: Plugin.Context): HostPort => context
