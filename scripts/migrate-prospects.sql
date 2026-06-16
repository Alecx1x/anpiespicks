-- "Who to ask" prospect list. Apply local + remote.
CREATE TABLE IF NOT EXISTS prospects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  note        TEXT,
  book_id     TEXT,                 -- which app you think fits them
  status      TEXT DEFAULT 'todo',  -- todo | sent | skip
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
