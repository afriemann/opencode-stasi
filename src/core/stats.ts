export interface RatingRow {
  readonly score: number
  readonly version: string
  readonly createdAt: number
}

export interface WindowOptions {
  readonly windowSize: number
  readonly version: string
  readonly resolvedAt: number
}

export interface WindowStats {
  readonly n: number
  readonly mean: number | undefined
  readonly median: number | undefined
  readonly shareLow: number
}

const LOW_SCORE_MAX = 2

export function windowStats(rows: readonly RatingRow[], opts: WindowOptions): WindowStats {
  const scores = rows
    .filter((row) => row.version === opts.version && row.createdAt > opts.resolvedAt)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, opts.windowSize)
    .map((row) => row.score)
  if (scores.length === 0) return { n: 0, mean: undefined, median: undefined, shareLow: 0 }
  const sorted = [...scores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  return {
    n: scores.length,
    mean: scores.reduce((sum, score) => sum + score, 0) / scores.length,
    median,
    shareLow: scores.filter((score) => score <= LOW_SCORE_MAX).length / scores.length,
  }
}
