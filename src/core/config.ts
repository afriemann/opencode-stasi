export interface PassConfig {
  readonly agent?: string
  readonly tools: readonly string[]
  readonly shellAllow: readonly string[]
  readonly timeoutMinutes: number
  readonly maxSteps: number
  readonly maxTokens: number
  readonly model?: string
}

export interface Config {
  readonly threshold: number
  readonly windowSize: number
  readonly minSamples: number
  readonly cooldownHours: number
  readonly samplingRate: number
  readonly commentMaxChars: number
  readonly pendingTtlHours: number
  readonly dbPath?: string
  readonly agentConfigRepo?: string
  readonly baseRef: string
  readonly allowedPaths: readonly string[]
  readonly triggerExclude: readonly string[]
  readonly pass: PassConfig
}

export type ConfigResult = { readonly ok: true; readonly config: Config } | { readonly ok: false; readonly error: string }

type Spec = "number" | "positiveInt" | "rate" | "string" | "stringList"

export const TOP_LEVEL: Record<string, Spec | "pass"> = {
  threshold: "number",
  windowSize: "positiveInt",
  minSamples: "positiveInt",
  cooldownHours: "number",
  samplingRate: "rate",
  commentMaxChars: "positiveInt",
  pendingTtlHours: "number",
  dbPath: "string",
  agentConfigRepo: "string",
  baseRef: "string",
  allowedPaths: "stringList",
  triggerExclude: "stringList",
  pass: "pass",
}

export const PASS_LEVEL: Record<string, Spec> = {
  agent: "string",
  tools: "stringList",
  shellAllow: "stringList",
  timeoutMinutes: "positiveInt",
  maxSteps: "positiveInt",
  maxTokens: "positiveInt",
  model: "string",
}

export const DEFAULT_PASS_TOOLS: readonly string[] = ["read", "glob", "grep", "edit", "write", "patch", "skill", "subagent_ratings"]
export const DEFAULT_ALLOWED_PATHS: readonly string[] = ["**/agents/*.md", "**/skills/**", "**/AGENTS.md"]

const DEFAULTS = {
  threshold: 3.0,
  windowSize: 20,
  minSamples: 8,
  cooldownHours: 24,
  samplingRate: 1.0,
  commentMaxChars: 500,
  pendingTtlHours: 24,
  baseRef: "HEAD",
  allowedPaths: DEFAULT_ALLOWED_PATHS,
  triggerExclude: [] as readonly string[],
}

const PASS_DEFAULTS = {
  tools: DEFAULT_PASS_TOOLS,
  shellAllow: [] as readonly string[],
  timeoutMinutes: 30,
  maxSteps: 60,
  maxTokens: 2_000_000,
}

function checkValue(key: string, value: unknown, spec: Spec): string | undefined {
  const bad = (expected: string) => `"${key}" must be ${expected}`
  switch (spec) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? undefined : bad("a non-negative number")
    case "positiveInt":
      return Number.isInteger(value) && (value as number) > 0 ? undefined : bad("a positive integer")
    case "rate":
      return typeof value === "number" && value >= 0 && value <= 1 ? undefined : bad("a number between 0 and 1")
    case "string":
      return typeof value === "string" && value.length > 0 ? undefined : bad("a non-empty string")
    case "stringList":
      return Array.isArray(value) && value.every((item) => typeof item === "string") ? undefined : bad("a list of strings")
  }
}

function validateObject(raw: Record<string, unknown>, schema: Record<string, Spec | "pass">, scope: string): string | undefined {
  for (const [key, value] of Object.entries(raw)) {
    const spec = schema[key]
    if (spec === undefined) return `unknown key "${scope}${key}"`
    if (spec === "pass") continue
    const problem = checkValue(`${scope}${key}`, value, spec)
    if (problem) return problem
  }
  return undefined
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

export function parseConfig(raw: unknown): ConfigResult {
  if (!isObject(raw)) return { ok: false, error: "configuration must be a JSON object" }
  const problem = validateObject(raw, TOP_LEVEL, "")
  if (problem) return { ok: false, error: problem }
  const rawPass = raw["pass"] ?? {}
  if (!isObject(rawPass)) return { ok: false, error: '"pass" must be an object' }
  const passProblem = validateObject(rawPass, PASS_LEVEL, "pass.")
  if (passProblem) return { ok: false, error: passProblem }
  const { pass: _pass, ...top } = raw
  const config = { ...DEFAULTS, ...top, pass: { ...PASS_DEFAULTS, ...rawPass } } as Config
  return { ok: true, config }
}
