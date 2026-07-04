import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  DEFAULT_STATE: string;
  ADMIN_PASSWORD?: string;
  QUICK_TOKEN?: string; // token for the iPhone quick-update Shortcut (falls back to ADMIN_PASSWORD)
};

// pull a numeric dollar value out of bonus text, e.g. "$50 bonus" -> 50
function dollarVal(s: any): number | null {
  const m = String(s ?? '').match(/\$?\s*([\d,]+(?:\.\d+)?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

const app = new Hono<{ Bindings: Env }>();
app.use('/api/*', cors());

// ---- admin auth: protects /admin + /api/admin/* (skipped on localhost) ----
app.use('/admin', adminAuth);
app.use('/quick', adminAuth);
app.use('/api/admin/*', adminAuth);
app.get('/login', (c) => c.html(loginPage()));
app.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const pw = String(form.password || '');
  if (pw && pw === c.env.ADMIN_PASSWORD) {
    const token = await sha256hex('bl:' + pw);
    return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': `bl_auth=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` } });
  }
  return c.html(loginPage('Incorrect password'), 401);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
type Geo = { state: string; country: string; city: string };

function getGeo(c: any): Geo {
  const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined;
  const override = c.req.query('state');
  const state = (override || (cf?.regionCode as string) || c.env.DEFAULT_STATE || 'OH').toUpperCase();
  return {
    state,
    country: (cf?.country as string) || 'US',
    city: (cf?.city as string) || '',
  };
}

function detectDevice(ua: string): string {
  const s = ua.toLowerCase();
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobi|android|iphone/.test(s)) return 'mobile';
  return 'desktop';
}

function isLocalHost(c: any): boolean {
  const h = c.req.header('host') || '';
  return h.startsWith('localhost') || h.startsWith('127.0.0.1');
}
async function sha256hex(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function getCookie(c: any, name: string): string | null {
  const m = (c.req.header('cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
async function adminAuth(c: any, next: any) {
  if (isLocalHost(c)) return next();
  const pw = c.env.ADMIN_PASSWORD;
  if (!pw) return c.text('Admin is locked. Set the password: npx wrangler secret put ADMIN_PASSWORD', 503);
  if (getCookie(c, 'bl_auth') === (await sha256hex('bl:' + pw))) return next();
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'unauthorized' }, 401);
  return c.redirect('/login', 302);
}
function loginPage(err?: string): string {
  return `<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><title>AnpiesPicks login</title>
  <style>body{font-family:system-ui;background:#0b1020;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0}
  form{background:#151b30;border:1px solid #243049;padding:2rem;border-radius:1rem;width:280px}
  input{width:100%;padding:.6rem;margin:.6rem 0;border-radius:.5rem;border:1px solid #243049;background:#0e1426;color:#e5e7eb;box-sizing:border-box}
  button{width:100%;padding:.6rem;border:0;border-radius:.5rem;background:#2563eb;color:#fff;font-weight:600;cursor:pointer}
  .e{color:#ef4444;font-size:.85rem}</style>
  <form method=post action=/login><h2>🎯 AnpiesPicks</h2>${err ? `<div class=e>${err}</div>` : ''}
  <input type=password name=password placeholder=Password autofocus><button>Enter</button></form>`;
}
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode('betlink-salt:' + ip);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// True when the request comes from the logged-in owner's browser (carries the admin cookie).
async function isOwner(c: any): Promise<boolean> {
  const pw = c.env.ADMIN_PASSWORD;
  if (!pw) return false;
  return getCookie(c, 'bl_auth') === (await sha256hex('bl:' + pw));
}

async function logClick(c: any, row: Record<string, any>) {
  if (await isOwner(c)) return; // never count your own clicks
  const ip = c.req.header('cf-connecting-ip') || '0.0.0.0';
  const ua = c.req.header('user-agent') || '';
  const geo = getGeo(c);
  const stmt = c.env.DB.prepare(
    `INSERT INTO clicks (book_id, link_id, slug, channel, state, country, city, device, referer, ua, ip_hash, smart)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    row.book_id ?? null,
    row.link_id ?? null,
    row.slug ?? null,
    row.channel ?? null,
    geo.state,
    geo.country,
    geo.city,
    detectDevice(ua),
    c.req.header('referer') || null,
    ua.slice(0, 300),
    await hashIp(ip),
    row.smart ? 1 : 0
  );
  // don't block the redirect on the write
  c.executionCtx.waitUntil(stmt.run());
}

// ---------------------------------------------------------------------------
// REDIRECTS  (the money path)
// ---------------------------------------------------------------------------

// /go/:slug — a specific tracked link. Logs the click, then 302s to the real URL.
app.get('/go/:slug', async (c) => {
  const slug = c.req.param('slug');
  const link = await c.env.DB.prepare(
    `SELECT l.id, l.book_id, l.channel, l.target_url, b.referral_url
       FROM links l JOIN books b ON b.id = l.book_id
      WHERE l.slug=? AND l.active=1`
  ).bind(slug).first<any>();
  if (!link) return c.notFound();
  const target = (link.target_url && link.target_url.trim()) || link.referral_url;
  // Unfurlers (iMessage/Discord/etc.) get a clean preview card instead of a raw redirect.
  if (isCrawler(c.req.header('user-agent') || '')) {
    const bk = await c.env.DB.prepare(`SELECT b.name, o.referee_bonus FROM books b LEFT JOIN offers o ON o.book_id=b.id AND o.active=1 WHERE b.id=?`).bind(link.book_id).first<any>();
    const bonus = bk?.referee_bonus && !/tbd|unverified|verify/i.test(bk.referee_bonus) ? bk.referee_bonus : 'a sign-up bonus';
    return c.html(ogPage(`Join me on ${bk?.name || 'this app'} 🎯`, `Sign up with my link and we both get a bonus — you get ${bonus}. Free to join, 21+ (18+ where allowed).`, c.req.url, target || ''));
  }
  await logClick(c, { book_id: link.book_id, link_id: link.id, slug, channel: link.channel });
  if (!target) return c.html(fallbackPage(getGeo(c).state), 200);
  return c.redirect(target, 302);
});

// /smart — ONE link to share everywhere. Detects state, sends to the best legal+working book.
// Optional ?channel=tiktok to attribute, ?state=XX to test, ?book=slug to force.
app.get('/smart', async (c) => {
  const geo = getGeo(c);
  const channel = c.req.query('channel') || 'smart';
  const forced = c.req.query('book');

  // Unfurlers get a branded preview card (the smart link routes per-state, so keep it generic).
  if (isCrawler(c.req.header('user-agent') || '')) {
    return c.html(ogPage('Get a free sign-up bonus 🎯', "I use these apps for sports picks — sign up with my link and we both get a bonus. Tap to grab the best one for your state. 21+ (18+ where allowed).", c.req.url));
  }

  const pick = await c.env.DB.prepare(
    `SELECT b.id AS book_id
       FROM books b
       JOIN legality lg ON lg.book_id = b.id AND lg.state = ?
       LEFT JOIN offers o ON o.book_id = b.id AND o.active = 1
      WHERE b.active = 1
        AND ( (? IS NOT NULL AND b.id = ?)
              OR (lg.status='legal' AND lg.accepting_signups=1 AND b.referral_url IS NOT NULL AND b.referral_url <> '') )
      ORDER BY (b.id = COALESCE(?, '')) DESC, lg.promo_active DESC, COALESCE(o.referrer_value,0) DESC
      LIMIT 1`
  ).bind(geo.state, forced ?? null, forced ?? null, forced ?? null).first<any>();

  if (!pick) {
    // Nothing available in this state — show a graceful fallback page.
    await logClick(c, { slug: 'smart', channel, smart: 1, book_id: null });
    return c.html(fallbackPage(geo.state), 200);
  }

  // Pick the best link for the chosen book: channel match > direct > any active.
  // Falls back to the book's single referral_url when no per-link override exists.
  const link = await c.env.DB.prepare(
    `SELECT l.id, l.target_url, l.channel, b.referral_url
       FROM books b LEFT JOIN links l ON l.book_id=b.id AND l.active=1
      WHERE b.id=?
      ORDER BY (l.channel=?) DESC, (l.channel='direct') DESC
      LIMIT 1`
  ).bind(pick.book_id, channel).first<any>();

  const target = (link?.target_url && link.target_url.trim()) || link?.referral_url;
  await logClick(c, { book_id: pick.book_id, link_id: link?.id ?? null, slug: 'smart', channel, smart: 1 });
  if (!target) return c.html(fallbackPage(geo.state), 200);
  return c.redirect(target, 302);
});

function fallbackPage(state: string): string {
  return `<!doctype html><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  <title>Nothing available yet</title>
  <style>body{font-family:system-ui;background:#0b1020;color:#e5e7eb;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:1rem}
  a{color:#60a5fa}</style>
  <div><h1>No active offer in ${state} yet 🫤</h1>
  <p>None of the apps are currently signing up new users in your state with a live promo.<br>Check back soon.</p>
  <p><a href="/">See everything →</a></p></div>`;
}

// ---- link-preview (Open Graph) for crawlers/unfurlers ----
function isCrawler(ua: string): boolean {
  return /facebookexternalhit|facebot|twitterbot|slackbot|discordbot|whatsapp|linkedinbot|telegrambot|googlebot|bingbot|redditbot|pinterest|skypeuripreview|vkShare|embedly|quora link preview|applebot|ia_archiver|snapchat/i.test(ua);
}
function escAttr(s: string): string { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function ogPage(title: string, desc: string, shareUrl: string, target?: string): string {
  return `<!doctype html><html><head><meta charset="utf8">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(shareUrl)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="AnpiesPicks">
<meta property="og:image" content="https://join.anpieo7.workers.dev/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://join.anpieo7.workers.dev/og.png">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
<title>${escAttr(title)}</title>${target ? `\n<meta http-equiv="refresh" content="0;url=${escAttr(target)}">` : ''}
</head><body style="font-family:system-ui;background:#0b1020;color:#e5e7eb;text-align:center;padding:3rem">
<h1>${escAttr(title)}</h1><p>${escAttr(desc)}</p>${target ? `<p><a style="color:#60a5fa" href="${escAttr(target)}">Continue →</a></p>` : ''}
</body></html>`;
}

// ---------------------------------------------------------------------------
// PUBLIC API (used by the landing page)
// ---------------------------------------------------------------------------

app.get('/api/geo', (c) => c.json(getGeo(c)));

// Parse a free-text promo duration ("24 hours", "3 days", "48 hrs") into an end
// timestamp measured from when it was logged. Returns ISO, or null if not parseable.
function promoExpiry(createdAt: any, duration: any): string | null {
  if (!createdAt || !duration) return null;
  const s = String(duration).toLowerCase();
  let ms = 0;
  const days = s.match(/(\d+(?:\.\d+)?)\s*(days?|d)\b/);         if (days) ms += parseFloat(days[1]) * 86400e3;
  const hrs  = s.match(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/);    if (hrs)  ms += parseFloat(hrs[1]) * 3600e3;
  const mins = s.match(/(\d+(?:\.\d+)?)\s*(minutes?|mins?)\b/);   if (mins) ms += parseFloat(mins[1]) * 60e3;
  if (ms <= 0) return null;
  const start = new Date(String(createdAt).replace(' ', 'T') + 'Z'); // SQLite datetime('now') is UTC
  if (isNaN(start.getTime())) return null;
  return new Date(start.getTime() + ms).toISOString();
}

// Best offers for the visitor's (or ?state=) state, ranked.
app.get('/api/offers', async (c) => {
  const geo = getGeo(c);
  const rows = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.category, b.blurb, b.color, b.min_age, b.favorite,
            o.referrer_bonus, o.referee_bonus, o.required_action, o.referrer_value, o.referee_value, o.promo_expires,
            lg.status, lg.accepting_signups, lg.promo_active, lg.product_note, lg.verified_at AS legal_verified
       FROM books b
       LEFT JOIN offers o   ON o.book_id = b.id AND o.active = 1
       LEFT JOIN legality lg ON lg.book_id = b.id AND lg.state = ?
      WHERE b.active = 1 AND b.referral_url IS NOT NULL AND b.referral_url <> ''
      ORDER BY (lg.status='legal' AND lg.accepting_signups=1) DESC,
               lg.promo_active DESC, COALESCE(o.referrer_value,0) DESC, b.favorite DESC, b.name`
  ).bind(geo.state).all();
  const offers = rows.results as any[];
  // attach the latest ACTIVE deposit-match promo per book (logged in the Promos tab)
  const proms = (await c.env.DB.prepare(
    `SELECT book_id, match_pct, max_amount, duration, must_parlay, parlay_legs, restriction, created_at FROM promos WHERE active=1 ORDER BY id DESC`
  ).all()).results as any[];
  const byBook: Record<string, any> = {};
  for (const p of proms) if (!byBook[p.book_id]) byBook[p.book_id] = p; // highest id (latest) wins
  for (const o of offers) {
    const m = byBook[o.id];
    o.match = m ? {
      pct: m.match_pct, max: m.max_amount, duration: m.duration,
      parlay: m.must_parlay ? (m.parlay_legs || true) : 0, restriction: m.restriction,
      expires_at: promoExpiry(m.created_at, m.duration),
    } : null;
  }
  return c.json({ state: geo.state, offers });
});

// ---------------------------------------------------------------------------
// QUICK UPDATE — for the iPhone Shortcut. Token-authed (NOT cookie), so it works
// from a Shortcut. Update a book's bonus in one tap when you see it change.
//   POST/GET /api/quick/bonus  token=... book=rebet them="$50" you="$50" [note=...]
//   - `book` matches the slug exactly, else a fuzzy name/slug match.
//   - send `them`/`you` (or referee_bonus/referrer_bonus); omit one to leave it as-is.
//   - $ values for ranking are parsed from the text automatically unless given.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PICKS — transparent, auto-graded track record (public) + admin CRUD + model ingest
// ---------------------------------------------------------------------------
// profit in UNITS for one settled pick, from american odds
function pickProfit(p: any): number {
  const stake = Number(p.stake) || 0;
  if (p.status === 'win') return p.odds > 0 ? stake * (p.odds / 100) : stake * (100 / Math.abs(p.odds || 100));
  if (p.status === 'loss') return -stake;
  return 0; // push | void | pending
}
function computeRecord(rows: any[]) {
  let wins = 0, losses = 0, pushes = 0, pending = 0, units = 0, risked = 0;
  for (const p of rows) {
    if (p.status === 'pending') { pending++; continue; }
    if (p.status === 'void') continue;
    if (p.status === 'win') wins++; else if (p.status === 'loss') losses++; else if (p.status === 'push') pushes++;
    units += pickProfit(p);
    if (p.status !== 'push') risked += Number(p.stake) || 0;
  }
  const decided = wins + losses;
  return {
    wins, losses, pushes, pending, settled: wins + losses + pushes,
    units: Math.round(units * 100) / 100,
    roi: risked > 0 ? Math.round((units / risked) * 1000) / 10 : 0,
    winrate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : 0,
  };
}
function mapResult(r: any): string {
  if (r == null || r === '') return 'pending';
  const s = String(r).toLowerCase();
  if (['win', 'won', 'w', 'true', '1'].includes(s)) return 'win';
  if (['loss', 'lost', 'lose', 'l', 'false', '0'].includes(s)) return 'loss';
  if (['push', 'tie', 'draw'].includes(s)) return 'push';
  if (s === 'void') return 'void';
  return 'pending';
}
// accepts our native pick shape OR the edge-finder bets_log shape
function mapEdgePick(it: any) {
  const edgeShape = it.bet_name || it.name_a;
  const event = it.event || (edgeShape && it.name_a && it.name_b ? `${it.name_a} vs ${it.name_b}` : it.event);
  return {
    sport: it.sport ?? null, league: it.league ?? null,
    event: event ?? '', selection: it.selection ?? it.bet_name ?? '',
    market: it.market ?? (edgeShape ? 'h2h' : null),
    odds: it.odds ?? it.bet_odds ?? null,
    model_prob: it.model_prob ?? null, edge: it.edge ?? null,
    stake: it.stake ?? 1, book: it.book ?? null, analysis: it.analysis ?? null,
    status: mapResult(it.status ?? it.result), visibility: it.visibility ?? 'free',
    proof_url: it.proof_url ?? null,
    ext_id: it.ext_id != null ? String(it.ext_id) : (it.id != null ? String(it.id) : null),
    event_at: it.event_at ?? null, posted_at: it.posted_at ?? it.logged_at ?? null,
  };
}

// PUBLIC track record (selection details hidden for premium pending picks unless owner)
app.get('/api/picks', async (c) => {
  const all = (await c.env.DB.prepare(
    `SELECT * FROM picks ORDER BY (status='pending') DESC, COALESCE(settled_at, posted_at) DESC, id DESC LIMIT 200`
  ).all()).results as any[];
  const record = computeRecord(all);
  const owner = await isOwner(c);
  const picks = all.map((p) => {
    const locked = p.visibility === 'premium' && !owner && p.status === 'pending';
    return {
      id: p.id, sport: p.sport, league: p.league, market: p.market,
      event: locked ? '🔒 Premium pick' : p.event,
      selection: locked ? '🔒 Unlock to view' : p.selection,
      odds: locked ? null : p.odds, analysis: locked ? null : p.analysis,
      model_prob: locked ? null : p.model_prob, edge: locked ? null : p.edge,
      stake: p.stake, status: p.status, visibility: p.visibility,
      proof_url: locked ? null : p.proof_url,
      profit: (p.status === 'win' || p.status === 'loss') ? Math.round(pickProfit(p) * 100) / 100 : (p.status === 'push' ? 0 : null),
      posted_at: p.posted_at, event_at: p.event_at, settled_at: p.settled_at, locked,
    };
  });
  return c.json({ record, picks });
});

// IMAGE serving — in-DB uploads, public read (used when R2 isn't enabled)
app.get('/img/:id', async (c) => {
  const row = await c.env.DB.prepare(`SELECT mime, data FROM images WHERE id=?`).bind(c.req.param('id')).first<any>();
  if (!row) return c.notFound();
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, { headers: { 'content-type': row.mime || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
});

// PUBLIC cross-platform proof wall
app.get('/api/proofs', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT id, label, image_url, caption, kind FROM proofs WHERE kind IN ('stat','win') ORDER BY sort, id`).all()).results;
  return c.json({ proofs: rows });
});

// MODEL INGEST — edge-finder bridge pushes picks here (token-authed, not cookie)
app.post('/api/picks/ingest', async (c) => {
  const secret = c.env.QUICK_TOKEN || c.env.ADMIN_PASSWORD;
  if (!secret) return c.json({ ok: false, error: 'server not configured' }, 503);
  const body = await c.req.json().catch(() => ({} as any));
  const token = body.token || c.req.query('token') || c.req.header('x-token');
  if (token !== secret) return c.json({ ok: false, error: 'bad token' }, 401);
  const items: any[] = Array.isArray(body.picks) ? body.picks : Array.isArray(body) ? body : [body.pick].filter(Boolean);
  let added = 0, updated = 0, skipped = 0;
  for (const raw of items) {
    const m = mapEdgePick(raw || {});
    if (!m.event || !m.selection) { skipped++; continue; }
    const existing = m.ext_id ? await c.env.DB.prepare(`SELECT id FROM picks WHERE source='edge-finder' AND ext_id=?`).bind(m.ext_id).first<any>() : null;
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE picks SET status=?, odds=?, model_prob=?, edge=?, stake=?,
           settled_at=CASE WHEN ?='pending' THEN NULL ELSE COALESCE(settled_at, datetime('now')) END WHERE id=?`
      ).bind(m.status, m.odds, m.model_prob, m.edge, m.stake, m.status, existing.id).run();
      updated++;
    } else {
      await c.env.DB.prepare(
        `INSERT INTO picks (sport,league,event,selection,market,odds,model_prob,edge,stake,book,analysis,proof_url,status,visibility,source,ext_id,event_at,posted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'edge-finder',?,?, COALESCE(?, datetime('now')))`
      ).bind(m.sport, m.league, m.event, m.selection, m.market, m.odds, m.model_prob, m.edge, m.stake, m.book, m.analysis,
             m.proof_url, m.status, m.visibility, m.ext_id, m.event_at, m.posted_at).run();
      added++;
    }
  }
  return c.json({ ok: true, added, updated, skipped });
});

// Shared bonus-update logic. Returns { status, body } so both the token-authed
// Shortcut endpoint and the cookie-authed web-page endpoint can reuse it.
async function applyBonusUpdate(c: any, a: { book?: any; them?: any; you?: any; them_val?: any; you_val?: any; source?: string; note?: any; }) {
  const bookQ = String(a.book || '').trim().toLowerCase();
  if (!bookQ) return { status: 400, body: { ok: false, error: 'book required' } };
  let book = await c.env.DB.prepare(`SELECT id, name FROM books WHERE id=?`).bind(bookQ).first<any>();
  if (!book) {
    const like = '%' + bookQ.replace(/[^a-z0-9]+/g, '%') + '%';
    book = await c.env.DB.prepare(`SELECT id, name FROM books WHERE lower(name) LIKE ? OR id LIKE ? ORDER BY favorite DESC LIMIT 1`).bind(like, like).first<any>();
  }
  if (!book) return { status: 404, body: { ok: false, error: `no book matches "${bookQ}"` } };

  const hasThem = a.them !== undefined && a.them !== null && String(a.them) !== '';
  const hasYou = a.you !== undefined && a.you !== null && String(a.you) !== '';
  if (!hasThem && !hasYou) return { status: 400, body: { ok: false, error: 'send them= and/or you= bonus' } };

  const cur = (await c.env.DB.prepare(`SELECT * FROM offers WHERE book_id=? AND active=1`).bind(book.id).first<any>()) || {};
  const prev = { you: cur.referrer_bonus ?? null, them: cur.referee_bonus ?? null };

  const refeBonus = hasThem ? String(a.them) : (cur.referee_bonus ?? null);
  const refBonus = hasYou ? String(a.you) : (cur.referrer_bonus ?? null);
  const themVal = (a.them_val !== undefined && a.them_val !== null && a.them_val !== '') ? parseFloat(a.them_val)
    : (hasThem ? (dollarVal(a.them) ?? cur.referee_value ?? 0) : (cur.referee_value ?? 0));
  const refVal = (a.you_val !== undefined && a.you_val !== null && a.you_val !== '') ? parseFloat(a.you_val)
    : (hasYou ? (dollarVal(a.you) ?? cur.referrer_value ?? 0) : (cur.referrer_value ?? 0));

  if (cur.id) {
    await c.env.DB.prepare(
      `UPDATE offers SET referrer_bonus=?, referrer_value=?, referee_bonus=?, referee_value=?, verified_at=date('now') WHERE id=?`
    ).bind(refBonus, refVal, refeBonus, themVal, cur.id).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO offers (book_id, referrer_bonus, referrer_value, referee_bonus, referee_value, verified_at, active)
       VALUES (?,?,?,?,?, date('now'), 1)`
    ).bind(book.id, refBonus, refVal, refeBonus, themVal).run();
  }
  await recordBonusHistory(c, book.id, refBonus, refeBonus, refVal, themVal, a.source || 'manual', a.note ?? null);

  const msg = `${book.name} updated → you: ${refBonus || '—'}, friend: ${refeBonus || '—'}`;
  return { status: 200, body: { ok: true, book: book.id, name: book.name, previous: prev, now: { you: refBonus, them: refeBonus }, message: msg } };
}

app.all('/api/quick/bonus', async (c) => {
  const q = c.req.query();
  let body: Record<string, any> = {};
  if (c.req.method !== 'GET') body = await c.req.json().catch(() => ({}));
  const p = (...keys: string[]) => {
    for (const k of keys) {
      if (q[k] != null && q[k] !== '') return q[k];
      if (body[k] != null && body[k] !== '') return body[k];
    }
    return undefined;
  };
  const secret = c.env.QUICK_TOKEN || c.env.ADMIN_PASSWORD;
  if (!secret) return c.json({ ok: false, error: 'server not configured (set ADMIN_PASSWORD or QUICK_TOKEN)' }, 503);
  if (p('token') !== secret) return c.json({ ok: false, error: 'bad token' }, 401);
  const r = await applyBonusUpdate(c, {
    book: p('book', 'book_id', 'app'), them: p('them', 'referee_bonus', 'friend'), you: p('you', 'referrer_bonus', 'me'),
    them_val: p('them_val', 'referee_value'), you_val: p('you_val', 'referrer_value'), source: 'shortcut', note: p('note'),
  });
  return c.json(r.body, r.status as any);
});

// ---------------------------------------------------------------------------
// ADMIN API (lock behind Cloudflare Access in production)
// ---------------------------------------------------------------------------

app.get('/api/admin/books', async (c) => {
  const books = await c.env.DB.prepare(`SELECT * FROM books ORDER BY favorite DESC, name`).all();
  const offers = await c.env.DB.prepare(`SELECT * FROM offers WHERE active=1`).all();
  const links = await c.env.DB.prepare(`SELECT * FROM links ORDER BY book_id, channel`).all();
  return c.json({ books: books.results, offers: offers.results, links: links.results });
});

app.put('/api/admin/books/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json();
  await c.env.DB.prepare(
    `UPDATE books SET name=?, category=?, blurb=?, notes=?, website=?, color=?, min_age=?, active=?, favorite=? WHERE id=?`
  ).bind(b.name, b.category, b.blurb ?? null, b.notes ?? null, b.website ?? null, b.color ?? '#3b82f6',
         b.min_age ?? 18, b.active ? 1 : 0, b.favorite ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.put('/api/admin/offers/:bookId', async (c) => {
  const bookId = c.req.param('bookId');
  const o = await c.req.json();
  // upsert the active offer for this book
  const existing = await c.env.DB.prepare(`SELECT id FROM offers WHERE book_id=? AND active=1`).bind(bookId).first<any>();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE offers SET referrer_bonus=?, referrer_value=?, referee_bonus=?, referee_value=?,
        required_action=?, required_deposit=?, playthrough=?, est_ev=?, promo_expires=?, terms_url=?, verified_at=? WHERE id=?`
    ).bind(o.referrer_bonus, o.referrer_value ?? 0, o.referee_bonus, o.referee_value ?? 0,
           o.required_action, o.required_deposit ?? 0, o.playthrough ?? null, o.est_ev ?? null,
           o.promo_expires ?? null, o.terms_url ?? null, o.verified_at ?? null, existing.id).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO offers (book_id, referrer_bonus, referrer_value, referee_bonus, referee_value, required_action, required_deposit, playthrough, est_ev, promo_expires, terms_url, verified_at, active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`
    ).bind(bookId, o.referrer_bonus, o.referrer_value ?? 0, o.referee_bonus, o.referee_value ?? 0,
           o.required_action, o.required_deposit ?? 0, o.playthrough ?? null, o.est_ev ?? null,
           o.promo_expires ?? null, o.terms_url ?? null, o.verified_at ?? null).run();
  }
  await recordBonusHistory(c, bookId, o.referrer_bonus, o.referee_bonus, o.referrer_value ?? 0, o.referee_value ?? 0, 'manual', null);
  return c.json({ ok: true });
});

// append a snapshot of an offer's bonus terms to bonus_history (best-effort, never blocks)
async function recordBonusHistory(c: any, bookId: string, refBonus: any, refeBonus: any, refVal: any, refeVal: any, source: string, note: any) {
  try {
    await c.env.DB.prepare(
      `INSERT INTO bonus_history (book_id, referrer_bonus, referee_bonus, referrer_value, referee_value, source, note)
       VALUES (?,?,?,?,?,?,?)`
    ).bind(bookId, refBonus ?? null, refeBonus ?? null, refVal ?? null, refeVal ?? null, source, note ?? null).run();
  } catch { /* table may not exist on un-migrated DBs; ignore */ }
}

// links CRUD
app.post('/api/admin/links', async (c) => {
  const l = await c.req.json();
  await c.env.DB.prepare(
    `INSERT INTO links (book_id, slug, channel, target_url, label) VALUES (?,?,?,?,?)
     ON CONFLICT(slug) DO UPDATE SET book_id=excluded.book_id, channel=excluded.channel, target_url=excluded.target_url, label=excluded.label`
  ).bind(l.book_id, l.slug, l.channel ?? 'direct', l.target_url, l.label ?? null).run();
  return c.json({ ok: true });
});

app.delete('/api/admin/links/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM links WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// set a book's single real referral URL (everything inherits this)
app.put('/api/admin/refurl/:id', async (c) => {
  const { referral_url } = await c.req.json();
  await c.env.DB.prepare(`UPDATE books SET referral_url=? WHERE id=?`).bind(referral_url || null, c.req.param('id')).run();
  return c.json({ ok: true });
});

// PER-PERSON LINKS: mint a unique slug for one person that 302s to the book's referral_url.
// The app only gave you one code, but each person hits a different slug -> per-person attribution.
app.post('/api/admin/refer', async (c) => {
  const { book_id, person } = await c.req.json();
  if (!book_id || !person) return c.json({ error: 'book_id + person required' }, 400);
  const base = (book_id + '-' + person).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  let slug = base, n = 0;
  while (await c.env.DB.prepare(`SELECT 1 FROM links WHERE slug=?`).bind(slug).first()) { n++; slug = base + '-' + n; }
  await c.env.DB.prepare(
    `INSERT INTO links (book_id, slug, channel, target_url, label, person) VALUES (?,?, 'person', '', ?, ?)`
  ).bind(book_id, slug, person, person).run();
  return c.json({ ok: true, slug });
});

// the people pipeline: each per-person link + its clicks + latest stage + earned
app.get('/api/admin/people', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT l.id AS link_id, l.slug, l.person, l.book_id, b.name AS book_name, l.created_at,
        (SELECT COUNT(*) FROM clicks WHERE link_id=l.id) AS clicks,
        (SELECT MAX(ts) FROM clicks WHERE link_id=l.id) AS last_click,
        (SELECT stage FROM conversions WHERE link_id=l.id ORDER BY id DESC LIMIT 1) AS stage,
        (SELECT created_at FROM conversions WHERE link_id=l.id ORDER BY id DESC LIMIT 1) AS last_conv_at,
        (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE link_id=l.id AND stage IN ('bonus_posted','paid')) AS earned
       FROM links l JOIN books b ON b.id=l.book_id
      WHERE l.person IS NOT NULL
      ORDER BY l.id DESC`
  ).all();
  return c.json({ people: rows.results });
});

// ---- intent events (high-intent sports windows) ----
app.get('/api/admin/events', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM events WHERE date >= date('now','-1 day') ORDER BY date`).all();
  return c.json({ events: rows.results });
});
app.post('/api/admin/events', async (c) => {
  const e = await c.req.json();
  if (!e.date || !e.name) return c.json({ error: 'date + name required' }, 400);
  await c.env.DB.prepare(`INSERT INTO events (date, name, sport, note) VALUES (?,?,?,?)`)
    .bind(e.date, e.name, e.sport ?? null, e.note ?? null).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/events/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM events WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- audience: public opt-in + admin list ----
app.post('/api/subscribe', async (c) => {
  const s = await c.req.json().catch(() => ({}));
  const email = String(s.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.json({ error: 'valid email required' }, 400);
  await c.env.DB.prepare(`INSERT INTO subscribers (email, state, source) VALUES (?,?,?)`)
    .bind(email, (s.state || getGeo(c).state), s.source || 'landing').run();
  return c.json({ ok: true });
});
app.get('/api/admin/subscribers', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM subscribers ORDER BY id DESC`).all();
  return c.json({ subscribers: rows.results });
});
app.delete('/api/admin/subscribers/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM subscribers WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- affiliate-program graduation tracker ----
app.put('/api/admin/affiliate/:id', async (c) => {
  const a = await c.req.json();
  await c.env.DB.prepare(`UPDATE books SET affiliate_url=?, affiliate_status=? WHERE id=?`)
    .bind(a.affiliate_url || null, a.affiliate_status || 'none', c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- settings (key/value: monthly_goal, etc.) ----
app.get('/api/admin/settings', async (c) => {
  const r = await c.env.DB.prepare(`SELECT key, value FROM settings`).all();
  const o: Record<string, string> = {};
  (r.results || []).forEach((x: any) => { o[x.key] = x.value; });
  return c.json(o);
});
app.put('/api/admin/settings', async (c) => {
  const b = await c.req.json();
  for (const k of Object.keys(b)) {
    await c.env.DB.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
      .bind(k, String(b[k])).run();
  }
  return c.json({ ok: true });
});

// ---- prospects ("who to ask" list) ----
app.get('/api/admin/prospects', async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM prospects ORDER BY (status='todo') DESC, id DESC`).all();
  return c.json({ prospects: r.results });
});
app.post('/api/admin/prospects', async (c) => {
  const p = await c.req.json();
  if (!p.name) return c.json({ error: 'name required' }, 400);
  await c.env.DB.prepare(`INSERT INTO prospects (name, note, book_id) VALUES (?,?,?)`)
    .bind(p.name, p.note ?? null, p.book_id ?? null).run();
  return c.json({ ok: true });
});
app.put('/api/admin/prospects/:id', async (c) => {
  const p = await c.req.json();
  await c.env.DB.prepare(`UPDATE prospects SET status=COALESCE(?,status), note=COALESCE(?,note), book_id=COALESCE(?,book_id) WHERE id=?`)
    .bind(p.status ?? null, p.note ?? null, p.book_id ?? null, c.req.param('id')).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/prospects/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM prospects WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- public profile (for the personal bio-link page) ----
app.get('/api/profile', async (c) => {
  const r = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('display_name','bio','twitter','instagram','tiktok')`).all();
  const o: Record<string, string> = {};
  (r.results || []).forEach((x: any) => { o[x.key] = x.value; });
  return c.json(o);
});

// advance a person to a funnel stage (logs a conversion event tied to their link)
app.post('/api/admin/people/:linkId/stage', async (c) => {
  const linkId = c.req.param('linkId');
  const { stage, amount } = await c.req.json();
  if (!stage) return c.json({ ok: true });
  const link = await c.env.DB.prepare(`SELECT book_id, person FROM links WHERE id=?`).bind(linkId).first<any>();
  if (!link) return c.json({ error: 'no link' }, 404);
  await c.env.DB.prepare(
    `INSERT INTO conversions (book_id, link_id, channel, stage, amount, person_label, source) VALUES (?,?, 'person', ?,?,?, 'person')`
  ).bind(link.book_id, linkId, stage, amount ?? 0, link.person).run();
  return c.json({ ok: true });
});

// bonus change history (most recent first; optional ?book_id= filter)
app.get('/api/admin/bonus-history', async (c) => {
  const bookId = c.req.query('book_id');
  const sql = `SELECT h.*, b.name AS book_name FROM bonus_history h JOIN books b ON b.id=h.book_id
               ${bookId ? 'WHERE h.book_id=?' : ''}
               ORDER BY h.id DESC LIMIT 100`;
  const stmt = bookId ? c.env.DB.prepare(sql).bind(bookId) : c.env.DB.prepare(sql);
  const rows = await stmt.all();
  return c.json({ history: rows.results });
});

// ---- picks admin CRUD ----
app.get('/api/admin/picks', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT * FROM picks ORDER BY id DESC LIMIT 500`).all()).results as any[];
  return c.json({ picks: rows, record: computeRecord(rows) });
});
app.post('/api/admin/picks', async (c) => {
  const p = await c.req.json();
  if (!p.event || !p.selection) return c.json({ error: 'event + selection required' }, 400);
  await c.env.DB.prepare(
    `INSERT INTO picks (sport,league,event,selection,market,odds,model_prob,edge,stake,wager,profit_cash,payout,book,analysis,proof_url,status,visibility,source,event_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'manual', ?)`
  ).bind(p.sport ?? null, p.league ?? null, p.event, p.selection, p.market ?? null, p.odds ?? null, p.model_prob ?? null,
         p.edge ?? null, p.stake ?? 1, p.wager ?? null, p.profit_cash ?? null, p.payout ?? null, p.book ?? null, p.analysis ?? null, p.proof_url ?? null, p.status || 'pending', p.visibility || 'free', p.event_at ?? null).run();
  return c.json({ ok: true });
});
app.put('/api/admin/picks/:id', async (c) => {
  const p = await c.req.json();
  const settledClause = p.status === 'pending' ? `, settled_at=NULL`
    : (p.status ? `, settled_at=COALESCE(settled_at, datetime('now'))` : ``);
  await c.env.DB.prepare(
    `UPDATE picks SET sport=COALESCE(?,sport), league=COALESCE(?,league), event=COALESCE(?,event), selection=COALESCE(?,selection),
       market=COALESCE(?,market), odds=COALESCE(?,odds), stake=COALESCE(?,stake), wager=COALESCE(?,wager), profit_cash=COALESCE(?,profit_cash),
       payout=COALESCE(?,payout), book=COALESCE(?,book), analysis=COALESCE(?,analysis),
       proof_url=COALESCE(?,proof_url), status=COALESCE(?,status), visibility=COALESCE(?,visibility), event_at=COALESCE(?,event_at)${settledClause} WHERE id=?`
  ).bind(p.sport ?? null, p.league ?? null, p.event ?? null, p.selection ?? null, p.market ?? null, p.odds ?? null,
         p.stake ?? null, p.wager ?? null, p.profit_cash ?? null, p.payout ?? null, p.book ?? null, p.analysis ?? null, p.proof_url ?? null, p.status ?? null, p.visibility ?? null, p.event_at ?? null,
         c.req.param('id')).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/picks/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM picks WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- image upload (cookie-authed): store a browser-compressed image, return its /img URL ----
app.post('/api/admin/images', async (c) => {
  const b = await c.req.json().catch(() => ({} as any));
  let data = String(b.data || '');
  let mime = b.mime || 'image/jpeg';
  const m = /^data:([^;]+);base64,(.*)$/s.exec(data);
  if (m) { mime = m[1]; data = m[2]; }
  if (!data) return c.json({ error: 'no image data' }, 400);
  if (data.length > 1_600_000) return c.json({ error: 'image too large — pick a smaller one' }, 413);
  const res = await c.env.DB.prepare(`INSERT INTO images (mime, data) VALUES (?,?)`).bind(mime, data).run();
  return c.json({ ok: true, url: '/img/' + res.meta.last_row_id });
});

// ---- post planner CRUD ----
app.get('/api/admin/posts', async (c) => {
  const rows = (await c.env.DB.prepare(
    `SELECT * FROM posts ORDER BY (status='posted'), COALESCE(scheduled_for, created_at), id`
  ).all()).results;
  return c.json({ posts: rows });
});
app.post('/api/admin/posts', async (c) => {
  const p = await c.req.json();
  await c.env.DB.prepare(
    `INSERT INTO posts (platform,title,body,link,image_url,event_id,scheduled_for,status,channel)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(p.platform || 'x', p.title ?? null, p.body ?? null, p.link ?? null, p.image_url ?? null,
         p.event_id ?? null, p.scheduled_for ?? null, p.status || 'scheduled', p.channel ?? null).run();
  return c.json({ ok: true });
});
app.put('/api/admin/posts/:id', async (c) => {
  const p = await c.req.json();
  const postedClause = p.status === 'posted' ? `, posted_at=COALESCE(posted_at, datetime('now'))`
    : (p.status ? `, posted_at=NULL` : ``);
  await c.env.DB.prepare(
    `UPDATE posts SET platform=COALESCE(?,platform), title=COALESCE(?,title), body=COALESCE(?,body),
       link=COALESCE(?,link), image_url=COALESCE(?,image_url), scheduled_for=COALESCE(?,scheduled_for),
       status=COALESCE(?,status), channel=COALESCE(?,channel)${postedClause} WHERE id=?`
  ).bind(p.platform ?? null, p.title ?? null, p.body ?? null, p.link ?? null, p.image_url ?? null,
         p.scheduled_for ?? null, p.status ?? null, p.channel ?? null, c.req.param('id')).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/posts/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM posts WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- promos CRUD (deposit-match offer log) ----
app.get('/api/admin/promos', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT * FROM promos ORDER BY active DESC, id DESC`).all()).results;
  return c.json({ promos: rows });
});
app.post('/api/admin/promos', async (c) => {
  const p = await c.req.json();
  await c.env.DB.prepare(
    `INSERT INTO promos (book_id, match_pct, max_amount, duration, must_parlay, parlay_legs, restriction, notes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(p.book_id ?? null, p.match_pct ?? null, p.max_amount ?? null, p.duration ?? null,
         p.must_parlay ? 1 : 0, p.parlay_legs ?? null, p.restriction ?? null, p.notes ?? null).run();
  return c.json({ ok: true });
});
app.put('/api/admin/promos/:id', async (c) => {
  const p = await c.req.json();
  await c.env.DB.prepare(`UPDATE promos SET active=COALESCE(?,active) WHERE id=?`)
    .bind(p.active == null ? null : (p.active ? 1 : 0), c.req.param('id')).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/promos/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM promos WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---- proofs admin CRUD (cross-platform stat screenshots) ----
app.get('/api/admin/proofs', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT * FROM proofs ORDER BY sort, id`).all()).results;
  return c.json({ proofs: rows });
});
const PROOF_KINDS = ['inbox', 'stat', 'win'];
app.post('/api/admin/proofs', async (c) => {
  const p = await c.req.json();
  if (!p.image_url) return c.json({ error: 'image_url required' }, 400);
  const kind = PROOF_KINDS.includes(p.kind) ? p.kind : 'inbox';
  await c.env.DB.prepare(`INSERT INTO proofs (label, image_url, caption, kind, sort) VALUES (?,?,?,?,?)`)
    .bind(p.label ?? null, p.image_url, p.caption ?? null, kind, p.sort ?? 0).run();
  return c.json({ ok: true });
});
// update a screenshot: reassign bucket (drag-to-sort) and/or replace image (crop)
app.put('/api/admin/proofs/:id', async (c) => {
  const p = await c.req.json().catch(() => ({} as any));
  const sets: string[] = [], vals: any[] = [];
  if (p.kind !== undefined) {
    if (!PROOF_KINDS.includes(p.kind)) return c.json({ error: 'bad kind' }, 400);
    sets.push('kind=?'); vals.push(p.kind);
  }
  if (p.image_url !== undefined) {
    if (!p.image_url) return c.json({ error: 'image_url required' }, 400);
    sets.push('image_url=?'); vals.push(p.image_url);
  }
  if (!sets.length) return c.json({ error: 'nothing to update' }, 400);
  vals.push(c.req.param('id'));
  await c.env.DB.prepare(`UPDATE proofs SET ${sets.join(', ')} WHERE id=?`).bind(...vals).run();
  return c.json({ ok: true });
});
app.delete('/api/admin/proofs/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM proofs WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// quick bonus update from the /quick web page (cookie-authed — no token needed in the page)
app.post('/api/admin/quick-bonus', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await applyBonusUpdate(c, { book: b.book, them: b.them, you: b.you, them_val: b.them_val, you_val: b.you_val, source: 'web', note: b.note });
  return c.json(r.body, r.status as any);
});

// legality matrix
app.get('/api/admin/legality/:bookId', async (c) => {
  const rows = await c.env.DB.prepare(`SELECT * FROM legality WHERE book_id=? ORDER BY state`).bind(c.req.param('bookId')).all();
  return c.json({ legality: rows.results });
});

app.put('/api/admin/legality', async (c) => {
  const r = await c.req.json();
  await c.env.DB.prepare(
    `INSERT INTO legality (book_id, state, status, accepting_signups, promo_active, product_note, source_url, verified_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(book_id,state) DO UPDATE SET status=excluded.status, accepting_signups=excluded.accepting_signups,
       promo_active=excluded.promo_active, product_note=excluded.product_note, source_url=excluded.source_url, verified_at=excluded.verified_at`
  ).bind(r.book_id, (r.state || '').toUpperCase(), r.status ?? 'unknown', r.accepting_signups ? 1 : 0,
         r.promo_active ? 1 : 0, r.product_note ?? null, r.source_url ?? null, r.verified_at ?? null).run();
  return c.json({ ok: true });
});

// conversions / earnings
app.get('/api/admin/conversions', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT cv.*, b.name AS book_name FROM conversions cv JOIN books b ON b.id=cv.book_id ORDER BY cv.occurred_on DESC, cv.id DESC LIMIT 500`
  ).all();
  return c.json({ conversions: rows.results });
});

app.post('/api/admin/conversions', async (c) => {
  const v = await c.req.json();
  await c.env.DB.prepare(
    `INSERT INTO conversions (book_id, link_id, channel, stage, amount, person_label, source, occurred_on, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(v.book_id, v.link_id ?? null, v.channel ?? null, v.stage ?? 'signup', v.amount ?? 0,
         v.person_label ?? null, v.source ?? 'manual', v.occurred_on ?? new Date().toISOString().slice(0, 10), v.notes ?? null).run();
  return c.json({ ok: true });
});

app.delete('/api/admin/conversions/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM conversions WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// analytics dashboard
app.get('/api/admin/stats', async (c) => {
  const byBook = await c.env.DB.prepare(
    `SELECT b.id, b.name, b.color,
       (SELECT COUNT(*) FROM clicks WHERE book_id=b.id) AS clicks,
       (SELECT COUNT(*) FROM conversions WHERE book_id=b.id AND stage='signup') AS signups,
       (SELECT COUNT(*) FROM conversions WHERE book_id=b.id AND stage='bonus_posted') AS bonuses,
       (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE book_id=b.id AND stage IN ('bonus_posted','paid')) AS earned,
       (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE book_id=b.id AND stage='paid') AS paid
     FROM books b WHERE b.active=1 ORDER BY earned DESC, clicks DESC`
  ).all();
  const byChannel = await c.env.DB.prepare(
    `SELECT COALESCE(channel,'?') AS channel, COUNT(*) AS clicks FROM clicks GROUP BY channel ORDER BY clicks DESC`
  ).all();
  const byState = await c.env.DB.prepare(
    `SELECT COALESCE(state,'?') AS state, COUNT(*) AS clicks FROM clicks GROUP BY state ORDER BY clicks DESC LIMIT 15`
  ).all();
  const funnel = await c.env.DB.prepare(
    `SELECT stage, COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM conversions GROUP BY stage`
  ).all();
  const totals = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM clicks) AS clicks,
            (SELECT COUNT(*) FROM conversions WHERE stage='signup') AS signups,
            (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE stage IN ('bonus_posted','paid')) AS earned,
            (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE stage='bonus_posted') AS pending,
            (SELECT COALESCE(SUM(amount),0) FROM conversions WHERE stage IN ('bonus_posted','paid') AND occurred_on >= date('now','start of month')) AS earned_month`
  ).first();
  return c.json({ byBook: byBook.results, byChannel: byChannel.results, byState: byState.results, funnel: funnel.results, totals });
});

// ---------------------------------------------------------------------------
// CONTENT & SEO LAYER — server-rendered, crawlable pages that link into the
//   funnel: a state-by-state bonus comparison tool (/bonuses/:state) and a
//   blog (/blog, /blog/:slug). Plus sitemap.xml + robots.txt. All rendered in
//   the Worker (not the JS SPAs) so Google indexes real HTML.
// ---------------------------------------------------------------------------
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'Washington D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
  ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const ALL_STATES = Object.keys(STATE_NAMES);
const CAT_LABEL: Record<string, string> = {
  dfs_pickem: "DFS pick'em", social_sportsbook: 'Social sportsbook', sweeps_casino: 'Sweeps casino',
  prediction_market: 'Prediction market', sportsbook: 'Sportsbook', fantasy: 'Daily fantasy',
};
const SITE_URL = 'https://join.anpieo7.workers.dev';
// The content/guide pages run under their own neutral brand so they read as an
// independent comparison resource, not a personal referral funnel. Rename here.
const BRAND = 'StateLine';
const BRAND_TAG = 'Sportsbook & pick’em bonuses, state by state';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthYear(): string { const d = new Date(); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }

// Escape text destined for HTML body content.
function escHtml(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function slugify(s: string): string {
  return String(s || '').toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
}

// Tiny, safe markdown → HTML for article bodies (owner-authored). Escapes first.
function mdToHtml(src: string): string {
  const inline = (t: string) => escHtml(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => `<a href="${escAttr(url)}">${txt}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const blocks = String(src || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out: string[] = [];
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    const lines = b.split('\n');
    if (/^#{2,4}\s/.test(b)) { const h = b.match(/^#+/)![0].length; out.push(`<h${h}>${inline(b.replace(/^#+\s*/, ''))}</h${h}>`); continue; }
    if (lines.every((l) => /^[-*]\s+/.test(l))) { out.push('<ul>' + lines.map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('') + '</ul>'); continue; }
    if (lines.every((l) => /^\d+[.)]\s+/.test(l))) { out.push('<ol>' + lines.map((l) => `<li>${inline(l.replace(/^\d+[.)]\s+/, ''))}</li>`).join('') + '</ol>'); continue; }
    if (lines.every((l) => /^>\s?/.test(l))) { out.push(`<blockquote>${inline(b.replace(/^>\s?/gm, ''))}</blockquote>`); continue; }
    out.push(`<p>${inline(b).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n');
}

// Shared shell for the server-rendered guide pages. Intentionally a LIGHT,
// neutral "comparison-site" identity (its own brand, NOT the dark bet-slip hub),
// so /bonuses + /blog read as an independent resource. AnpiesPicks is downplayed
// to a footer byline + the required affiliate disclosure.
function siteShell(o: { title: string; desc: string; canonical: string; body: string; active?: string; jsonLd?: string; ogImage?: string }): string {
  const nav = [['/bonuses', 'Bonuses'], ['/blog', 'Guides']]
    .map(([href, label]) => `<a href="${href}"${o.active === href ? ' class="on"' : ''}>${label}</a>`).join('');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escAttr(o.title)}</title>
<meta name="description" content="${escAttr(o.desc)}">
<link rel="canonical" href="${escAttr(o.canonical)}">
<meta property="og:title" content="${escAttr(o.title)}">
<meta property="og:description" content="${escAttr(o.desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${escAttr(BRAND)}">
<meta property="og:url" content="${escAttr(o.canonical)}">
<meta property="og:image" content="${escAttr(o.ogImage || SITE_URL + '/og.png')}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escAttr(o.ogImage || SITE_URL + '/og.png')}">
<link rel="icon" type="image/svg+xml" href="/favicon-guide.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
${o.jsonLd ? `<script type="application/ld+json">${o.jsonLd}</script>` : ''}
<style>
:root{--bg:#F5F7FB;--bg2:#EDF1F7;--card:#FFFFFF;--bd:#E2E8F1;--bd2:#CDD7E5;--ink:#0F1B2E;--txt:#2A3647;--mut:#637085;--brand:#1D4ED8;--brand-d:#1740AE;--brandwash:#EAF0FE;--green:#0E9E6E;--star:#E8941A;--r:14px;--font:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font);font-size:17px;line-height:1.5;background:var(--bg);color:var(--txt);-webkit-font-smoothing:antialiased}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.bar{height:4px;background:linear-gradient(90deg,var(--brand),#5B8DEF 60%,#7DD3FC)}
.topnav{background:var(--card);border-bottom:1px solid var(--bd)}
.topnav .in{max-width:960px;margin:0 auto;padding:.8rem 1.1rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap}
.topnav .brand{display:flex;align-items:center;gap:.5rem;font-weight:800;font-size:1.18rem;letter-spacing:-.02em;color:var(--ink)}
.topnav .brand .mk{width:26px;height:26px;border-radius:7px;background:var(--brand);display:inline-grid;place-items:center}
.topnav .brand .mk svg{width:17px;height:17px;display:block}
.topnav nav{margin-left:auto;display:flex;gap:.2rem;flex-wrap:wrap}
.topnav nav a{color:var(--mut);font-weight:600;font-size:.92rem;padding:.4rem .8rem;border-radius:8px}
.topnav nav a.on,.topnav nav a:hover{color:var(--brand);background:var(--brandwash);text-decoration:none}
.wrap{max-width:960px;margin:0 auto;padding:1.8rem 1.1rem 3rem}
h1{font-weight:800;letter-spacing:-.025em;font-size:clamp(1.9rem,5vw,2.7rem);line-height:1.08;margin:.3rem 0 .5rem;color:var(--ink)}
.eyebrow{font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);font-weight:700;margin:0}
.lede{color:var(--mut);font-size:1.08rem;line-height:1.62;margin:.3rem 0 1.5rem;max-width:720px}
.statepick{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 1.3rem;font-size:.9rem;color:var(--mut);font-weight:600}
select{background:var(--card);color:var(--ink);border:1px solid var(--bd2);border-radius:9px;padding:.5rem .7rem;font-family:inherit;font-size:.95rem;font-weight:600;cursor:pointer}
/* ---- comparison table ---- */
.cmp{width:100%;border-collapse:separate;border-spacing:0;background:var(--card);border:1px solid var(--bd);border-radius:var(--r);overflow:hidden;box-shadow:0 1px 2px rgba(15,27,46,.04),0 10px 30px -22px rgba(15,27,46,.25)}
.cmp thead th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--mut);font-weight:700;text-align:left;padding:.75rem 1.1rem;background:var(--bg2);border-bottom:1px solid var(--bd)}
.cmp td{padding:1rem 1.1rem;border-bottom:1px solid var(--bd);vertical-align:middle}
.cmp tbody tr:last-child td{border-bottom:0}
.cmp tr.top td{background:var(--brandwash)}
.app{display:flex;align-items:center;gap:.7rem}
.app .rk{flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--bg2);color:var(--mut);font-weight:800;font-size:.85rem;display:grid;place-items:center}
.app .an{font-weight:700;color:var(--ink);font-size:1.05rem;line-height:1.2}
.app .an small{display:block;font-weight:500;color:var(--mut);font-size:.76rem;margin-top:.1rem}
.pin{display:inline-block;font-size:.68rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:var(--brand-d);background:#fff;border:1px solid var(--brand);border-radius:6px;padding:.1rem .4rem;margin-bottom:.3rem}
.bn{font-weight:800;color:var(--green);font-size:1.08rem;line-height:1.2}
.match{display:inline-block;font-size:.78rem;font-weight:700;color:#8A5A00;background:#FFF3DB;border:1px solid #F2D49A;border-radius:6px;padding:.12rem .45rem;margin-top:.35rem}
.terms{color:var(--mut);font-size:.85rem;margin-top:.3rem;line-height:1.45;max-width:34ch}
td.ca{text-align:right;white-space:nowrap}
.claim{display:inline-block;background:var(--brand);color:#fff;font-weight:700;font-size:.95rem;padding:.6rem 1.05rem;border-radius:9px;box-shadow:0 8px 18px -10px rgba(29,78,216,.6)}
.claim:hover{background:var(--brand-d);text-decoration:none}
.note{background:var(--card);border:1px solid var(--bd);border-radius:var(--r);padding:1rem 1.1rem;color:var(--mut);margin:.7rem 0}
.subhead{font-weight:800;color:var(--ink);font-size:1.05rem;margin:2rem 0 .5rem;letter-spacing:-.01em}
.statelist{display:flex;flex-wrap:wrap;gap:.35rem;margin:.5rem 0 0}
.statelist a{font-size:.78rem;font-weight:600;color:var(--mut);background:var(--card);border:1px solid var(--bd);border-radius:7px;padding:.22rem .5rem}
.statelist a:hover{border-color:var(--brand);color:var(--brand);text-decoration:none}
.statelist a.on{color:#fff;background:var(--brand);border-color:var(--brand)}
.cta-strip{background:var(--brandwash);border:1px solid #C7D7FB;border-radius:var(--r);padding:1.2rem 1.3rem;margin:1.8rem 0;color:var(--txt)}
.cta-strip a.go{display:inline-block;margin-top:.6rem;background:var(--brand);color:#fff;font-weight:700;padding:.6rem 1.1rem;border-radius:9px}
.cta-strip a.go:hover{background:var(--brand-d);text-decoration:none}
.cta-strip a.go.alt{background:#fff;color:var(--brand);border:1px solid var(--brand);margin-right:.5rem}
/* ---- article prose ---- */
.prose{max-width:700px;line-height:1.75;font-size:1.08rem;color:var(--txt)}
.prose h2{font-weight:800;letter-spacing:-.02em;font-size:1.5rem;margin:2rem 0 .6rem;color:var(--ink)}
.prose h3{font-weight:700;font-size:1.2rem;margin:1.5rem 0 .5rem;color:var(--ink)}
.prose a{font-weight:600}
.prose ul,.prose ol{padding-left:1.25rem}.prose li{margin:.35rem 0}
.prose blockquote{border-left:3px solid var(--brand);background:var(--card);margin:1rem 0;padding:.6rem 1rem;color:var(--mut);border-radius:0 8px 8px 0}
.prose img{max-width:100%;border-radius:10px}
.alist{list-style:none;padding:0;margin:1.2rem 0}
.alist li{background:var(--card);border:1px solid var(--bd);border-radius:var(--r);padding:1.1rem 1.2rem;margin:.7rem 0;transition:border-color .12s}
.alist li:hover{border-color:var(--bd2)}
.alist a.t{font-weight:800;letter-spacing:-.02em;font-size:1.28rem;color:var(--ink);line-height:1.15;display:block}
.alist a.t:hover{color:var(--brand);text-decoration:none}
.alist .dek{color:var(--mut);margin:.35rem 0 0;line-height:1.55}
.alist time{font-size:.76rem;color:var(--mut);font-weight:600}
.foot{background:var(--card);border-top:1px solid var(--bd);color:var(--mut);font-size:.8rem;line-height:1.7}
.foot .in{max-width:960px;margin:0 auto;padding:1.6rem 1.1rem 2.4rem}
.foot a{color:var(--mut);font-weight:600}.foot a:hover{color:var(--brand)}
.foot .ln{margin-bottom:.6rem}
@media(max-width:640px){
  .cmp,.cmp tbody,.cmp tr,.cmp td{display:block;width:100%}
  .cmp thead{position:absolute;left:-9999px}
  .cmp tr{border-bottom:1px solid var(--bd);padding:.5rem 0}
  .cmp tr.top td{background:transparent}.cmp tr.top{background:var(--brandwash)}
  .cmp td{border:0;padding:.4rem 1.1rem}
  td.ca{text-align:left;padding-top:.2rem}.claim{display:block;text-align:center}
}
</style></head><body>
<div class="bar"></div>
<header class="topnav"><div class="in">
  <a class="brand" href="/bonuses"><span class="mk"><svg viewBox="0 0 64 64" aria-hidden="true"><polyline points="11,44 27,28 38,36 53,17" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${escAttr(BRAND)}</a>
  <nav>${nav}</nav>
</div></header>
<main class="wrap">${o.body}</main>
<footer class="foot"><div class="in">
  <div class="ln"><a href="/bonuses">Bonuses by state</a> · <a href="/blog">Guides</a></div>
  <p><strong style="color:#475467">Advertising disclosure:</strong> ${escAttr(BRAND)} is an independent guide to sports-betting &amp; daily-fantasy sign-up offers. Some outbound links are partner/affiliate links — we may earn a commission if you sign up, at no extra cost to you. This never affects which offers we list or how we rank them. Offers vary by state and change often; always confirm current terms on the operator's site before signing up.</p>
  <p>21+ (18+ where permitted). If gambling stops being fun, call <strong>1-800-GAMBLER</strong> or visit <a href="https://www.ncpgambling.org/">ncpgambling.org</a>. ${escAttr(BRAND)} is a project by <a href="/">AnpiesPicks</a>.</p>
</div></footer>
</body></html>`;
}

// ---- /bonuses + /bonuses/:state — the state-by-state comparison magnet ----
async function renderBonusesPage(c: any, stateRaw: string): Promise<Response> {
  const state = String(stateRaw || getGeo(c).state || 'OH').toUpperCase();
  const stName = STATE_NAMES[state] || state;
  const origin = new URL(c.req.url).origin;
  const rows = (await c.env.DB.prepare(
    `SELECT b.id, b.name, b.category, b.blurb, b.min_age, b.favorite,
            o.referee_bonus, o.required_action, o.referee_value,
            lg.status, lg.accepting_signups, lg.promo_active, lg.product_note
       FROM books b
       LEFT JOIN offers o    ON o.book_id = b.id AND o.active = 1
       LEFT JOIN legality lg ON lg.book_id = b.id AND lg.state = ?
      WHERE b.active = 1 AND b.referral_url IS NOT NULL AND b.referral_url <> ''
      ORDER BY (lg.status='legal' AND lg.accepting_signups=1) DESC, lg.promo_active DESC,
               COALESCE(o.referee_value,0) DESC, b.favorite DESC, b.name`
  ).bind(state).all()).results as any[];
  // attach active deposit-match promos (same shape the landing page uses)
  const proms = (await c.env.DB.prepare(`SELECT book_id, match_pct, max_amount, duration FROM promos WHERE active=1 ORDER BY id DESC`).all()).results as any[];
  const matchByBook: Record<string, any> = {};
  for (const p of proms) if (!matchByBook[p.book_id]) matchByBook[p.book_id] = p;

  const avail = rows.filter((r) => r.status === 'legal' && r.accepting_signups);
  const others = rows.filter((r) => !(r.status === 'legal' && r.accepting_signups));
  const topId = (avail.find((r) => r.favorite) || avail[0])?.id;

  const row = (r: any, i: number) => {
    const m = matchByBook[r.id];
    const matchHtml = m ? `<div class="match">+ ${m.match_pct ? m.match_pct + '% deposit match' : 'Deposit match'}${m.max_amount ? ' to $' + m.max_amount : ''}</div>` : '';
    const terms = r.required_action || r.product_note || r.blurb;
    return `<tr class="${r.id === topId ? 'top' : ''}">
      <td data-label="App"><div class="app"><span class="rk">${i + 1}</span><span class="an">${r.id === topId ? '<span class="pin">★ Top pick</span><br>' : ''}${escHtml(r.name)}<small>${escHtml(CAT_LABEL[r.category] || r.category || '')}${r.min_age ? ' · ' + r.min_age + '+' : ''}</small></span></div></td>
      <td data-label="Sign-up offer"><div class="bn">${escHtml(r.referee_bonus || 'Sign-up bonus')}</div>${matchHtml}${terms ? `<div class="terms">${escHtml(terms)}</div>` : ''}</td>
      <td class="ca"><a class="claim" href="/smart?book=${encodeURIComponent(r.id)}&channel=bonuses&state=${state}" rel="nofollow sponsored">Claim bonus →</a></td>
    </tr>`;
  };
  const table = `<table class="cmp"><thead><tr><th>App</th><th>Sign-up offer</th><th></th></tr></thead><tbody>${avail.map(row).join('')}</tbody></table>`;

  const stateList = ALL_STATES.map((s) => `<a href="/bonuses/${s.toLowerCase()}"${s === state ? ' class="on"' : ''} title="${escHtml(STATE_NAMES[s])}">${s}</a>`).join('');
  const title = `Best Sportsbook & Pick'em Sign-Up Bonuses in ${stName} (${monthYear()})`;
  const desc = `Compare the current sports-betting and DFS pick'em sign-up bonuses available in ${stName}. Hand-checked offers, what you get, and how to claim — updated for ${monthYear()}.`;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList', name: title,
    itemListElement: avail.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name })),
  });

  const body = `
    <p class="eyebrow">Bonus finder · Updated ${monthYear()}</p>
    <h1>Best ${escHtml(stName)} sportsbook &amp; pick'em bonuses</h1>
    <p class="lede">We track the sports-betting and daily-fantasy pick'em apps signing up new players in <strong>${escHtml(stName)}</strong> and the welcome offer each one is running. Offers are checked by hand and refreshed regularly — apps not currently accepting ${escHtml(stName)} players are listed separately below.</p>
    <div class="statepick"><label for="st">Showing offers for:</label>
      <select id="st" onchange="location.href='/bonuses/'+this.value.toLowerCase()">${ALL_STATES.map((s) => `<option value="${s}"${s === state ? ' selected' : ''}>${STATE_NAMES[s]}</option>`).join('')}</select>
    </div>
    ${avail.length ? table : `<div class="note">No apps are signing up new players in ${escHtml(stName)} with a live welcome offer right now. Choose another state below, or <a href="/blog">read the latest guides</a> — new states open up often.</div>`}
    ${others.length ? `<p class="subhead">Not available in ${escHtml(stName)} yet</p>${others.map((r) => `<div class="note" style="margin:.5rem 0;padding:.7rem 1rem"><strong style="color:#0F1B2E">${escHtml(r.name)}</strong> — ${escHtml(CAT_LABEL[r.category] || r.category || '')}. ${r.status === 'legal' ? 'Not currently taking new signups here.' : 'Not available in ' + escHtml(stName) + ' yet.'}</div>`).join('')}` : ''}
    ${avail.length ? `<div class="cta-strip"><strong>Not sure which to choose?</strong> We'll send you straight to the best available welcome offer for ${escHtml(stName)}.<br>
      <a class="go" href="/smart?channel=bonuses&state=${state}" rel="nofollow sponsored">See the best ${escHtml(stName)} offer →</a></div>` : ''}
    <p class="subhead">Browse another state</p>
    <div class="statelist">${stateList}</div>
  `;
  return new Response(siteShell({ title, desc, canonical: `${origin}/bonuses/${state.toLowerCase()}`, body, active: '/bonuses', jsonLd }),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}
app.get('/bonuses', (c) => renderBonusesPage(c, ''));
app.get('/bonuses/:state', (c) => {
  const s = String(c.req.param('state') || '').toUpperCase();
  if (!STATE_NAMES[s]) return c.redirect('/bonuses', 302);
  return renderBonusesPage(c, s);
});

// ---- /blog + /blog/:slug — the content layer ----
app.get('/blog', async (c) => {
  const origin = new URL(c.req.url).origin;
  const rows = (await c.env.DB.prepare(
    `SELECT slug, title, dek, published_at FROM articles WHERE status='published' ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT 100`
  ).all()).results as any[];
  const list = rows.length ? `<ul class="alist">${rows.map((a) => `<li>
      <a class="t" href="/blog/${escAttr(a.slug)}">${escHtml(a.title)}</a>
      ${a.published_at ? `<time>${escHtml(String(a.published_at).slice(0, 10))}</time>` : ''}
      ${a.dek ? `<p class="dek">${escHtml(a.dek)}</p>` : ''}
    </li>`).join('')}</ul>`
    : `<div class="note">No guides published yet — the first ones are on the way. In the meantime, <a href="/bonuses">compare sign-up bonuses in your state</a>.</div>`;
  const title = `${BRAND} Guides — sports-betting & DFS bonuses explained`;
  const desc = 'Plain-English guides to sports-betting & daily-fantasy sign-up bonuses: how playthrough really works, which offers are worth it, and state-by-state launch news.';
  const body = `<p class="eyebrow">Guides</p><h1>Bonuses &amp; how-tos, explained</h1>
    <p class="lede">No hype — just clear breakdowns of which sign-up offers are actually worth it, how the fine print works, and which apps are live where. ${desc}</p>${list}`;
  return new Response(siteShell({ title, desc, canonical: `${origin}/blog`, body, active: '/blog' }),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
});
app.get('/blog/:slug', async (c) => {
  const origin = new URL(c.req.url).origin;
  const a = await c.env.DB.prepare(`SELECT * FROM articles WHERE slug=? AND status='published'`).bind(c.req.param('slug')).first<any>();
  if (!a) return c.notFound();
  const dateStr = a.published_at ? String(a.published_at).slice(0, 10) : '';
  const cover = a.cover_url ? (a.cover_url.startsWith('http') ? a.cover_url : origin + a.cover_url) : null;
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title,
    description: a.dek || '', datePublished: a.published_at || a.created_at, dateModified: a.updated_at || a.created_at,
    author: { '@type': 'Organization', name: BRAND }, publisher: { '@type': 'Organization', name: BRAND },
    mainEntityOfPage: `${origin}/blog/${a.slug}`, ...(cover ? { image: cover } : {}),
  });
  const body = `<p class="eyebrow"><a href="/blog">← Guides</a></p>
    <h1>${escHtml(a.title)}</h1>
    ${a.dek ? `<p class="lede">${escHtml(a.dek)}</p>` : ''}
    ${dateStr ? `<p style="font-size:.8rem;color:var(--mut);font-weight:600;margin:-.6rem 0 1.2rem">Updated ${escHtml(dateStr)}</p>` : ''}
    ${cover ? `<img src="${escAttr(a.cover_url)}" alt="${escAttr(a.title)}" style="width:100%;border-radius:14px;margin:0 0 1.4rem">` : ''}
    <div class="prose">${mdToHtml(a.body || '')}</div>
    <div class="cta-strip"><strong>Compare current sign-up offers</strong> in your state, or jump straight to the best available one.<br>
      <a class="go alt" href="/bonuses">Compare bonuses →</a><a class="go" href="/smart?channel=blog" rel="nofollow sponsored">See the best offer →</a></div>`;
  return new Response(siteShell({ title: `${a.title} — ${BRAND}`, desc: a.dek || a.title, canonical: `${origin}/blog/${a.slug}`, body, active: '/blog', jsonLd, ogImage: cover || undefined }),
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
});

// ---- robots.txt + sitemap.xml (so search engines find & index the above) ----
app.get('/robots.txt', (c) => {
  const origin = new URL(c.req.url).origin;
  return c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /quick\nDisallow: /login\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`);
});
app.get('/sitemap.xml', async (c) => {
  const origin = new URL(c.req.url).origin;
  const arts = (await c.env.DB.prepare(`SELECT slug, COALESCE(updated_at, published_at, created_at) AS lm FROM articles WHERE status='published'`).all()).results as any[];
  const urls: string[] = [];
  const add = (loc: string, lm?: string) => urls.push(`<url><loc>${escAttr(loc)}</loc>${lm ? `<lastmod>${escAttr(String(lm).slice(0, 10))}</lastmod>` : ''}</url>`);
  add(`${origin}/`);
  add(`${origin}/bonuses`);
  add(`${origin}/record`);
  add(`${origin}/me`);
  add(`${origin}/blog`);
  for (const s of ALL_STATES) add(`${origin}/bonuses/${s.toLowerCase()}`);
  for (const a of arts) add(`${origin}/blog/${a.slug}`, a.lm);
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`,
    200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
});

// ---- admin articles CRUD (cookie-gated) ----
app.get('/api/admin/articles', async (c) => {
  const rows = (await c.env.DB.prepare(`SELECT id, slug, title, dek, tags, status, published_at, updated_at FROM articles ORDER BY (status='published'), COALESCE(published_at, created_at) DESC, id DESC`).all()).results;
  return c.json({ articles: rows });
});
app.get('/api/admin/articles/:id', async (c) => {
  const a = await c.env.DB.prepare(`SELECT * FROM articles WHERE id=?`).bind(c.req.param('id')).first();
  if (!a) return c.json({ error: 'not found' }, 404);
  return c.json({ article: a });
});
async function uniqueSlug(c: any, base: string, exceptId?: any): Promise<string> {
  let slug = slugify(base) || 'post';
  let n = 0;
  while (true) {
    const row = await c.env.DB.prepare(`SELECT id FROM articles WHERE slug=?`).bind(slug).first<any>();
    if (!row || (exceptId != null && String(row.id) === String(exceptId))) return slug;
    n++; slug = slugify(base) + '-' + n;
  }
}
app.post('/api/admin/articles', async (c) => {
  const a = await c.req.json().catch(() => ({} as any));
  if (!a.title) return c.json({ error: 'title required' }, 400);
  const slug = await uniqueSlug(c, a.slug || a.title);
  const status = a.status === 'published' ? 'published' : 'draft';
  const res = await c.env.DB.prepare(
    `INSERT INTO articles (slug, title, dek, body, tags, cover_url, status, published_at)
     VALUES (?,?,?,?,?,?,?, ${status === 'published' ? "datetime('now')" : 'NULL'})`
  ).bind(slug, a.title, a.dek ?? null, a.body ?? null, a.tags ?? null, a.cover_url ?? null, status).run();
  return c.json({ ok: true, id: res.meta.last_row_id, slug });
});
app.put('/api/admin/articles/:id', async (c) => {
  const id = c.req.param('id');
  const a = await c.req.json().catch(() => ({} as any));
  const cur = await c.env.DB.prepare(`SELECT * FROM articles WHERE id=?`).bind(id).first<any>();
  if (!cur) return c.json({ error: 'not found' }, 404);
  const slug = a.slug && a.slug !== cur.slug ? await uniqueSlug(c, a.slug, id) : cur.slug;
  const status = a.status === undefined ? cur.status : (a.status === 'published' ? 'published' : 'draft');
  // first publish stamps published_at; unpublishing leaves it (so re-publish keeps original date unless you clear it)
  const publishedAt = status === 'published' ? (cur.published_at || new Date().toISOString()) : cur.published_at;
  await c.env.DB.prepare(
    `UPDATE articles SET slug=?, title=COALESCE(?,title), dek=?, body=?, tags=?, cover_url=?, status=?, published_at=?, updated_at=datetime('now') WHERE id=?`
  ).bind(slug, a.title ?? null, a.dek ?? null, a.body ?? null, a.tags ?? null, a.cover_url ?? null, status, publishedAt, id).run();
  return c.json({ ok: true, slug });
});
app.delete('/api/admin/articles/:id', async (c) => {
  await c.env.DB.prepare(`DELETE FROM articles WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// static assets (landing = index.html, dashboard = admin.html)
// ---------------------------------------------------------------------------
// Serve the SPA HTML pages with no-store so deploys always land (no stale cache on
// phones / home-screen apps). Fonts, /swirl.svg and /img/* keep their long cache.
async function freshPage(c: any, file: string) {
  const res = await c.env.ASSETS.fetch(new Request(new URL(file, c.req.url)));
  const h = new Headers(res.headers);
  h.set('Cache-Control', 'no-store, must-revalidate');
  return new Response(res.body, { status: res.status, headers: h });
}
app.get('/admin', (c) => freshPage(c, '/admin.html'));
app.get('/quick', (c) => freshPage(c, '/quick.html'));
app.get('/record', (c) => freshPage(c, '/record.html'));
app.get('/me', (c) => freshPage(c, '/me.html'));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
