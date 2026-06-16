-- Adds the proofs table (cross-platform profile-stat screenshots) to an existing DB.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-proofs.sql
--      wrangler d1 execute betlink --remote --file=./migrate-proofs.sql
CREATE TABLE IF NOT EXISTS proofs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT,
  image_url   TEXT NOT NULL,
  caption     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
