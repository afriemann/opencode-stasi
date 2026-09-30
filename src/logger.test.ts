import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createLogger } from "./logger.ts"

describe("logger", () => {
  it("writes prefixed one-line entries through the given sink", () => {
    const lines: string[] = []
    const logger = createLogger((line) => void lines.push(line))
    logger.info("hello")
    logger.error("broke", new Error("why"))
    assert.deepEqual(lines, ["[opencode-stasi] INFO hello\n", "[opencode-stasi] ERROR broke: why\n"])
  })
})
