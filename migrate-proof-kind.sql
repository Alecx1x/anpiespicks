-- Adds a "kind" to proofs so screenshots split into two galleries:
--   'stat' = profile/cross-platform stat screenshots (default, back-compat)
--   'win'  = recent-win screenshots dropped straight into the wins wall
-- NOTE: SQLite has no "ADD COLUMN IF NOT EXISTS" — run this ONCE per DB.
-- Re-running errors harmlessly ("duplicate column name: kind").
ALTER TABLE proofs ADD COLUMN kind TEXT NOT NULL DEFAULT 'stat';
CREATE INDEX IF NOT EXISTS idx_proofs_kind ON proofs (kind, sort, id);
