export function validateRating(input: { readonly score: unknown; readonly comment: unknown }, commentMaxChars: number): string | undefined {
  const { score, comment } = input
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) return "score must be an integer from 1 to 5"
  if (typeof comment !== "string" || comment.trim().length === 0) return "comment must be a non-empty string"
  if (comment.length > commentMaxChars) return `comment must be at most ${commentMaxChars} characters (got ${comment.length})`
  return undefined
}
