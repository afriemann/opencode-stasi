import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { PASS_LEVEL, TOP_LEVEL } from "./core/config.ts"

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

describe("README", () => {
  it("documents every configuration key", () => {
    const top = Object.keys(TOP_LEVEL).filter((key) => key !== "pass")
    const pass = Object.keys(PASS_LEVEL).map((key) => `pass.${key}`)
    const missing = [...top, ...pass].filter((key) => !readme.includes(`| \`${key}\` |`))
    assert.deepEqual(missing, [])
  })
})
