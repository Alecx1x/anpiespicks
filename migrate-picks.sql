-- Adds the picks table to an existing DB without touching other data.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-picks.sql
--      wrangler d1 execute betlink --remote --file=./migrate-picks.sql
CREATE TABLE IF NOT EXISTS picks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sport       TEXT,
  league      TEXT,
  event       TEXT NOT NULL,
  selection   TEXT NOT NULL,
  market      TEXT,
  odds        REAL,
  model_prob  REAL,
  edge        REAL,
  stake       REAL DEFAULT 1,
  book        TEXT,
  analysis    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  visibility  TEXT NOT NULL DEFAULT 'free',
  source      TEXT NOT NULL DEFAULT 'manual',
  ext_id      TEXT,
  event_at    TEXT,
  posted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_picks_status ON picks(status);
CREATE INDEX IF NOT EXISTS idx_picks_posted ON picks(posted_at);
CREATE INDEX IF NOT EXISTS idx_picks_src ON picks(source, ext_id);
