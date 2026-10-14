import type { HostPort, SessionInfo, ToolAfterEvent, ToolDefinition } from "../port.ts"

type AfterHandler = (event: ToolAfterEvent) => Promise<void> | void

export interface FakeHost {
  readonly port: HostPort
  readonly tools: Map<string, ToolDefinition>
  /** Runs every registered `execute.after` handler, as the host would. */
  fireAfter(event: ToolAfterEvent): Promise<void>
  agents: Record<string, Record<string, unknown> & { id: string }>
  sessions: Record<string, SessionInfo>
  /**
   * How `session.wait` behaves per session: `resolve` (idle, the default), `pending` (an active execution
   * keeps it unresolved until `settleWaits`), or `reject`. Independent of `time.idle`, because the host can
   * resolve a wait before a new child started, and a resumed child keeps a stale idle marker while active.
   */
  waitMode: Record<string, "resolve" | "pending" | "reject">
  /** Every `session.wait` invocation, in order. */
  waitCalls: string[]
  /** Settles all pending waits of a session, resolving or rejecting them. */
  settleWaits(sessionID: string, outcome?: "resolve" | "reject"): void
}

interface Waiter {
  resolve: () => void
  reject: (error: Error) => void
}

export function createFakeHost(): FakeHost {
  const handlers: AfterHandler[] = []
  const tools = new Map<string, ToolDefinition>()
  const pending = new Map<string, Waiter[]>()
  const host: FakeHost = {
    tools,
    agents: {},
    sessions: {},
    waitMode: {},
    waitCalls: [],
    settleWaits: (sessionID, outcome = "resolve") => {
      for (const waiter of pending.get(sessionID) ?? []) {
        if (outcome === "resolve") waiter.resolve()
        else waiter.reject(new Error("wait failed"))
      }
      pending.delete(sessionID)
    },
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
        wait: ({ sessionID }) => {
          host.waitCalls.push(sessionID)
          if (!host.sessions[sessionID]) return Promise.reject(new Error(`unknown session ${sessionID}`))
          const mode = host.waitMode[sessionID] ?? "resolve"
          if (mode === "reject") return Promise.reject(new Error(`wait failed ${sessionID}`))
          if (mode === "resolve") return Promise.resolve()
          return new Promise<void>((resolve, reject) => {
            const list = (pending.get(sessionID) ?? []) as Waiter[]
            list.push({ resolve, reject })
            pending.set(sessionID, list)
          })
        },
      },
    },
  }
  return host
}

/** Shape of a completed foreground `subagent` call, taken from the built-in tool's output schema. */
export function subagentCompleted(id: string, overrides: { status?: "completed" | "running"; agent?: string; sessionID?: string; inputSessionID?: string } = {}): ToolAfterEvent {
  return {
    tool: "subagent",
    sessionID: "ses_root",
    agent: "build",
    id,
    input: {
      agent: overrides.agent ?? "explore",
      description: "d",
      prompt: "p",
      ...(overrides.inputSessionID === undefined ? {} : { sessionID: overrides.inputSessionID }),
    },
    status: "completed",
    result: {
      output: { sessionID: "ses_child", status: overrides.status ?? "completed", output: "done" },
      content: [{ type: "text", text: "done" }],
      metadata: {},
    },
  }
}
