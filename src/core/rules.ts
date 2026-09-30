export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

export interface RuleInput {
  readonly tools: readonly string[]
  readonly shellAllow: readonly string[]
  readonly allowedPaths: readonly string[]
}

/** Tools whose permission action is `edit` and whose resources are worktree-relative paths. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write", "patch"])
const SHELL_TOOL = "shell"
const ENV_FILE_PATTERNS = ["*.env", "*.env.*"]
const NO_REDIRECT = "*>*"

/** The host's wildcard matches `*` across path separators, so `**` collapses to `*`. */
export function toWildcard(glob: string): string[] {
  const collapsed = glob.replaceAll("**", "*")
  return glob.startsWith("**/") ? [collapsed, collapsed.slice(2)] : [collapsed]
}

const rule = (action: string, resource: string, effect: PermissionRule["effect"]): PermissionRule => ({ action, resource, effect })

/**
 * Session permission rules for a tuning-pass session. The host evaluates last-match-wins, so
 * every deny-all comes first and the narrower allows follow.
 */
export function buildPassRules(input: RuleInput): PermissionRule[] {
  const rules: PermissionRule[] = [rule("external_directory", "*", "deny"), rule("edit", "*", "deny"), rule(SHELL_TOOL, "*", "deny")]
  for (const tool of input.tools) {
    if (EDIT_TOOLS.has(tool) || tool === SHELL_TOOL) continue
    rules.push(rule(tool, "*", "allow"))
  }
  if (input.tools.includes("read")) for (const pattern of ENV_FILE_PATTERNS) rules.push(rule("read", pattern, "deny"))
  if (input.tools.some((tool) => EDIT_TOOLS.has(tool))) {
    for (const glob of input.allowedPaths) for (const resource of toWildcard(glob)) rules.push(rule("edit", resource, "allow"))
  }
  if (input.tools.includes(SHELL_TOOL)) {
    for (const pattern of input.shellAllow) rules.push(rule(SHELL_TOOL, pattern, "allow"))
    rules.push(rule(SHELL_TOOL, NO_REDIRECT, "deny"))
  }
  return rules
}
