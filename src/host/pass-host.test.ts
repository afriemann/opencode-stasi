import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { Git } from "../git/git.ts"
import { createPassHost, parseModel } from "./pass-host.ts"

const git = {} as Git

function fakeCtx(events: unknown[], parents: Record<string, string | undefined>) {
  return {
    session: { get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, parentID: parents[sessionID] }) },
    agent: {},
    event: {
      async *subscribe() {
        for (const event of events) yield event
      },
    },
  } as never
}

describe("parseModel", () => {
  it("splits provider and model at the first slash", () => {
    assert.deepEqual(parseModel("openai/gpt-x/y"), { providerID: "openai", id: "gpt-x/y" })
    assert.equal(parseModel("nomodel"), undefined)
  })
})

describe("pass host usage tracking", () => {
  it("counts steps and tokens of the pass lineage and keeps the pass session's last text", async () => {
    const events = [
      { type: "session.step.ended", data: { sessionID: "ses_pass", tokens: { input: 10, output: 5, reasoning: 1 } } },
      { type: "session.step.ended", data: { sessionID: "ses_child", tokens: { input: 1, output: 1 } } },
      { type: "session.step.ended", data: { sessionID: "ses_other", tokens: { input: 100, output: 100 } } },
      { type: "session.text.ended", data: { sessionID: "ses_child", text: "child text" } },
      { type: "session.text.ended", data: { sessionID: "ses_pass", text: "rationale" } },
    ]
    const host = createPassHost(fakeCtx(events, { ses_child: "ses_pass" }), git, () => undefined)
    host.onSession("p1", "ses_pass")
    await host.watchEvents(new AbortController().signal)
    assert.deepEqual(host.usage("p1"), { steps: 2, tokens: 18, text: "rationale" })
    assert.equal(host.finalText("p1"), "rationale")
    assert.ok(host.passSessionIds.has("ses_pass"))
  })
})
