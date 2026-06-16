-- Adds the promos table (deposit-match offer log) to an existing DB.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-promos.sql
--      wrangler d1 execute betlink --remote --file=./migrate-promos.sql
CREATE TABLE IF NOT EXISTS promos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     TEXT,
  match_pct   REAL,
  max_amount  REAL,
  duration    TEXT,
  must_parlay INTEGER NOT NULL DEFAULT 0,
  parlay_legs INTEGER,
  restriction TEXT,
  notes       TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
