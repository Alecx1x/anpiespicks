-- Adds the bonus_history table to an existing DB without touching other data.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-bonus-history.sql
--      wrangler d1 execute betlink --remote --file=./migrate-bonus-history.sql
CREATE TABLE IF NOT EXISTS bonus_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         TEXT NOT NULL,
  referrer_bonus  TEXT,
  referee_bonus   TEXT,
  referrer_value  REAL,
  referee_value   REAL,
  source          TEXT DEFAULT 'manual',
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bonus_history_book ON bonus_history(book_id, created_at);
