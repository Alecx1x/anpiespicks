-- Adds the proof_url column (win/bet-slip screenshot) to an existing picks table.
-- Run: wrangler d1 execute betlink --local  --file=./migrate-picks-proof.sql
--      wrangler d1 execute betlink --remote --file=./migrate-picks-proof.sql
ALTER TABLE picks ADD COLUMN proof_url TEXT;
