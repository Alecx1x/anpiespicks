-- migrate-articles.sql — the content/blog layer (SEO surface that links into the funnel).
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,        -- URL: /blog/<slug>
  title         TEXT NOT NULL,
  dek           TEXT,                        -- summary / subtitle (also used as meta description)
  body          TEXT,                        -- article body in lightweight markdown
  tags          TEXT,                        -- comma-separated (sport/state/topic)
  cover_url     TEXT,                        -- optional hero image (/img/N)
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | published
  published_at  TEXT,                        -- set when first published
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status, published_at);
