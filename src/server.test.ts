// spec: openspec/changes/subagent-rating-plugin/specs/subagent-improvement-trigger/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { registerBuiltinTuner } from "./pass/tuner.ts"
import plugin from "./server.ts"

function fakeCtx(options: Record<string, unknown>) {
  const registered: string[] = []
  const hooks: string[] = []
  const agents: Record<string, { permissions: unknown[]; [key: string]: unknown }> = {}
  const ctx = {
    options,
    agent: {
      transform: async (cb: (editor: { update(id: string, fn: (item: never) => void): void }) => void) =>
        cb({
          update: (id, fn) => {
            agents[id] ??= { permissions: [] }
            fn(agents[id] as never)
          },
        }),
    },
    tool: {
      transform: async (cb: (editor: { add(tool: { name: string }): void }) => void) => cb({ add: (tool) => void registered.push(tool.name) }),
      hook: async (name: string) => void hooks.push(`tool:${name}`),
    },
    session: { get: async () => ({ id: "s" }), hook: async (name: string) => void hooks.push(`session:${name}`) },
    permission: { hook: async (name: string) => void hooks.push(`permission:${name}`) },
    event: { async *subscribe() {} },
  }
  return { ctx, registered, hooks, agents }
}

const run = (ctx: unknown) => (plugin as unknown as { setup(ctx: unknown): Promise<(() => void) | void> }).setup(ctx)

describe("plugin wiring", () => {
  it("registers tools, hooks and the built-in tuner, and cleans up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stasi-setup-"))
    try {
      const configPath = join(dir, "cfg.json")
      writeFileSync(configPath, JSON.stringify({ dbPath: join(dir, "data", "ratings.db") }))
      const { ctx, registered, hooks, agents } = fakeCtx({ configPath })
      const cleanup = await run(ctx)
      assert.deepEqual(registered.sort(), ["rate_subagent", "subagent_ratings", "subagent_tuning_resolve"])
      assert.deepEqual(hooks.sort(), ["permission:evaluate", "session:context", "tool:execute.after"])
      assert.equal(agents["subagent-tuner"]?.["mode"], "primary")
      assert.equal(agents["subagent-tuner"]?.["hidden"], true)
      assert.equal(typeof cleanup, "function")
      ;(cleanup as () => void)()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("does not register the built-in tuner when pass.agent is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stasi-setup-"))
    try {
      const configPath = join(dir, "cfg.json")
      writeFileSync(configPath, JSON.stringify({ dbPath: join(dir, "data", "ratings.db"), pass: { agent: "custom" } }))
      const { ctx, agents } = fakeCtx({ configPath })
      const cleanup = await run(ctx)
      assert.deepEqual(Object.keys(agents), [])
      ;(cleanup as () => void)()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("disables itself on an invalid configuration", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stasi-setup-"))
    try {
      const configPath = join(dir, "cfg.json")
      writeFileSync(configPath, '{"thresold": 1}')
      const { ctx, registered } = fakeCtx({ configPath })
      assert.equal(await run(ctx), undefined)
      assert.deepEqual(registered, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("built-in tuner", () => {
  it("is hidden, primary, generic and limited to the allowlist", async () => {
    const { ctx, agents } = fakeCtx({})
    await registerBuiltinTuner(ctx.agent as never, "subagent-tuner", ["read", "edit", "write"])
    const tuner = agents["subagent-tuner"]!
    assert.equal(tuner["hidden"], true)
    assert.match(String(tuner["system"]), /subagent_ratings/)
    assert.doesNotMatch(String(tuner["system"]), /engineer/i)
    const actions = (tuner.permissions as { action: string; effect: string }[]).filter((p) => p.effect === "allow").map((p) => p.action)
    assert.deepEqual(actions, ["read", "edit"])
  })
})
