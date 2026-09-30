import type { Plugin } from "@opencode/plugin"
import { agentVersion } from "../core/version.ts"
import type { Git } from "../git/git.ts"
import type { PassPorts } from "../pass/runner.ts"

const MAX_PARENT_HOPS = 32
const MODEL_SEPARATOR = "/"

interface EventEnvelope {
  readonly type: string
  readonly data?: {
    readonly sessionID?: string
    readonly text?: string
    readonly tokens?: { readonly input?: number; readonly output?: number; readonly reasoning?: number }
  }
}

interface Usage {
  steps: number
  tokens: number
  text: string
}

export interface PassHost extends PassPorts {
  /** Every pass root session created by this plugin instance. */
  readonly passSessionIds: ReadonlySet<string>
  /** Consumes host events until `signal` aborts. Never throws. */
  watchEvents(signal: AbortSignal): Promise<void>
}

/** Model config is `provider/model`; the model id itself may contain further slashes. */
export function parseModel(value: string): { providerID: string; id: string } | undefined {
  const at = value.indexOf(MODEL_SEPARATOR)
  return at > 0 && at < value.length - 1 ? { providerID: value.slice(0, at), id: value.slice(at + 1) } : undefined
}

export function createPassHost(ctx: Pick<Plugin.Context, "session" | "agent" | "event">, git: Git, log: (message: string) => void): PassHost {
  const passOfSession = new Map<string, string>()
  const usage = new Map<string, Usage>()
  const passSessionIds = new Set<string>()

  const ancestry = async (sessionId: string): Promise<string | undefined> => {
    let current: string | undefined = sessionId
    for (let hop = 0; current !== undefined && hop < MAX_PARENT_HOPS; hop++) {
      const known = passOfSession.get(current)
      if (known !== undefined) return known
      const info = await ctx.session.get({ sessionID: current as never })
      current = info.parentID
    }
    return undefined
  }

  const attribute = async (sessionId: string): Promise<string | undefined> => ancestry(sessionId).catch(() => undefined)

  async function handle(event: EventEnvelope): Promise<void> {
    const sessionId = event.data?.sessionID
    if (sessionId === undefined || (event.type !== "session.step.ended" && event.type !== "session.text.ended")) return
    const passId = await attribute(sessionId)
    const entry = passId === undefined ? undefined : usage.get(passId)
    if (entry === undefined) return
    if (event.type === "session.step.ended") {
      const tokens = event.data?.tokens
      entry.steps += 1
      entry.tokens += (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0)
    } else if (passOfSession.has(sessionId) && event.data?.text !== undefined) entry.text = event.data.text
  }

  return {
    git,
    passSessionIds,

    async resolveAgent(agentId, directory) {
      const found = await ctx.agent.get({ agentID: agentId as never, location: { directory } as never }).catch(() => undefined)
      if (!found) return undefined
      return { version: agentVersion(found.data as never) }
    },

    async createSession(request) {
      const model = request.model === undefined ? undefined : parseModel(request.model)
      if (request.model !== undefined && model === undefined) throw new Error(`pass.model "${request.model}" must look like provider/model`)
      const session = await ctx.session.create({
        agent: request.agent as never,
        location: { directory: request.directory } as never,
        metadata: request.metadata as never,
        permissions: request.permissions as never,
        ...(model ? { model: model as never } : {}),
      })
      return { id: session.id }
    },

    async prompt(sessionId, text) {
      await ctx.session.prompt({ sessionID: sessionId as never, text })
    },
    async wait(sessionId) {
      await ctx.session.wait({ sessionID: sessionId as never })
    },
    async interrupt(sessionId) {
      await ctx.session.interrupt({ sessionID: sessionId as never })
    },

    onSession(passId, sessionId) {
      passOfSession.set(sessionId, passId)
      passSessionIds.add(sessionId)
      usage.set(passId, { steps: 0, tokens: 0, text: "" })
    },
    usage: (passId) => usage.get(passId) ?? { steps: 0, tokens: 0 },
    finalText: (passId) => usage.get(passId)?.text ?? "",
    release(passId) {
      usage.delete(passId)
    },

    async watchEvents(signal) {
      try {
        for await (const event of ctx.event.subscribe({ signal } as never)) {
          if (signal.aborted) return
          await handle(event as unknown as EventEnvelope).catch((error) => log(`event handling failed: ${String(error)}`))
        }
      } catch (error) {
        if (!signal.aborted) log(`event subscription ended: ${String(error)}`)
      }
    },
  }
}
