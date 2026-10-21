// spec: openspec/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { describe, it } from "node:test"
import plugin from "../server.ts"
import { parseConfig } from "../core/config.ts"
import type { Store } from "../store/repo.ts"
import { createParentCapture } from "./parent-capture.ts"
import { createFakeHost, setupFakePlugin } from "./testing/fake-host.ts"

describe("upward request capture", () => {
  it("New and resumed briefs receive independent advisory keys", async () => {
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const first = await f.delegate("one")
      const resumed = await f.delegate("two", "child", true)
      assert.ok(first.key, "new brief must solicit feedback before execution")
      assert.ok(resumed.key)
      assert.notEqual(first.key, resumed.key)
      assert.match(first.prompt.prompt.text!, /clarity.*context.*scope/i)
      assert.match(first.prompt.prompt.text!, /advisory/i)
      assert.equal(f.host.waitCalls.length, 0)
    } finally { f.dispose() }
  })

  it("Siblings and conflicting prompt replays cannot claim requests", async () => {
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const { correlated, key } = await f.delegate("one", "child", true)
      assert.ok(key)
      await f.host.firePrompt({ ...correlated, sessionID: "sibling", messageID: "other", prompt: { ...correlated.prompt } })
      const replay = { ...correlated, messageID: "other", prompt: { ...correlated.prompt } }
      await f.host.firePrompt(replay)
      assert.doesNotMatch(replay.prompt.text!, /rate-parent|stasi-parent/)
      await assert.rejects(f.host.tools.get("rate_parent")!.execute({ call: key, score: 5, comment: "clear" }, { sessionID: "sibling", agent: "detective" }), /bound child|ownership|session/)
    } finally { f.dispose() }
  })

  it("Prompt retries reuse only their original binding", async () => {
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const { correlated, key } = await f.delegate("one")
      assert.ok(key)
      await f.host.firePrompt(correlated)
      assert.match(correlated.prompt.text!, new RegExp(key))
      const trimmed = structuredClone((await f.delegate("trimmed")).correlated)
      trimmed.prompt.text = trimmed.prompt.text!.trim()
      await f.host.firePrompt(trimmed)
      assert.doesNotMatch(trimmed.prompt.text!, /stasi-parent/)
      assert.match(trimmed.prompt.text!, /rate-parent/)
    } finally { f.dispose() }
  })

  it("Failure and abandoned correlation leave delegation usable", async () => {
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const { correlated, key } = await f.delegate("one")
      assert.ok(key)
      const orphan = { ...structuredClone(correlated), sessionID: "unknown", messageID: "failed" }
      await f.host.firePrompt(orphan)
      assert.equal(orphan.prompt.text, "Brief one")
      const expired = structuredClone(correlated)
      const original = Date.now
      Date.now = () => original() + 6 * 60_000
      try { await f.host.firePrompt(expired) }
      finally { Date.now = original }
      assert.equal(expired.prompt.text, "Brief one")
      f.stop()
      const fresh = await setupFakePlugin(plugin.setup!)
      try {
        await fresh.host.firePrompt(correlated)
        assert.equal(correlated.prompt.text, "Brief one")
      } finally { fresh.dispose() }
    } finally { f.dispose() }
    const host = createFakeHost()
    host.sessions.parent = { id: "parent" }
    host.sessions.child = { id: "child", parentID: "parent" }
    const config = parseConfig({})
    assert.ok(config.ok)
    const logs: string[] = []
    const capture = createParentCapture({ port: host.port, config: config.config, now: Date.now, passive: false, passSessionIds: () => new Set(), log: message => logs.push(message), store: { bindParentCall() { throw new Error("storage unavailable") } } as unknown as Store })
    try {
      const event = { tool: "subagent", sessionID: "parent", agent: "engineer", messageID: "m", id: "storage-failure", input: { prompt: "brief" } }
      await capture.before(event)
      assert.match(event.input.prompt, /stasi-parent/)
      const prompt = { sessionID: "child", messageID: "child-m", prompt: { text: event.input.prompt } }
      await capture.prompt(prompt)
      assert.equal(prompt.prompt.text, "brief")
      assert.deepEqual(logs, ["upward capture omitted: prompt binding failed"])
    } finally { capture.dispose() }
  })

  it("Capacity and unload prevent unbounded or late capture", async () => {
    const host = createFakeHost()
    const config = parseConfig({})
    assert.ok(config.ok)
    let lookups = 0
    const releases: Array<() => void> = []
    host.port.session.get = async () => {
      lookups++
      await new Promise<void>(resolve => releases.push(resolve))
      return { id: "parent" }
    }
    const capture = createParentCapture({ port: host.port, config: config.config, now: Date.now, passive: false, passSessionIds: () => new Set(), log: () => {}, store: {} as Store })
    try {
      const events = Array.from({ length: 128 }, (_, n) => ({ tool: "subagent", sessionID: "parent", agent: "engineer", messageID: "m", id: `lookup-${n}`, input: { prompt: "brief" } }))
      const work = Promise.all(events.map(event => capture.before(event)))
      await Promise.resolve()
      assert.equal(lookups, 128)
      const overflow = { ...events[0]!, input: { prompt: "overflow" } }
      await capture.before(overflow)
      assert.equal(overflow.input.prompt, "overflow")
      assert.equal(lookups, 128)
      await work
      assert.ok(events.every(event => event.input.prompt === "brief"), "lookup deadline must omit capture")
      await capture.before(overflow)
      assert.equal(lookups, 128, "timed-out unresolved lookups keep their slots")
    } finally {
      capture.dispose()
      for (const release of releases) release()
    }
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const issued = await f.delegate("one")
      assert.ok(issued.key)
      for (let n = 0; n < 1023; n++) {
        await f.host.fireBefore({ tool: "subagent", sessionID: "parent", agent: "engineer", messageID: "m", id: `c${n}`, input: { prompt: "brief" } })
      }
      const last = { tool: "subagent", sessionID: "parent", agent: "engineer", messageID: "m", id: "overflow", input: { prompt: "brief" } }
      await f.host.fireBefore(last)
      assert.equal(last.input.prompt, "brief")
      const pending = structuredClone(issued.correlated)
      const get = f.host.port.session.get
      let release!: () => void
      let entered!: () => void
      const started = new Promise<void>(resolve => { entered = resolve })
      f.host.port.session.get = async (input) => {
        entered()
        await new Promise<void>(resolve => { release = resolve })
        return get(input)
      }
      const work = f.host.firePrompt(pending)
      await started
      f.stop()
      release()
      await work
      assert.equal(pending.prompt.text, "Brief one")
    } finally { f.dispose() }
  })

  it("Pass and incomplete ancestry cannot produce upward votes", async () => {
    const f = await setupFakePlugin(plugin.setup!)
    try {
      const initial = await f.delegate("ordinary")
      assert.ok(initial.key)
      f.host.sessions.child = { id: "child", parentID: "parent", metadata: { opencodeStasi: { passId: "child-pass" } } }
      assert.equal((await f.delegate("pass-child")).key, undefined)
      await assert.rejects(f.host.tools.get("rate_parent")!.execute({ call: initial.key, score: 4, comment: "clear" }, { sessionID: "child", agent: "detective" }), /lineage|eligible/)
      f.host.sessions.child = { id: "child", parentID: "parent" }
      for (const parent of [
        { id: "parent", metadata: { opencodeStasi: { passId: "p" } } },
        { id: "parent", parentID: "parent" },
        { id: "parent", parentID: "unavailable" },
      ]) {
        f.host.sessions["parent"] = parent
        assert.equal((await f.delegate("excluded")).key, undefined)
        await assert.rejects(f.host.tools.get("rate_parent")!.execute({ call: initial.key, score: 4, comment: "clear" }, { sessionID: "child", agent: "detective" }), /lineage|eligible/)
      }
      for (let n = 0; n < 33; n++) f.host.sessions[`ancestor${n}`] = { id: `ancestor${n}`, ...(n < 32 ? { parentID: `ancestor${n + 1}` } : {}) }
      f.host.sessions["parent"] = { id: "parent", parentID: "ancestor0" }
      assert.equal((await f.delegate("too-deep")).key, undefined)
    } finally { f.dispose() }
  })
})
