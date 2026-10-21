import type { HostPort, PromptEvent, SessionInfo, ToolAfterEvent, ToolBeforeEvent, ToolDefinition } from "../port.ts"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type AfterHandler = (event: ToolAfterEvent) => Promise<void> | void

export interface FakeHost {
  readonly port: HostPort
  readonly tools: Map<string, ToolDefinition>
  /** Runs every registered `execute.after` handler, as the host would. */
  fireAfter(event: ToolAfterEvent): Promise<void>
  fireBefore(event: ToolBeforeEvent): Promise<void>
  firePrompt(event: PromptEvent): Promise<void>
  context(configPath: string): unknown
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
  const before: ((event: ToolBeforeEvent) => Promise<void> | void)[] = []
  const prompts: ((event: PromptEvent) => Promise<void> | void)[] = []
  const tools = new Map<string, ToolDefinition>()
  const pending = new Map<string, Waiter[]>()
  const host: FakeHost = {
    tools,
    context: (configPath) => ({
      ...host.port,
      options: { configPath },
      location: { directory: "/work/project" },
      agent: { ...host.port.agent, transform: async () => undefined },
      session: Object.assign(host.port.session, { synthetic: async () => undefined }),
      permission: { hook: async () => undefined },
      event: { async *subscribe() {} },
    }),
    fireBefore: async (event) => { for (const handler of before) await handler(event) },
    firePrompt: async (event) => { for (const handler of prompts) await handler(event) },
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
        hook: async (name: string, callback: unknown) => {
          if (name === "execute.before") before.push(callback as (typeof before)[number])
          else handlers.push(callback as AfterHandler)
        },
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
        hook: async (name: string, callback: unknown) => {
          if (name === "prompt") prompts.push(callback as (typeof prompts)[number])
        },
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

/** Runs the real plugin against an isolated fake host and private database. */
export async function setupFakePlugin(setup: (ctx: never) => unknown) {
  const dir = mkdtempSync(join(tmpdir(), "stasi-parent-"))
  const dbPath = join(dir, "data", "ratings.db")
  const configPath = join(dir, "config.json")
  writeFileSync(configPath, JSON.stringify({ dbPath }))
  const host = createFakeHost()
  host.sessions["parent"] = { id: "parent" }
  host.sessions["child"] = { id: "child", parentID: "parent" }
  host.sessions["sibling"] = { id: "sibling", parentID: "parent" }
  host.sessions["unrelated"] = { id: "unrelated" }
  const cleanup = await setup(host.context(configPath) as never) as (() => void)
  let closed = false
  return {
    host, dbPath,
    stop() { if (!closed) { cleanup(); closed = true } },
    dispose() { this.stop(); rmSync(dir, { recursive: true, force: true }) },
    async delegate(id: string, child = "child", resume = false) {
      const event: ToolBeforeEvent = {
        tool: "subagent", sessionID: "parent", agent: "engineer", messageID: `message-${id}`, id,
        input: { agent: "detective", prompt: `Brief ${id}`, ...(resume ? { sessionID: child } : {}) },
      }
      await host.fireBefore(event)
      const prompt: PromptEvent = { sessionID: child, messageID: `prompt-${id}`, prompt: { text: (event.input as { prompt: string }).prompt } }
      const correlated = structuredClone(prompt)
      await host.firePrompt(prompt)
      return { event, prompt, correlated, key: /\[rate-parent\] rate_parent \{call:"([^"]+)"/.exec(prompt.prompt.text ?? "")?.[1] }
    },
  }
}
