const PREFIX = "[opencode-stasi]"

export interface Logger {
  info(message: string): void
  /** Also used for warnings; the optional error contributes its message. */
  error(message: string, error?: unknown): void
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * V2 plugins have no logging API; opencode captures plugin stderr into its own log,
 * where these lines appear as `message="[opencode-stasi] ..."`.
 */
export function createLogger(write: (line: string) => void = (line) => void process.stderr.write(line)): Logger {
  return {
    info: (message) => write(`${PREFIX} INFO ${message}\n`),
    error: (message, error) => write(`${PREFIX} ERROR ${error === undefined ? message : `${message}: ${describe(error)}`}\n`),
  }
}
