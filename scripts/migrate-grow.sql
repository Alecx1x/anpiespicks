-- Adds the "grow/automate" features: intent events, audience subscribers, affiliate tracking.
-- Apply with: wrangler d1 execute betlink --local|--remote --file=./scripts/migrate-grow.sql

ALTER TABLE books ADD COLUMN affiliate_url TEXT;
ALTER TABLE books ADD COLUMN affiliate_status TEXT DEFAULT 'none'; -- none|interested|applied|accepted|rejected

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,            -- ISO date of the high-intent window
  name        TEXT NOT NULL,            -- e.g. "UFC 320", "NFL Week 1", "March Madness R1"
  sport       TEXT,                     -- nfl|nba|ufc|mlb|ncaa|other
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  state       TEXT,
  source      TEXT,                     -- where they opted in (landing, etc.)
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
