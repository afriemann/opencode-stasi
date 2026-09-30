export function ratingRequestLine(callId: string): string {
  return (
    `[rate] rate_subagent {call:"${callId}", score:1-5, comment} — ` +
    "1 unusable/redo · 2 major rework · 3 usable with fixes · 4 good, used as-is · 5 excellent. " +
    "Judge the result against your brief only."
  )
}
