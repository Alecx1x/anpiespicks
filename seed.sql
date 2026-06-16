-- Betlink seed. Run AFTER db:init with: npm run db:seed
-- Categories are best-guess and should be confirmed. Bonus amounts + legality are
-- intentionally left blank/unverified — populate from real research, do not trust placeholders.

DELETE FROM books;
DELETE FROM offers;
DELETE FROM links;

INSERT INTO books (id, name, category, blurb, min_age, favorite, color) VALUES
  ('rebet',          'ReBet',              'social_sportsbook', 'Social sportsbook + casino with sweeps model.', 18, 1, '#7c3aed'),
  ('fliff',          'Fliff',              'social_sportsbook', 'Sweepstakes social sportsbook (Fliff Coins / Fliff Cash).', 18, 0, '#0ea5e9'),
  ('prizepicks',     'PrizePicks',         'dfs_pickem',        'Largest DFS pick''em app; runs Arena (peer-to-peer) where pick''em is restricted.', 18, 0, '#8b5cf6'),
  ('underdog',       'Underdog Fantasy',   'dfs_pickem',        'DFS pick''em + drafts; Underdog Sportsbook in select states.', 18, 0, '#f59e0b'),
  ('sleeper',        'Sleeper',            'dfs_pickem',        'Fantasy platform + Sleeper Picks DFS.', 18, 0, '#22c55e'),
  ('betr',           'Betr',               'dfs_pickem',        'Betr Picks (DFS) + Betr Sportsbook (real-money, select states).', 18, 0, '#ef4444'),
  ('parlayplay',     'ParlayPlay',         'dfs_pickem',        'DFS pick''em / parlay-style app.', 18, 0, '#ec4899'),
  ('dabble',         'Dabble',             'dfs_pickem',        'Social DFS pick''em with a feed; peer-to-peer style.', 18, 0, '#14b8a6'),
  ('bankroll',       'Bankroll',           'dfs_pickem',        'Formerly HotStreak — DFS pick''em.', 18, 0, '#f97316'),
  ('chalkboard',     'Chalkboard',         'dfs_pickem',        'Social DFS pick''em app.', 18, 0, '#06b6d4'),
  ('dk-pick6',       'DraftKings Pick 6',  'dfs_pickem',        'DraftKings'' pick''em product.', 18, 0, '#10b981'),
  ('courtside',      'Courtside',          'dfs_pickem',        'Social / DFS pick''em app.', 18, 0, '#6366f1'),
  ('bracco',         'Bracco',             'dfs_pickem',        'Newer social pick''em app.', 18, 0, '#84cc16'),
  ('novig',          'Novig',              'prediction_market', 'Peer-to-peer, no-vig prediction exchange (sweeps model in some states).', 18, 0, '#3b82f6'),
  ('predictionstrike','PredictionStrike',  'prediction_market', 'Sports "stock market" — VERIFY still operating.', 18, 0, '#a855f7'),
  ('thrillz',        'Thrillz',            'sweeps_casino',     'Sweepstakes social casino.', 18, 0, '#d946ef'),
  ('snoop-casino',   'Snoop Dogg Casino',  'sweeps_casino',     'Branded sweeps/social casino — VERIFY exact operator & terms.', 18, 0, '#facc15');

-- One placeholder OFFER per book so the dashboard has rows to edit.
-- referrer_value/referee_value = 0 until you fill in real numbers.
INSERT INTO offers (book_id, referrer_bonus, referee_bonus, required_action, active, verified_at)
SELECT id, 'TBD — verify', 'TBD — verify', 'TBD — verify required deposit/play', 1, NULL FROM books;

-- One placeholder DIRECT LINK per book. Replace target_url with your real referral URL.
-- Default 'direct' link per book; empty target_url => inherits books.referral_url.
INSERT INTO links (book_id, slug, channel, target_url, label)
SELECT id, id, 'direct', '', 'Default link' FROM books;
