-- Adds the images store + posts (Post Planner) tables to an existing DB.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-planner.sql
--      wrangler d1 execute betlink --remote --file=./migrate-planner.sql
CREATE TABLE IF NOT EXISTS images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mime        TEXT,
  data        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL DEFAULT 'x',
  title         TEXT,
  body          TEXT,
  link          TEXT,
  image_url     TEXT,
  event_id      INTEGER,
  scheduled_for TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled',
  channel       TEXT,
  posted_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_posts_sched ON posts(scheduled_for);
