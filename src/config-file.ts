import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseConfig, type ConfigResult } from "./core/config.ts"

const APP = "opencode-stasi"

type Env = Readonly<Record<string, string | undefined>>

const nonEmpty = (value: string | undefined): string | undefined => (value ? value : undefined)

export function defaultConfigPath(env: Env = process.env, home: string = homedir()): string {
  return join(nonEmpty(env["XDG_CONFIG_HOME"]) ?? join(home, ".config"), "opencode", `${APP}.json`)
}

export function defaultDbPath(env: Env = process.env, home: string = homedir()): string {
  return join(nonEmpty(env["XDG_DATA_HOME"]) ?? join(home, ".local", "share"), APP, "ratings.db")
}

/** A missing file means defaults; an unreadable or invalid file is an error the caller reports. */
export async function loadConfig(path: string): Promise<ConfigResult> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseConfig({})
    return { ok: false, error: `cannot read ${path}: ${(error as Error).message}` }
  }
  try {
    return parseConfig(JSON.parse(text))
  } catch (error) {
    return { ok: false, error: `${path} is not valid JSON: ${(error as Error).message}` }
  }
}
