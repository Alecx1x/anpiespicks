-- Betlink schema. Run with: npm run db:init
-- Safe to re-run: drops + recreates everything (local dev). Seed separately with db:seed.

DROP TABLE IF EXISTS promos;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS proofs;
DROP TABLE IF EXISTS picks;
DROP TABLE IF EXISTS bonus_history;
DROP TABLE IF EXISTS clicks;
DROP TABLE IF EXISTS conversions;
DROP TABLE IF EXISTS legality;
DROP TABLE IF EXISTS links;
DROP TABLE IF EXISTS offers;
DROP TABLE IF EXISTS books;

-- ---------------------------------------------------------------------------
-- books: the catalog of apps you promote (DFS pick'em, social/sweeps, prediction…)
-- ---------------------------------------------------------------------------
CREATE TABLE books (
  id          TEXT PRIMARY KEY,          -- slug, e.g. 'rebet'
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,             -- dfs_pickem | social_sportsbook | sweeps_casino | prediction_market | sportsbook | fantasy
  blurb       TEXT,                      -- short description
  notes       TEXT,                      -- longer notes / your own commentary
  website     TEXT,
  referral_url TEXT,                    -- the ONE real referral link/code the app gave you
  color       TEXT DEFAULT '#3b82f6',    -- brand color for UI chips
  min_age     INTEGER DEFAULT 18,        -- VERIFY per state (often 18/19/21)
  active      INTEGER NOT NULL DEFAULT 1,-- are you currently promoting it
  favorite    INTEGER NOT NULL DEFAULT 0,
  affiliate_url    TEXT,                -- official affiliate/CPA program (the "graduation" path)
  affiliate_status TEXT DEFAULT 'none', -- none|interested|applied|accepted|rejected
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- offers: referral bonus terms per book (history kept; one row active at a time)
-- ---------------------------------------------------------------------------
CREATE TABLE offers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id             TEXT NOT NULL REFERENCES books(id),
  referrer_bonus      TEXT,              -- what YOU get, e.g. "$50 bonus cash"
  referrer_value      REAL DEFAULT 0,    -- numeric $ value of your cut (for ranking)
  referee_bonus       TEXT,              -- what your FRIEND gets
  referee_value       REAL DEFAULT 0,
  required_action     TEXT,              -- e.g. "Deposit $10 and play it through once"
  required_deposit    REAL DEFAULT 0,
  playthrough         TEXT,              -- rollover / wagering requirement
  est_ev              REAL,              -- your computed net expected value (optional)
  promo_expires       TEXT,              -- ISO date or NULL
  terms_url           TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  verified_at         TEXT,              -- when you last confirmed this is real / current
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- links: your trackable referral links (one book can have many — per channel)
-- ---------------------------------------------------------------------------
CREATE TABLE links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     TEXT NOT NULL REFERENCES books(id),
  slug        TEXT NOT NULL UNIQUE,      -- short code: /go/<slug>
  channel     TEXT NOT NULL DEFAULT 'direct', -- direct | tiktok | reddit | discord | instagram | x | text | qr
  target_url  TEXT NOT NULL,            -- per-link override; '' = inherit book.referral_url
  label       TEXT,
  person      TEXT,                     -- set for per-person referral links
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- legality: state x book product status + "is it working right now"
--   Populate from real research. NULL verified_at == not yet confirmed.
-- ---------------------------------------------------------------------------
CREATE TABLE legality (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id             TEXT NOT NULL REFERENCES books(id),
  state               TEXT NOT NULL,     -- 2-letter, e.g. 'OH'
  status              TEXT NOT NULL DEFAULT 'unknown', -- legal | unavailable | gray | banned | unknown
  accepting_signups   INTEGER NOT NULL DEFAULT 0,       -- "working" — can a new user actually sign up
  promo_active        INTEGER NOT NULL DEFAULT 0,       -- is the referral promo live here
  product_note        TEXT,              -- e.g. "peer-to-peer Arena only, no pick'em"
  source_url          TEXT,
  verified_at         TEXT,
  UNIQUE(book_id, state)
);

-- ---------------------------------------------------------------------------
-- clicks: every redirect hit (owned, first-party analytics)
-- ---------------------------------------------------------------------------
CREATE TABLE clicks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     TEXT,                      -- resolved book (smart links resolve at click time)
  link_id     INTEGER,
  slug        TEXT,
  channel     TEXT,
  state       TEXT,
  country     TEXT,
  city        TEXT,
  device      TEXT,                      -- mobile | desktop | tablet
  referer     TEXT,
  ua          TEXT,
  ip_hash     TEXT,                      -- hashed, never store raw IP
  smart       INTEGER NOT NULL DEFAULT 0,
  ts          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- conversions: the funnel — signup -> deposit -> wager -> bonus_posted -> paid
-- ---------------------------------------------------------------------------
CREATE TABLE conversions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id       TEXT NOT NULL REFERENCES books(id),
  link_id       INTEGER,
  channel       TEXT,
  stage         TEXT NOT NULL DEFAULT 'signup', -- signup | deposit | wager | bonus_posted | paid
  amount        REAL DEFAULT 0,          -- $ value (bonus or payout) when known
  person_label  TEXT,                    -- optional note: "John from work"
  source        TEXT NOT NULL DEFAULT 'manual', -- manual | gmail | api
  email_msg_id  TEXT,                    -- Gmail message id, for dedupe
  occurred_on   TEXT NOT NULL DEFAULT (date('now')),
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- bonus_history: every change to a book's offer terms, with a timestamp.
--   Lets you see the swing (e.g. rebet $25 -> $40 -> $30) and push when it's high.
--   Written by manual dashboard saves AND the iPhone quick-update Shortcut.
-- ---------------------------------------------------------------------------
CREATE TABLE bonus_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id         TEXT NOT NULL,
  referrer_bonus  TEXT,              -- what YOU get, as stored at this moment
  referee_bonus   TEXT,              -- what your FRIEND gets
  referrer_value  REAL,
  referee_value   REAL,
  source          TEXT DEFAULT 'manual', -- manual | shortcut
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bonus_history_book ON bonus_history(book_id, created_at);

-- ---------------------------------------------------------------------------
-- picks: your published betting picks + a transparent, auto-graded track record.
--   Logged BEFORE the event (posted_at) so the record is provable, not hindsight.
--   Source 'edge-finder' rows are pushed in by the model bridge; 'manual' added in /admin.
-- ---------------------------------------------------------------------------
CREATE TABLE picks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sport       TEXT,
  league      TEXT,
  event       TEXT NOT NULL,            -- "Derrick Lewis vs Josh Hokit", "Lakers @ Celtics"
  selection   TEXT NOT NULL,            -- what you bet, e.g. "Derrick Lewis ML"
  market      TEXT,                     -- h2h | spread | total | prop
  odds        REAL,                     -- american odds at post time
  model_prob  REAL,                     -- model's win probability (0-1), if any
  edge        REAL,                     -- model edge (0-1), if any
  stake       REAL DEFAULT 1,           -- units risked (1u default)
  wager       REAL,                     -- $ amount actually risked (off the slip)
  profit_cash REAL,                     -- $ profit / "+money" if it wins
  payout      REAL,                     -- $ total return (wager + profit)
  book        TEXT,                     -- sportsbook the price was at
  analysis    TEXT,                     -- short reasoning shown publicly
  proof_url   TEXT,                     -- screenshot of the bet slip / win (image URL)
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | win | loss | push | void
  visibility  TEXT NOT NULL DEFAULT 'free',     -- free | premium (paywall later)
  source      TEXT NOT NULL DEFAULT 'manual',   -- manual | edge-finder
  ext_id      TEXT,                     -- source's own id (dedupe ingest)
  event_at    TEXT,                     -- when the game/fight happens
  posted_at   TEXT NOT NULL DEFAULT (datetime('now')), -- when published (the credibility timestamp)
  settled_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_picks_status ON picks(status);
CREATE INDEX idx_picks_posted ON picks(posted_at);
CREATE INDEX idx_picks_src ON picks(source, ext_id);

-- ---------------------------------------------------------------------------
-- proofs: screenshots of your profile stats across platforms (PrizePicks, Underdog,
--   DraftKings…) — a "verified across platforms" social-proof wall on /record.
-- ---------------------------------------------------------------------------
CREATE TABLE proofs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT,                     -- platform / title, e.g. "PrizePicks"
  image_url   TEXT NOT NULL,            -- screenshot image URL
  caption     TEXT,                     -- optional note, e.g. "lifetime +$2,140"
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- images: uploaded screenshots stored in-DB (base64), served via /img/:id.
--   Used when R2 isn't enabled — lets you upload straight from your phone.
--   Browser compresses before upload, so rows stay small.
-- ---------------------------------------------------------------------------
CREATE TABLE images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mime        TEXT,
  data        TEXT NOT NULL,            -- base64, no data: prefix
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- posts: the Post Planner — scheduled, platform-tailored social posts.
-- ---------------------------------------------------------------------------
CREATE TABLE posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform      TEXT NOT NULL DEFAULT 'x', -- x | reddit | instagram | tiktok | other
  title         TEXT,                      -- post title (Reddit)
  body          TEXT,                      -- caption / text (link kept separate)
  link          TEXT,                      -- url to include
  image_url     TEXT,                      -- optional attached image (/img/:id)
  event_id      INTEGER,                   -- optional ref to events
  scheduled_for TEXT,                      -- ISO date/datetime to post
  status        TEXT NOT NULL DEFAULT 'scheduled', -- draft | scheduled | posted
  channel       TEXT,                      -- attribution tag baked into the link
  posted_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_posts_sched ON posts(scheduled_for);

-- ---------------------------------------------------------------------------
-- promos: deposit-match (and similar) offers you get pinged about, logged to track.
-- ---------------------------------------------------------------------------
CREATE TABLE promos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id     TEXT,                     -- platform (book slug)
  match_pct   REAL,                     -- deposit match %, e.g. 50 or 100
  max_amount  REAL,                     -- up to how much $
  duration    TEXT,                     -- "for how long?" (free text)
  must_parlay INTEGER NOT NULL DEFAULT 0,
  parlay_legs INTEGER,                  -- min legs if must_parlay
  restriction TEXT,                     -- restricted to specific market/game/match?
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clicks_book ON clicks(book_id);
CREATE INDEX idx_clicks_ts ON clicks(ts);
CREATE INDEX idx_conv_book ON conversions(book_id);
CREATE INDEX idx_conv_stage ON conversions(stage);
CREATE INDEX idx_legality_state ON legality(state);
CREATE INDEX idx_offers_book ON offers(book_id);
CREATE INDEX idx_links_book ON links(book_id);

-- ---------------------------------------------------------------------------
-- events: high-intent sports windows to push around (NFL Sundays, UFC cards…)
-- ---------------------------------------------------------------------------
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sport       TEXT,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_date ON events(date);

-- ---------------------------------------------------------------------------
-- subscribers: owned audience opt-ins from the landing page
-- ---------------------------------------------------------------------------
CREATE TABLE subscribers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  state       TEXT,
  source      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- key/value settings (monthly goal, profile bio, etc.)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- prospects: the "who to ask" list before they become tracked referrals
CREATE TABLE prospects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  note        TEXT,
  book_id     TEXT,
  status      TEXT DEFAULT 'todo',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- articles: the content/blog layer — an indexable SEO surface (state-bonus
--   guides, how-tos, event previews) that links down into the referral funnel.
--   Public pages /blog and /blog/:slug are server-rendered for crawlers.
-- ---------------------------------------------------------------------------
CREATE TABLE articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  dek           TEXT,
  body          TEXT,
  tags          TEXT,
  cover_url     TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',
  published_at  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_articles_status ON articles(status, published_at);
