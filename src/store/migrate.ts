import type { Driver } from "./driver.ts"

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE calls (
    call_id TEXT PRIMARY KEY,
    caller_session_id TEXT NOT NULL,
    caller_agent TEXT NOT NULL,
    child_session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','rated','expired')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id TEXT NOT NULL UNIQUE REFERENCES calls(call_id),
    agent_id TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT NOT NULL CHECK (length(comment) >= 1),
    caller_session_id TEXT NOT NULL,
    child_session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ratings_by_agent ON ratings (agent_id, agent_version, created_at DESC);
  CREATE TABLE agent_state (
    agent_id TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('ok','tripped','awaiting_review','resolved')),
    tripped_version TEXT,
    last_resolved_at INTEGER NOT NULL DEFAULT 0,
    cooldown_until INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE passes (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    agent_version TEXT NOT NULL,
    tuner_id TEXT NOT NULL,
    tuner_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','committed','no_change','notify_only','failed','failed_scope','failed_commit','interrupted')),
    reason TEXT,
    main_checkout_changed INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    worktree_path TEXT,
    branch TEXT,
    commit_sha TEXT,
    rationale TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE UNIQUE INDEX one_running_pass ON passes (status) WHERE status = 'running';
  CREATE TABLE notifications (
    notice_key TEXT NOT NULL,
    session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (notice_key, session_id)
  );
  `,
]

export function migrate(db: Driver): void {
  const current = db.get<{ user_version: number }>("PRAGMA user_version")?.user_version ?? 0
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v] as string)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}
