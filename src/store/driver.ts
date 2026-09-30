export type SqlValue = string | number | bigint | null | Uint8Array

export interface Driver {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): { changes: number }
  all<T>(sql: string, ...params: SqlValue[]): T[]
  get<T>(sql: string, ...params: SqlValue[]): T | undefined
  /** Runs `fn` inside BEGIN IMMEDIATE; rolls back if it throws. */
  transaction<T>(fn: () => T): T
  close(): void
}

interface Statement {
  run(...params: SqlValue[]): { changes: number | bigint }
  all(...params: SqlValue[]): unknown[]
  get(...params: SqlValue[]): unknown
}
interface RawDb {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}

/** `bun:sqlite` under Bun, `node:sqlite` otherwise; both expose the same synchronous surface used here. */
export async function openDriver(path: string): Promise<Driver> {
  const db = await openRaw(path)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA foreign_keys = ON")
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, ...params) => ({ changes: Number(db.prepare(sql).run(...params).changes) }),
    all: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, ...params: SqlValue[]) => db.prepare(sql).get(...params) as T | undefined,
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.exec("COMMIT")
        return result
      } catch (err) {
        db.exec("ROLLBACK")
        throw err
      }
    },
    close: () => db.close(),
  }
}

async function openRaw(path: string): Promise<RawDb> {
  if (process.versions.bun) {
    const specifier = "bun:sqlite" // variable specifier: no Bun type declarations are installed
    const { Database } = (await import(specifier)) as { Database: new (p: string) => RawDb }
    return new Database(path)
  }
  const { DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (p: string) => RawDb }
  return new DatabaseSync(path)
}
