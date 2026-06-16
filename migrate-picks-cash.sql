-- Adds $ tracking fields to the picks table (wager, profit, total payout).
-- Run: wrangler d1 execute betlink --local  --file=./migrate-picks-cash.sql
--      wrangler d1 execute betlink --remote --file=./migrate-picks-cash.sql
ALTER TABLE picks ADD COLUMN wager REAL;
ALTER TABLE picks ADD COLUMN profit_cash REAL;
ALTER TABLE picks ADD COLUMN payout REAL;
