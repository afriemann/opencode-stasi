const ANCHORS = "1 unusable/redo · 2 major rework · 3 usable with fixes · 4 good, used as-is · 5 excellent."
const TASK_LABEL_MAX = 200

export function normalizeTaskDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim().slice(0, TASK_LABEL_MAX) || undefined
}

export function ratingTarget(callId: string, agentId?: string, taskDescription?: string): string {
  const task = normalizeTaskDescription(taskDescription)
  return `call=${JSON.stringify(callId)}` +
    (agentId === undefined ? "" : ` agent=${JSON.stringify(agentId)}`) +
    (task === undefined ? "" : ` task=${JSON.stringify(task)}`)
}

export function ratingRequestLine(callId: string, agentId?: string, taskDescription?: string): string {
  return `[rate] rate_subagent {call:${JSON.stringify(callId)}, score:1-5, comment} — Target: ${ratingTarget(callId, agentId, taskDescription)}. ${ANCHORS} Judge the result against your brief only.`
}

/** Line for a background launch: the work is not finished yet, so the caller must keep the key and rate later. */
export function deferredRatingRequestLine(callId: string, agentId?: string, taskDescription?: string): string {
  return (
    `[rate] Keep call key ${JSON.stringify(callId)} for Target: ${ratingTarget(callId, agentId, taskDescription)}. After this background subagent finishes, read its eventual result or failure report, ` +
    `then call rate_subagent {call:${JSON.stringify(callId)}, score:1-5, comment}. Rate that work, not this launch acknowledgement: ${ANCHORS} ` +
    "Judge the result against your original brief only. Never invent a call key."
  )
}
