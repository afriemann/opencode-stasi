const ANCHORS = "1 unusable/redo · 2 major rework · 3 usable with fixes · 4 good, used as-is · 5 excellent."

export function ratingRequestLine(callId: string): string {
  return `[rate] rate_subagent {call:"${callId}", score:1-5, comment} — ${ANCHORS} Judge the result against your brief only.`
}

/** Line for a background launch: the work is not finished yet, so the caller must keep the key and rate later. */
export function deferredRatingRequestLine(callId: string): string {
  return (
    `[rate] Keep call key "${callId}". After this background subagent finishes, read its eventual result or failure report, ` +
    `then call rate_subagent {call:"${callId}", score:1-5, comment}. Rate that work, not this launch acknowledgement: ${ANCHORS} ` +
    "Judge the result against your original brief only. Never invent a call key."
  )
}
