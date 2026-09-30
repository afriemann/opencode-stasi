const REGEX_SPECIAL = /[.+^${}()|[\]\\]/g

function globToRegExp(pattern: string): RegExp {
  let source = ""
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char === "*" && pattern[i + 1] === "*") {
      const followedBySlash = pattern[i + 2] === "/"
      source += followedBySlash ? "(?:.*/)?" : ".*"
      i += followedBySlash ? 2 : 1
    } else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else source += char.replace(REGEX_SPECIAL, "\\$&")
  }
  return new RegExp(`^${source}$`)
}

export const matchesGlob = (path: string, pattern: string): boolean => globToRegExp(pattern).test(path)

export function disallowedPaths(paths: readonly string[], patterns: readonly string[]): string[] {
  return paths.filter((path) => !patterns.some((pattern) => matchesGlob(path, pattern)))
}
