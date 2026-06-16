# 🎯 Betlink

Personal hub for your sportsbook / DFS / social-book **referral** links. Sends every visitor to the best app
*available in their state*, tracks clicks you own, and keeps a ledger of who converted and what you earned.

## What's built

1. **Smart geo-link** (`/smart`) — ONE link to share everywhere. Detects the visitor's US state (Cloudflare geo),
   picks the best book that is **legal + accepting signups + promo live**, ranked by your referral value, and 302s
   them there. Falls back gracefully if nothing's available. Add `?channel=tiktok` to attribute the source.
2. **Tracked links** (`/go/:slug`) — per-book, per-channel short links that log click + state + device + channel.
3. **Public landing page** (`/`) — state-aware "linktree": shows each visitor only the offers legal where they are,
   with bonuses for them and you, plus FTC disclosure + responsible-gambling notices.
4. **Dashboard** (`/admin`) — analytics (clicks by book/channel/state, funnel, earnings), edit books + offers,
   the **legality matrix** (state × book status / signups-working / promo-live), manage links, and a
   **conversions ledger** (signup → deposit → wager → bonus_posted → paid).

## Run it (local)

```sh
npm install
npm run db:init     # create tables (local SQLite)
npm run db:seed     # load your book list (bonuses + legality left BLANK on purpose)
npm run dev         # http://127.0.0.1:8787  → / (public)  and  /admin (dashboard)
```

## Deploy

```sh
npx wrangler login
npx wrangler d1 create betlink          # paste the printed database_id into wrangler.jsonc
npm run db:init:remote && npm run db:seed:remote
npm run deploy
```

**Lock the dashboard:** in Cloudflare Zero Trust → Access, add a self-hosted app policy for
`/admin*` and `/api/admin/*` restricted to your email. (The redirect + public routes stay open.)

## Data honesty

Bonus amounts and the legality matrix ship **blank / unverified** — they are not invented. Fill them from real
sources in the dashboard; every legality row stamps a `verified_at` date so you know what's confirmed vs stale.
Categories (DFS pick'em / social sportsbook / sweeps / prediction) are best-guess — confirm in Books & Offers.

## Roadmap / ideas not yet built

- **Gmail auto-sync** — read your own inbox for "your friend signed up" / "$X bonus" emails → auto-fill the
  conversions ledger (source=`gmail`, deduped by message id). Safer than storing sportsbook passwords.
- **Bonus EV calculator** — net value after playthrough/rollover, to rank "best real value" vs "best for me".
- **QR codes** per link for in-person sharing.
- **Edge Finder tie-in** — use this as top-of-funnel for the +EV app.
- **Stale-promo cron** — flag offers whose `verified_at` is older than N days.
