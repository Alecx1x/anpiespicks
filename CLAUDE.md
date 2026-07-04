# AnpiesPicks (betlink)

Personal sportsbook/DFS **referral-affiliate hub** — a geo-routed landing funnel, per-person referral
tracking, a transparent pick/track-record showcase, a link-in-bio page, and a private admin cockpit, all
in one Cloudflare Worker. Solo project. The owner is a **novice affiliate** (early days, few/no referrals
yet) — so bias toward **shipping the funnel and getting links out**, not over-building speculative systems.

- **Live:** https://join.anpieo7.workers.dev
- **Worker name:** `join` · **D1 db:** `betlink` (`40e1ae0c-6378-445c-8613-f2123edd381c`)
- **Identity rule:** keep the owner's real name **`alecnpierce` OUT of all public URLs / copy.** A friendlier
  custom domain is a future goal, but the `*.workers.dev` URL is what's shared today.

---

## 1. Mission & philosophy

Two intertwined money engines, both built on the **same audience**:

1. **Referrals (today's money):** "Sign up with my link and we BOTH get a bonus." Each person gets their own
   tracked link so the owner knows who converted and can follow up. This is refer-a-friend, which caps out —
   the "graduation" path is official **affiliate/CPA programs** (tracked per book in the Grow tab).
2. **Picks / track record (the long game):** publish every pick **before** the event with a timestamp, show
   **wins AND losses** (never delete losers), and back it with screenshots. That provable record builds trust,
   which grows the audience, which feeds referrals — and can later be monetized (premium picks / paywall).

Guiding bias: the hard part for a novice is **deciding who to ask and actually sending links**, so the cockpit
is built to remove that friction (prospect list → one-tap link+message → follow-up nudges).

---

## 2. Stack & architecture

- **Cloudflare Worker** — `src/index.ts`, a single file on **Hono v4**. No build step beyond `wrangler`.
- **TypeScript**, `compatibility_flags: ["nodejs_compat"]`, `compatibility_date: 2025-06-01`.
- **D1 (SQLite)** — binding `DB`, database `betlink`. All app state lives here.
- **Static assets** — everything in `./public` served via the `ASSETS` binding (Workers Assets).
- **Frontend** — NO framework. Each page is a **self-contained vanilla-JS SPA** in one `.html` file
  (inline `<style>` + inline `<script>`, talks to the JSON API). Shared look comes from copied CSS tokens,
  not a shared stylesheet.
- **Edge-finder** (the +EV model) is a **separate Python/Flask app** at `C:\Users\socia\edge-finder`. It is
  **NOT** merged into this Worker — it pushes picks over HTTP (see §12 Bridge). Keep the two decoupled;
  never import Python into the Worker.

### Repo layout
```
betlink/
  src/index.ts            # the entire Worker: routing, auth, API, redirects, helpers
  public/
    index.html            # /        public landing (geo-routed offers + email opt-in)
    record.html           # /record  public track record (stats, proofs, wins, bet log)
    me.html               # /me       public link-in-bio
    admin.html            # /admin    private cockpit (cookie-gated)
    quick.html            # /quick    private one-tap mobile bonus updater
    favicon.svg           # bright lime circle — PUBLIC pages
    favicon-admin.svg      # darker olive circle — PRIVATE pages (/admin, /quick)
    swirl.svg             # generated ambient background flow-field
  schema.sql              # full DDL (DROPs + CREATEs; local dev reset). Run via db:init
  seed.sql, populate.sql, populate.mjs, events-seed.sql, affiliate-urls.sql, my-referrals.sql
  migrate-*.sql           # one idempotent migration per feature (see §10)
  wrangler.jsonc          # worker config (name, D1 id, ASSETS, vars)
  package.json            # dev + per-feature db:<x> / db:<x>:remote scripts
  CLAUDE.md, README.md
```

### wrangler.jsonc bindings (ground truth)
- `DB` → D1 `betlink`
- `ASSETS` → `./public`
- `vars.DEFAULT_STATE = "OH"` (geo fallback when Cloudflare can't detect a region; override with `?state=XX`)
- `observability.enabled = true`

---

## 3. Auth model (two independent mechanisms)

### a) Cookie auth — `adminAuth` middleware
Gates `/admin`, `/quick`, and `/api/admin/*` (registered at `src/index.ts` ~L22-24).
- Login at **`GET/POST /login`**. A correct password sets cookie
  **`bl_auth = sha256hex('bl:' + ADMIN_PASSWORD)`**, `HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30d).
- `adminAuth` recomputes that hash and compares. On failure: `/api/*` → `401 JSON`, page routes → `302 /login`.
- **`localhost` / `127.0.0.1` bypasses auth entirely** (`isLocalHost`) — convenient for `wrangler dev`.
- **`isOwner(c)`** is the same cookie check, used to (1) hide premium pick details from the public and
  (2) **never count the owner's own clicks** in analytics (`logClick` early-returns for the owner).

### b) Token auth — for machine/phone callers (no cookie)
Gates the **public-reachable bridge endpoints**: `POST /api/picks/ingest` and the token path of
`/api/quick/bonus`. Checks **`QUICK_TOKEN`**, falling back to `ADMIN_PASSWORD` if `QUICK_TOKEN` is unset.

### Secrets (reference by NAME only — never commit values)
Set with `npx wrangler secret put <NAME>`; mirrored locally in `.dev.vars`:
- `ADMIN_PASSWORD` — login password + cookie hash seed + token fallback.
- `QUICK_TOKEN` — token for the iPhone "quick bonus" Shortcut and the edge-finder bridge.

> The live password/token values are known to the owner and are in the chat history / Cloudflare account —
> **do not write them into this repo or any committed file.**

---

## 4. Full route map (`src/index.ts`)

### Middleware / auth
- `app.use('/api/*', cors())`
- `app.use('/admin' | '/quick' | '/api/admin/*', adminAuth)`
- `GET /login`, `POST /login`

### Public redirects — "the money path"
- `GET /go/:slug` — a specific tracked link. Logs a click (async, non-blocking) → `302` to the real target
  (`links.target_url`, or inherits `books.referral_url` when blank). Per-person links live here.
- `GET /smart` — ONE link that **resolves at click time** to the best book available in the visitor's state
  (uses geo + legality + offer value ranking), logs the click, then `302`s. Supports `?channel=` attribution
  and `?state=XX` override. Renders an OG preview page for crawlers/bots instead of redirecting.

### Public JSON API
- `GET /api/geo` — `{state, country, city}` from Cloudflare `cf` props (or `DEFAULT_STATE`).
- `GET /api/offers?state=XX` — books legal & accepting signups in that state, ranked. Powers `/` and `/me`.
- `GET /api/picks` — public track record: `{record, picks}`. **Money columns are stripped**; premium pending
  picks are locked (`🔒`) unless the request is the owner. Profit is reported in **units**, never dollars.
- `GET /api/proofs` — social-proof screenshots. Returns ONLY `kind IN ('stat','win')` (never `inbox`).
- `GET /api/profile` — public display name / bio / socials (read from `settings`).
- `GET /img/:id` — serves an in-DB base64 image with `Cache-Control: public, max-age=31536000, immutable`.
- `POST /api/subscribe` — landing-page email opt-in → `subscribers`.
- `POST /api/picks/ingest` — **token-authed** edge-finder bridge (batch upsert by `source+ext_id`).
- `ALL /api/quick/bonus` — **token-authed** path for the iPhone Shortcut to update a bonus.

### Admin JSON API (all cookie-gated under `/api/admin/*`)
- **Books/offers:** `GET books`, `PUT books/:id`, `PUT offers/:bookId`, `PUT refurl/:id`, `PUT affiliate/:id`,
  `GET bonus-history`.
- **Links/referrals:** `POST links`, `DELETE links/:id`, `POST refer` (make a per-person link),
  `GET people`, `POST people/:linkId/stage` (advance funnel stage, optionally with $).
- **Prospects ("who to ask"):** `GET/POST prospects`, `PUT/DELETE prospects/:id`.
- **Legality:** `GET legality/:bookId`, `PUT legality` (per book×state row).
- **Events / audience / settings:** `GET/POST events`, `DELETE events/:id`, `GET subscribers`,
  `DELETE subscribers/:id`, `GET/PUT settings`.
- **Picks:** `GET/POST picks`, `PUT picks/:id` (grade win/loss/push, attach proof, edit), `DELETE picks/:id`.
- **Images & proofs:** `POST images` (store base64 → `/img/N`), `GET/POST proofs`,
  `PUT proofs/:id` (reassign `kind` and/or replace `image_url` — drag-to-sort + crop), `DELETE proofs/:id`.
- **Posts (planner):** `GET/POST posts`, `PUT/DELETE posts/:id`.
- **Promos (deposit-match log):** `GET/POST promos`, `PUT/DELETE promos/:id`.
- **Conversions ledger:** `GET/POST conversions`, `DELETE conversions/:id`.
- **Stats:** `GET stats` — KPI rollups (clicks, signups, earned, pending, monthly totals).
- **Quick bonus (cookie path):** `POST quick-bonus` (the `/quick` page uses this; no token needed in-browser).

### Page routes & fallback (bottom of file)
- `GET /admin | /quick | /record | /me` → `freshPage(c, '<file>.html')` — serves the asset but rewrites
  `Cache-Control` to `no-store, must-revalidate` so deploys land immediately (see §15 Caching).
- `app.all('*', ...)` → raw `ASSETS.fetch` (serves `/`, `index.html`, favicons, `swirl.svg`, etc.).

---

## 5. Pages in detail

### `/` (index.html) — landing funnel
Geo-detects the visitor, shows the best in-state offers as **bet-slip cards**, a signature `<select>`-in-the-headline
state picker, and an email opt-in near the bottom. CTA → `/smart`. Full sportsbook-ticket design (§14).

### `/record` (record.html) — the trust engine
Sections, all driven by `/api/picks` + `/api/proofs` + `/api/profile`:
- **Stat bar** — units, ROI, W-L(-pushes), win rate (computed server-side, units only).
- **📸 Verified across platforms** (`#proofs`) — `kind='stat'` screenshots, wide cards, full image (contain).
- **🔥 Recent wins** (`#wins`) — `kind='win'` screenshots **plus** graded `win` picks that have a proof image.
  **Max 2 per row** on every screen, uniform fixed-height frame (320px → 460px ≥620px), `object-fit:contain`
  so nothing is cropped, dark letterbox blend. **Click any image → in-page lightbox** (not a new tab).
- **📋 Full betting log** (`#list`) — every pick as a bet-slip row (All / Pending / Settled tabs). Proof
  thumbnails also open the lightbox.
- **Lightbox** (`#lb` + `zoom()/closeZoom()`): fills ~96vw/92vh, has a **✕ button**, closes on backdrop click
  or **Esc**, and **locks body scroll** while open.

### `/me` (me.html) — link-in-bio
Avatar, bio, socials, a primary "best offer" CTA → `/smart?channel=bio`, a per-state offer list, and a link to
`/record`. Editable from the admin **Grow** tab (writes to `settings`).

### `/admin` (admin.html) — the cockpit (cookie-gated)
A tabbed SPA. `loadBooks()` boots it; each tab has a `render<Tab>()` that fetches its slice and rebuilds the
section's `innerHTML`. Tabs:
- **Overview** — today's plays (follow-up nudges computed from click/stage recency), goal progress + payout
  projection, quick "refer someone" generator, smart-link copy, KPIs, getting-started checklist, novice playbook.
- **Books & Offers** — edit each book + its referral offer terms; recent bonus-change history.
- **Legality** — per book × 50-state grid: status / accepting-signups / promo-active / note.
- **Links** — set each book's real referral URL, build the smart link, add/track per-channel links.
- **People** — prospects ("who to ask"), one-tap link+message generator, and the referral pipeline (stages,
  clicks, earned).
- **Grow** — monthly goal, bio-link profile editor, content kit (event-tied captions), intent calendar
  (high-intent sports dates), owned audience list, affiliate-program tracker.
- **Plan** — Post Planner: platform-tailored drafts, schedule queue, one-tap open-with-prefilled-text.
- **Promos** — deposit-match offer log (match %, cap, duration, parlay/market restrictions).
- **Picks** — the track-record manager (see §11) **and** the **🖼️ Track-record images** tool (see §13),
  which is the FIRST card on the tab.
- **Conversions** — manual ledger of signup→deposit→…→paid with $ amounts.

### `/quick` (quick.html) — mobile bonus updater
A tiny single-purpose page (add to phone home screen) to update a book's "you get / friend gets" bonus in
seconds. Logs to `bonus_history`. Cookie-gated; uses `POST /api/admin/quick-bonus`.

---

## 6. Data model (16 tables — full DDL in `schema.sql`)

**Funnel core:** `books` (catalog of apps; `referral_url`, `affiliate_status`, `favorite`, `min_age`…),
`offers` (per-book bonus terms + numeric values for ranking), `links` (tracked `/go/:slug`, per channel/person),
`legality` (book × state: status, accepting_signups, promo_active), `clicks` (first-party analytics; IP is
**hashed**, never raw), `conversions` (the signup→deposit→wager→bonus_posted→paid ledger), `events`
(high-intent dates), `subscribers` (owned email list), `prospects` (who-to-ask list), `settings` (k/v: profile
fields, monthly_goal).

**Picks / record / social:** `picks` (the track record — see §11), `proofs` (screenshots; `kind` column added
by migration — see §10/§13), `images` (in-DB base64 uploads served at `/img/:id`), `posts` (Post Planner),
`promos` (deposit-match log), `bonus_history` (every offer-terms change, manual or via Shortcut).

Notes:
- **There is no separate `profile` table** — profile/bio/socials live in `settings` and surface via `/api/profile`.
- `proofs.kind` is **not** in `schema.sql`; it comes from `migrate-proof-kind.sql` (`ALTER TABLE … ADD COLUMN
  kind TEXT DEFAULT 'stat'`). Values: **`inbox`** (uploaded, unsorted, private), **`stat`** (Profile stats →
  "Verified across platforms"), **`win`** (Recent wins).

---

## 7. The money path (clicks → conversions)

1. Owner sets each book's **referral URL** (Links tab) and per-person links (`POST /api/admin/refer`).
2. A visitor hits `/go/:slug` or `/smart` → `logClick` writes a `clicks` row (state/device/channel/hashed-IP),
   **skipping the owner's own visits**, then `302`s to the real book.
3. `/smart` resolves the destination live from geo + `legality` (legal & accepting signups) + offer value.
4. As people progress, the owner advances their **stage** (People tab → `people/:linkId/stage`) or logs a
   row in the **Conversions** ledger with the $ amount. Overview turns stale stages into follow-up nudges.

---

## 8. Picks & track record

- **Units, not dollars, in public.** 1 unit = 1% bankroll. `/api/picks` and `/record` show units/ROI only.
  Dollar columns (`wager`, `profit_cash`, `payout`) are **admin-only** and must never appear on a public endpoint.
- **Logged before the event** (`posted_at`) — the timestamp is the credibility. **Never delete losers.**
- **Grading:** `PUT /api/admin/picks/:id` sets `status` win/loss/push/void; profit is computed from odds × stake.
  The server's `computeRecord()` rolls up W-L, units, ROI, win rate.
- **Premium locking:** picks with `visibility='premium'` that are still `pending` are masked (`🔒`) for everyone
  except the owner. (No paywall yet — see Roadmap.)
- **Source:** `manual` (added in /admin) or `edge-finder` (pushed by the bridge, deduped on `source+ext_id`).

---

## 9. Images & the cropper subsystem

- **No R2 on this account** (Cloudflare error 10042). Images are stored **in D1 as base64** in `images` and
  served by `GET /img/:id` (immutable 1-year cache). Always **compress client-side** (canvas → JPEG dataURL,
  capped ~900KB) before `POST /api/admin/images`.
- **Proofs buckets** (`proofs.kind`): uploads land in **`inbox`** (private), then the owner sorts them into
  **`stat`** or **`win`** by drag-and-drop or the 📊/🔥 buttons. `PUT /api/admin/proofs/:id {kind}` re-files.
- **Editing already-uploaded images** (admin Picks → 🖼️ Track-record images, ✏️ on each tile): an in-page
  modal supporting **crop** (drag box + corner handles, pointer events so touch works), **rotate L/R** (re-renders
  through a canvas to a fresh data-URL), and **replace** (swap the file). Save renders to canvas → uploads a new
  `/img/N` → `PUT proofs/:id {image_url}` repoints the tile **in place** (keeps its bucket).
- **Orphaned images are expected & harmless:** crop/rotate/replace create a new `images` row and repoint; the
  old row stays (there's no R2/GC). Don't build cleanup unless asked.

---

## 10. Migrations & seeds

`schema.sql` is a **destructive reset** (DROP+CREATE) for local dev only. Production schema is built up by
**idempotent per-feature migrations**, each with a `db:<x>` (local) and `db:<x>:remote` (production) npm script.

Migrations present: `migrate-bonus-history`, `migrate-picks`, `migrate-picks-cash`, `migrate-picks-proof`,
`migrate-planner`, `migrate-promos`, `migrate-proofs`, `migrate-proof-kind`, `migrate-grow`,
`migrate-prospects`, `migrate-settings`, `migrate-articles` (the blog/content table — idempotent). Seeds/data: `seed.sql`, `populate.sql`(+`populate.mjs`),
`events-seed.sql`, `affiliate-urls.sql`, `my-referrals.sql`.

> **`migrate-proof-kind.sql` is NOT idempotent** — SQLite has no `ADD COLUMN IF NOT EXISTS`. Run it **once**
> per DB; re-running errors with `duplicate column name: kind` (harmless). Most other migrations are
> `CREATE TABLE IF NOT EXISTS` and safe to re-run.

**Adding a new feature table:** write `migrate-<x>.sql` → add `db:<x>` + `db:<x>:remote` to `package.json`
→ run both → `wrangler deploy`. Mirror columns in `schema.sql` too, so a fresh `db:init` matches prod.

---

## 11. Deploy & migrate workflow

The machine's primary shell is **PowerShell**; a **Bash** tool is also available. In the Bash tool the cwd
**resets to `C:\Users\socia` every call**, so always `cd` first:
```bash
cd /c/Users/socia/betlink && npx wrangler deploy
```
Migrations (run BOTH the local and the `:remote` so production actually gets the table):
```bash
cd /c/Users/socia/betlink && npm run db:proofkind          # local D1
cd /c/Users/socia/betlink && npm run db:proofkind:remote   # production D1
```

---

## 12. Bridge (edge-finder → site)

`C:\Users\socia\edge-finder\push_to_anpiespicks.py` reads `bets_log.json`, converts $ stake → **units**, and
`POST`s to `/api/picks/ingest` with the `QUICK_TOKEN`. The two apps stay decoupled — do not import Python into
the Worker, and don't merge the model in.

---

## 13. Verification workflow (how to test changes safely)

Verified end-to-end with **Python Playwright** (chromium available) against the live Worker, authing by
**setting the `bl_auth` cookie** = `sha256hex('bl:' + ADMIN_PASSWORD)` on the browser context. Pattern that
works well:
1. Seed test data via `ctx.request.post(...)` (carries the cookie) — e.g. create an image + a proof/pick.
2. Drive the page (click, evaluate `openCrop(...)`, `saveCrop()`, etc.), assert on DOM state / API results.
3. **Always clean up** seeded rows (`DELETE`) so the public `/record` isn't polluted with test data.

Also useful: hit the live API with `curl` + the cookie to assert behavior, then delete.

---

## 14. Design system (public pages: `/`, `/record`, `/me`)

Shared **"sportsbook-ticket"** identity. Keep new public pages consistent (CSS tokens are copied per file).
- **Palette:** ink `#0E1411`, board `#121A16`, slip `#19231D`, slip-2 `#202D26`, line `#2A382F`,
  chalk `#ECF1ED`, muted `#8C988F`; accents **turf-green `#33B96A`** (go/available/win), **teal `#2DD1C4`**
  (odds/secondary), **stamp vermilion `#E4572E`** (hot promo / loss), **amber `#E8A93C`** (pending).
  Aliases `--good/--bad/--warn/--blue` map to these so inline-generated class names stay styled.
- **Type (Google Fonts):** `Anton` (display — wordmark, big headlines, stat figures; used sparingly),
  `Hanken Grotesk` (body), `Spline Sans Mono` (odds, eyebrows, ticket meta, fine print).
- **Ambient layer:** every public page has `<div class="ambient">` = 4 blurred color `.glow`s + a `.swirls`
  div backed by **`/swirl.svg`** (a generated Catmull-Rom flow-field with an internal radial fade-mask, so it
  fades through the center column and text stays readable). `body::before` adds a top floodlight wash.
  All `prefers-reduced-motion`-safe.
- **Texture motif:** offers/picks render as **bet-slips** — colored left tear-spine + dashed perforation,
  mono tabular figures, `YOU GET + I GET` split, rotated rubber-stamp for live promos.
- **Galleries on `/record`:** `#wins` = 2-per-row, uniform fixed height, `object-fit:contain` (full image,
  never cropped), click → lightbox. `#proofs` = wide cards, full image. Bet-log thumbs also open the lightbox.
- **Favicons:** **`/favicon.svg`** = bright lime circle on public pages; **`/favicon-admin.svg`** = darker
  olive circle on `/admin` + `/quick`, so the owner can tell private vs public tabs apart at a glance.
- `/admin` + `/quick` are private cockpit tools on a separate (blue/dark) utility theme — intentionally NOT
  restyled to the ticket look.

---

## 15. Caching

- **HTML pages** (`/admin`, `/quick`, `/record`, `/me`) go through `freshPage()` which sets
  `Cache-Control: no-store, must-revalidate` so deploys land without a hard refresh. **Caveat:** Cloudflare
  Workers Assets may normalize asset-sourced responses back to `public, max-age=0, must-revalidate` — that
  still forces revalidation, so it's fine. Phone **home-screen PWAs cache hardest**; if a stale page persists,
  load **`?v=N`** (any new query string) to force a fresh copy.
- **`/img/:id`** is immutable (`max-age=31536000`) — safe because every upload is a new id (crop/replace
  repoint to a new `/img/N`).
- **Favicons** cache aggressively in browsers; expect to close/reopen the tab to see a change.

---

## 16. Gotchas (these have actually bitten us)

- **Bash cwd resets** to `C:\Users\socia` each call → prefix wrangler/npm with `cd /c/Users/socia/betlink &&`.
- **`wrangler` OAuth login expires mid-session** (whoami → "not authenticated", or a UV_HANDLE crash). Fix:
  ask the owner to run `! npx wrangler login` in the prompt (interactive — can't be done from a tool).
- **HEAD vs GET:** the page routes are `app.get(...)`, so a `curl -I` (HEAD) **skips them** and falls through
  to the `ASSETS` catch-all, showing the wrong/old `Cache-Control`. Verify headers with a real GET (`curl -D -`).
- **Multi-statement SQL over `--remote`** occasionally throws a transient `fetch failed` — just retry.
- **`ALTER TABLE ADD COLUMN` is not idempotent** in SQLite → run such migrations once (see §10).
- **Corrupt test images decode to `naturalWidth = 0`** — when writing Playwright tests, use a known-good
  base64 PNG (a hand-fabricated one may silently fail to decode and make the cropper look broken).
- **No R2** (error 10042) — always use the base64/D1 image path; don't reach for R2.
- **Stale tab confusion:** after a deploy, the owner may be viewing a cached page or simply not scrolled to a
  new section. The `?v=N` trick + a visible version marker resolve "I refreshed but it's still old."

---

## 17. Working style & guardrails for this project

- **End every reply with the relevant live link** (owner's standing preference).
- **Money is private** — never expose `picks.wager/profit_cash/payout` on any public endpoint or page.
- **Keep `alecnpierce` out of public URLs/copy.**
- **Do not log into sportsbook accounts** or do anything against a book's TOS.
- **Verify before claiming done** — deploy, then prove it live (curl/Playwright with the auth cookie), then
  clean up any seeded test data.

---

## 18. Content & SEO layer (the discovery surface)

A bare referral hub has no organic discovery — so there's a **server-rendered, crawlable** content layer
that links *down* into the funnel. All of it is rendered in the Worker (NOT the JS SPAs) so Google indexes
real HTML, via the shared `siteShell()` helper.

> **Distinct neutral brand (by owner request 2026-06-22):** the guide pages deliberately do NOT look like the
> AnpiesPicks hub — they run under their own brand **`StateLine`** (constants `BRAND` / `BRAND_TAG` near
> `SITE_URL` in index.ts — rename in one place) with a **light "comparison-site" theme** (white/slate, Inter,
> blue `--brand:#1D4ED8`, comparison TABLE, "★ Top pick" badge), its own favicon **`/favicon-guide.svg`**
> (blue line-mark), neutral publication copy ("we track…", "Claim bonus →"), and an **"Advertising
> disclosure"** footer in third-person. AnpiesPicks appears only as a small "a project by AnpiesPicks"
> byline. Goal: read as an independent resource, not a personal referral funnel — while staying FTC-compliant
> (the disclosure is mandatory; never remove it). The dark bet-slip identity (§14) is the HUB only (`/`,
> `/record`, `/me`); the guide is a separate visual system living entirely inside `siteShell()`.

- **`/bonuses` and `/bonuses/:state`** — the **state-by-state bonus comparison tool** (the "magnet").
  `renderBonusesPage()` queries books legal & accepting signups in that state, ranked, and renders bet-slip
  cards with the new-user bonus, any active deposit-match promo, and a Claim button → `/smart?book=…&channel=bonuses&state=XX`.
  A `<select>` + a 51-link state grid navigate to other states (each its own indexable URL → ~51 pages
  targeting "[state] sportsbook bonuses"). `/bonuses` (no param) uses the visitor's geo state; an unknown
  state 302s to `/bonuses`. Emits `ItemList` JSON-LD. Claim/CTA links carry `rel="nofollow sponsored"`.
- **`/blog` and `/blog/:slug`** — the content engine. Articles live in the **`articles`** table
  (`migrate-articles.sql`; `db:articles[:remote]`). `/blog` lists published posts; `/blog/:slug` renders one
  (only `status='published'`; drafts 404 publicly) with `BlogPosting` JSON-LD and a CTA strip to `/bonuses`
  + the smart link. Body is authored in **lightweight markdown** (`mdToHtml()`: `##/###/####` headings,
  `**bold**`, `*em*`, `-`/`1.` lists, `>` quotes, paragraphs — HTML-escaped first, owner-authored).
- **`/sitemap.xml`** (`/`, `/bonuses`, `/record`, `/me`, `/blog`, all 51 `/bonuses/:state`, every published
  `/blog/:slug`) and **`/robots.txt`** (allows all, disallows `/admin`,`/quick`,`/login`,`/api/`, points at
  the sitemap). All three content routes set `Cache-Control: public, max-age=300` (sitemap 3600).
- **Authoring:** admin **Content** tab (`renderContent()` in admin.html) — list + editor (title, auto-slug,
  dek/meta-description, markdown body, tags, status, optional cover via `uploadCover()`→`/img/N`). CRUD at
  `/api/admin/articles` (`GET` list, `GET/:id`, `POST`, `PUT/:id`, `DELETE/:id`). `published_at` is stamped
  on first publish and preserved across edits/unpublish. `uniqueSlug()` de-dupes slugs.
- **Internal linking:** `index.html` and `record.html` got a footer nav row linking `/bonuses` + `/blog`
  (+ `/record`/home) so link equity flows between the SPA pages and the server-rendered ones.

> Strategy context (why this exists): the owner asked how to make the site profitable beyond hand-sharing
> links. The plan = lean on the owner's build skill (the comparison tool + Edge-finder are the unfair
> advantage), layer slow-burn SEO content (narrow, state-specific, buyer-intent), and seed a community to
> convert trust. SEO is a 6–12 month game; sports-betting is hyper-competitive, so target long-tail, not
> head terms. Keep `rel="nofollow sponsored"` on all referral links.

### Tabled until the owner explicitly asks
Embedded AI "Coach" (separate Anthropic billing), AI/OCR auto-fill of bet fields, Stripe paywall for premium
picks, R2 upgrade, custom domain.
