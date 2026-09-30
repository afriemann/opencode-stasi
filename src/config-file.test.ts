// spec: openspec/changes/subagent-rating-plugin/specs/subagent-rating-capture/spec.md
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { defaultConfigPath, defaultDbPath, loadConfig } from "./config-file.ts"

describe("config file", () => {
  it("honours XDG directories and falls back to the home directory", () => {
    assert.equal(defaultConfigPath({ XDG_CONFIG_HOME: "/x/cfg" }, "/h"), "/x/cfg/opencode/opencode-stasi.json")
    assert.equal(defaultDbPath({ XDG_DATA_HOME: "/x/data" }, "/h"), "/x/data/opencode-stasi/ratings.db")
    assert.equal(defaultConfigPath({}, "/h"), "/h/.config/opencode/opencode-stasi.json")
    assert.equal(defaultDbPath({}, "/h"), "/h/.local/share/opencode-stasi/ratings.db")
  })

  it("uses defaults for a missing file and reports invalid content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stasi-cfg-"))
    try {
      const missing = await loadConfig(join(dir, "none.json"))
      assert.ok(missing.ok && missing.config.threshold === 3)
      writeFileSync(join(dir, "bad.json"), "{nope")
      assert.equal((await loadConfig(join(dir, "bad.json"))).ok, false)
      writeFileSync(join(dir, "unknown.json"), '{"thresold": 2}')
      assert.equal((await loadConfig(join(dir, "unknown.json"))).ok, false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
