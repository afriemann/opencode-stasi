import { createHash } from "node:crypto"

const UINT32_RANGE = 2 ** 32

export function isSampled(callId: string, rate: number): boolean {
  const fraction = createHash("sha256").update(callId).digest().readUInt32BE(0) / UINT32_RANGE
  return fraction < rate
}
