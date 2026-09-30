import { createHash } from "node:crypto"

const VERSION_FIELDS = ["system", "description", "mode", "model", "steps", "permissions"] as const
const VERSION_LENGTH = 16

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, item]) => [key, canonical(item)]),
    )
  }
  return value
}

export function agentVersion(info: Readonly<Record<string, unknown>>): string {
  const picked = Object.fromEntries(VERSION_FIELDS.map((field) => [field, info[field] ?? null]))
  return createHash("sha256").update(JSON.stringify(canonical(picked))).digest("hex").slice(0, VERSION_LENGTH)
}
