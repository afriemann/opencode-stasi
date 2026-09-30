export interface LineageSession {
  readonly id: string
  readonly passId?: string
}

export function isPassLineage(chain: readonly LineageSession[], passSessionIDs: ReadonlySet<string>): boolean {
  return chain.some((session) => session.passId !== undefined || passSessionIDs.has(session.id))
}
