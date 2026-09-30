import { readFileSync } from "node:fs"
import { hostname, userInfo } from "node:os"
import { pathToFileURL } from "node:url"

export interface HygieneContext {
  readonly username: string
  readonly hostname: string
}

const HOME_PATH = /(?:\/home\/|\/Users\/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+/g
const MIN_IDENTITY_LENGTH = 3

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function wholeWord(value: string): RegExp | undefined {
  if (value.length < MIN_IDENTITY_LENGTH) return undefined
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(value)}(?![A-Za-z0-9_-])`, "i")
}

export function findLeaks(text: string, ctx: HygieneContext): string[] {
  const leaks = text.match(HOME_PATH) ?? []
  for (const identity of [ctx.username, ctx.hostname]) {
    const pattern = wholeWord(identity)
    if (pattern && pattern.test(text)) leaks.push(identity)
  }
  return leaks
}

function localContext(): HygieneContext {
  return { username: userInfo().username, hostname: hostname().split(".")[0] ?? "" }
}

function main(files: readonly string[]): number {
  const ctx = localContext()
  let failed = false
  for (const file of files) {
    for (const leak of findLeaks(readFileSync(file, "utf8"), ctx)) {
      process.stderr.write(`${file}: personal or system information (${leak.length} chars)\n`)
      failed = true
    }
  }
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2))
}
