import type { HostPort, SessionInfo, ToolAfterEvent, ToolDefinition } from "../port.ts"

type AfterHandler = (event: ToolAfterEvent) => Promise<void> | void

export interface FakeHost {
  readonly port: HostPort
  readonly tools: Map<string, ToolDefinition>
  /** Runs every registered `execute.after` handler, as the host would. */
  fireAfter(event: ToolAfterEvent): Promise<void>
  agents: Record<string, Record<string, unknown> & { id: string }>
  sessions: Record<string, SessionInfo>
}

export function createFakeHost(): FakeHost {
  const handlers: AfterHandler[] = []
  const tools = new Map<string, ToolDefinition>()
  const host: FakeHost = {
    tools,
    agents: {},
    sessions: {},
    fireAfter: async (event) => {
      for (const handler of handlers) await handler(event)
    },
    port: {
      tool: {
        hook: async (_name, callback) => void handlers.push(callback),
        transform: async (callback) => void callback({ add: (tool) => void tools.set(tool.name, tool) }),
      },
      agent: {
        get: async ({ agentID }) => {
          const data = host.agents[agentID]
          if (!data) throw new Error(`unknown agent ${agentID}`)
          return { data }
        },
      },
      session: {
        get: async ({ sessionID }) => {
          const info = host.sessions[sessionID]
          if (!info) throw new Error(`unknown session ${sessionID}`)
          return info
        },
      },
    },
  }
  return host
}

/** Shape of a completed foreground `subagent` call, taken from the built-in tool's output schema. */
export function subagentCompleted(id: string, overrides: { status?: "completed" | "running"; agent?: string; sessionID?: string } = {}): ToolAfterEvent {
  return {
    tool: "subagent",
    sessionID: "ses_root",
    agent: "build",
    id,
    input: { agent: overrides.agent ?? "explore", description: "d", prompt: "p" },
    status: "completed",
    result: {
      output: { sessionID: "ses_child", status: overrides.status ?? "completed", output: "done" },
      content: [{ type: "text", text: "done" }],
      metadata: {},
    },
  }
}
