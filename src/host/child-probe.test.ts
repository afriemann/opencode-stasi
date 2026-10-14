// spec: openspec/changes/background-rating-solicitation/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import { createChildProbe } from "./child-probe.ts"
import { createFakeHost, type FakeHost } from "./testing/fake-host.ts"

let host: FakeHost
const TIMEOUT = 20

beforeEach(() => {
  host = createFakeHost()
})
const probe = (maxWaits = 128) => createChildProbe(host.port, { timeoutMs: TIMEOUT, maxWaits })
const idle = (id: string) => (host.sessions[id] = { id, time: { idle: 5 } })

describe("Rating requires a finished child", () => {
  it("finished child: idle marker and resolving wait", async () => {
    idle("c")
    assert.equal(await probe().probe("c"), "finished")
  })

  it("new child without an idle marker is running and starts no wait", async () => {
    host.sessions["c"] = { id: "c" }
    assert.equal(await probe().probe("c"), "running")
    assert.deepEqual(host.waitCalls, [])
  })

  it("active child whose wait does not resolve in time is running", async () => {
    idle("c")
    host.waitMode["c"] = "pending"
    assert.equal(await probe().probe("c"), "running")
  })

  it("lookup or wait failure, or unknown child, is unavailable", async () => {
    assert.equal(await probe().probe("missing"), "unavailable")
    idle("c")
    host.waitMode["c"] = "reject"
    assert.equal(await probe().probe("c"), "unavailable")
  })
})

describe("Rating requires a finished child (host throws)", () => {
  it("a host that throws synchronously is unavailable, not an exception", async () => {
    idle("c")
    const throwing = { session: { get: () => { throw new Error("boom") }, wait: () => { throw new Error("boom") } } }
    assert.equal(await createChildProbe(throwing as never, { timeoutMs: TIMEOUT }).probe("c"), "unavailable")
    const waitThrows = { session: { get: host.port.session.get, wait: () => { throw new Error("boom") } } }
    assert.equal(await createChildProbe(waitThrows as never, { timeoutMs: TIMEOUT }).probe("c"), "unavailable")
  })
})

describe("Child probing is bounded", () => {
  it("Concurrent and repeated attempts share one wait", async () => {
    idle("c")
    host.waitMode["c"] = "pending"
    const p = probe()
    assert.deepEqual(await Promise.all([p.probe("c"), p.probe("c")]), ["running", "running"])
    assert.equal(await p.probe("c"), "running")
    assert.equal(host.waitCalls.length, 1)
  })

  it("a retry joins the retained wait and sees it resolve", async () => {
    idle("c")
    host.waitMode["c"] = "pending"
    const p = probe()
    assert.equal(await p.probe("c"), "running")
    const retry = p.probe("c")
    await new Promise((r) => setImmediate(r))
    host.settleWaits("c")
    assert.equal(await retry, "finished")
    assert.equal(host.waitCalls.length, 1)
  })

  it("Settled wait is released", async () => {
    idle("c")
    host.waitMode["c"] = "pending"
    const p = probe()
    assert.equal(await p.probe("c"), "running")
    host.settleWaits("c", "reject")
    await new Promise((r) => setImmediate(r))
    host.waitMode["c"] = "resolve"
    assert.equal(await p.probe("c"), "finished")
    assert.equal(host.waitCalls.length, 2)
  })

  it("Capacity is exhausted", async () => {
    for (const id of ["a", "b", "z"]) idle(id)
    host.waitMode["a"] = "pending"
    host.waitMode["b"] = "pending"
    const p = probe(2)
    await p.probe("a")
    await p.probe("b")
    assert.equal(await p.probe("z"), "unavailable")
    assert.equal(host.waitCalls.includes("z"), false)
    assert.equal(await p.probe("a"), "running")
    assert.equal(host.waitCalls.length, 2)
  })

  it("Unload stops late storage", async () => {
    idle("c")
    host.waitMode["c"] = "pending"
    const p = probe()
    const attempt = p.probe("c")
    p.dispose()
    assert.equal(await attempt, "unavailable")
    assert.equal(await p.probe("c"), "unavailable")
  })
})
