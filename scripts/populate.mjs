// Generates populate.sql from researched data (as of 2026-06-09).
// Edit the BOOKS array below as offers/legality change, then re-run:
//   node scripts/populate.mjs && npm run db:populate
// Source confidence is captured per book; LOW-confidence items are flagged in notes.
import { writeFileSync } from 'node:fs';

const DATE = '2026-06-09';
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(' ');

// mode 'include' => listed states are legal, others 'unknown' (not asserted unavailable).
// mode 'exclude' => listed states are 'unavailable', all others legal.
// mode 'none'    => all states 'unknown' (insufficiently verified to route).
const BOOKS = [
  { id:'rebet', name:'ReBet', category:'social_sportsbook', min_age:18,
    blurb:'Sweepstakes social sportsbook + casino (ReBet Coins / ReBet Cash).',
    referrer_bonus:'Up to 75 ReBet Cash free bet (1x playthrough)', referrer_value:75,
    referee_bonus:'Welcome match (verify in-app)', referee_value:0,
    required_action:'Friend signs up with your code + makes first coin bundle purchase',
    mode:'exclude', states:['WA','ID','NV','LA','MI','MT','CA'], confidence:'medium',
    notes:'CA withdrawn Jan 2026. $50 vs 75 ReBet Cash across sources — 75 is most recent.' },

  { id:'fliff', name:'Fliff', category:'social_sportsbook', min_age:18,
    blurb:'Sweepstakes social sportsbook (Fliff Coins / Fliff Cash).',
    referrer_bonus:'50 Sweeps Coins + 100 XP', referrer_value:50,
    referee_bonus:'Standard welcome offer (verify)', referee_value:0,
    required_action:'Friend registers with your code + first purchase >= $5',
    mode:'exclude', states:['WA','ID','NV','TN','HI','NJ'], confidence:'medium',
    notes:'Some states (AL,GA,KY,LA,MI,MN,MS,MT,OH,SC) can play but cannot PURCHASE Fliff Cash. NY/NJ status conflicting.' },

  { id:'prizepicks', name:'PrizePicks', category:'dfs_pickem', min_age:18,
    blurb:'DFS — switched entire US to peer-to-peer "Arena/Player Picks" model (Aug 2025).',
    referrer_bonus:'$25 bonus balance (max 10 / 30 days)', referrer_value:25,
    referee_bonus:'Play $5, get $50 in bonus funds', referee_value:50,
    required_action:'Friend signs up with your code + deposits (~$25)',
    mode:'include', confidence:'medium-high',
    states:['AK','AL','AR','CA','CO','DE','FL','GA','IL','IN','KS','KY','ME','MN','MO','NC','ND','NE','NH','NM','NY','OK','OR','RI','SC','SD','TN','TX','UT','VT','WI','WV','WY','DC'],
    notes:'Age 19+ in AL/CO, 21+ in AZ/MA/VA. "36 states+DC" fluctuates. No against-the-house pick em in US anymore.' },

  { id:'underdog', name:'Underdog Fantasy', category:'dfs_pickem', min_age:18,
    blurb:'DFS Drafts + Pick em + peer-to-peer Champions (substitute in restricted states).',
    referrer_bonus:'$10 in bonus entries', referrer_value:10,
    referee_bonus:'Play $5, get $50 in bonus entries', referee_value:50,
    required_action:'Friend signs up with your username + deposits >= $10',
    mode:'include', confidence:'medium-high',
    states:['AL','AK','AZ','AR','CA','CO','FL','GA','IL','IN','KY','MN','MO','NE','NM','NY','NC','ND','OK','OR','RI','SC','SD','TN','TX','UT','VT','VA','WV','WI','WY','DC','KS','MD','MA','MI','MS','NH','NJ','OH','PA'],
    notes:'KS/MD/MA/MI/MS/NH/NJ/OH/PA = Champions (P2P) only. NV none. CT/HI/ID/IA/LA/ME/MT/WA = predictions only.' },

  { id:'sleeper', name:'Sleeper', category:'dfs_pickem', min_age:18,
    blurb:'Season-long fantasy + Sleeper Picks DFS pick em.',
    referrer_bonus:'$25 credit per friend (up to $500)', referrer_value:25,
    referee_bonus:'$20 free + 100% match up to $100', referee_value:100,
    required_action:'Friend signs up with your code + completes deposit/contest',
    mode:'include', confidence:'medium',
    states:['AL','AK','AR','CA','FL','GA','IL','IN','KS','MA','MN','MO','NE','NH','NM','NC','ND','OK','OR','RI','SC','SD','TN','TX','UT','VT','VA','WV','WI','WY','DC'],
    notes:'19+ AL/NE, 21+ MA/VA. Referral $ from secondary sources; official terms non-specific.' },

  { id:'betr', name:'Betr', category:'dfs_pickem', min_age:18,
    blurb:'Betr Picks (DFS) + Betr Sportsbook (real-money, OH only, 21+) + social sportsbook.',
    referrer_bonus:'$10 Betr Bucks + 25% of friend first deposit', referrer_value:10,
    referee_bonus:'Up to ~$210 back + free pick (promo)', referee_value:200,
    required_action:'Friend installs app, deposits + places >= $10 entries within 30 days',
    mode:'include', confidence:'medium-high',
    states:['AL','AK','AZ','AR','CA','FL','GA','IL','IN','KS','KY','MA','MN','NE','NH','NM','NC','ND','OK','OR','RI','SC','SD','TN','TX','UT','VT','VA','WV','WI','WY','DC'],
    notes:'Real-money sportsbook = OH only (21+). Picks state list varies slightly by source.' },

  { id:'parlayplay', name:'ParlayPlay', category:'dfs_pickem', min_age:18,
    blurb:'DFS fixed-odds pick em (over/under player props).',
    referrer_bonus:'$20 free entry (up to 10 friends)', referrer_value:20,
    referee_bonus:'$5 free entry (standard signup)', referee_value:5,
    required_action:'Friend signs up with your link, verifies, deposits >= $10',
    mode:'include', confidence:'high',
    states:['AL','AK','AR','CA','CO','FL','GA','IL','IA','KS','KY','MA','MN','NE','NM','NC','ND','OK','OR','RI','SC','SD','TX','UT','VT','WI','WY','DC'],
    notes:'19+ AL/NE, 21+ MA/VT/IA. Official $20 (older sources say $5).' },

  { id:'dabble', name:'Dabble', category:'dfs_pickem', min_age:18,
    blurb:'Social DFS pick em with copy-picks + peer-to-peer in some states.',
    referrer_bonus:'$10 bonus credit', referrer_value:10,
    referee_bonus:'$10 signup bonus', referee_value:10,
    required_action:'Friend enters your code + places >= 1 entry',
    mode:'include', confidence:'medium-high',
    states:['AK','AR','CA','FL','GA','IL','IN','KS','KY','MA','MN','NE','NM','NC','ND','OK','OR','RI','SC','SD','TN','TX','UT','WV','WI','WY','DC'],
    notes:'19+ NE, 21+ MA/TN. Australian-founded brand, US entity.' },

  { id:'bankroll', name:'Bankroll', category:'dfs_pickem', min_age:18,
    blurb:'DFS pick em (HotStreak) inside the Bankroll wallet app.',
    referrer_bonus:'Unverified — confirm in-app', referrer_value:0,
    referee_bonus:'Unverified', referee_value:0,
    required_action:'Friend signs up with your code (converts within 30 days)',
    mode:'include', confidence:'low',
    states:['AK','FL','GA','IL','KS','KY','MN','NE','NM','NC','ND','OK','OR','RI','SC','SD','TX','UT','WV','WI','WY','DC'],
    notes:'HotStreak rebranded to Bankroll, still operating 2026. Referral $ unverified. NOT the unrelated Hot Streak Casino.' },

  { id:'chalkboard', name:'Chalkboard', category:'dfs_pickem', min_age:18,
    blurb:'DFS pick em (paid) + free-to-play social sweeps mode by state.',
    referrer_bonus:'$10 per friend (up to $250)', referrer_value:10,
    referee_bonus:'100% deposit match + free square (welcome)', referee_value:0,
    required_action:'Friend signs up with your code + first deposit',
    mode:'include', confidence:'high',
    states:['GA','IN','MN','NE','NM','NC','OK','OR','RI','SC','TX','UT','AK','CA','IL','KY','ND','SD','VT','DC','WV','WI','AR','DE','FL','KS','ME','MA','MO','NH','PA','VA','WY'],
    notes:'19+ NE, 21+ MA. Real-money DFS in some states, social-only (Coins/CB Cash) in others.' },

  { id:'dk-pick6', name:'DraftKings Pick 6', category:'dfs_pickem', min_age:18,
    blurb:'DraftKings DFS pick em (more/less player props).',
    referrer_bonus:'100% match up to $50 of friend deposit', referrer_value:50,
    referee_bonus:'Play $5, get $50 in bonus picks', referee_value:50,
    required_action:'Friend registers with your code + deposits >= $25',
    mode:'include', confidence:'medium-high',
    states:['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','IL','IN','KS','KY','ME','MA','MN','MO','NE','NH','NM','NC','ND','OK','RI','SC','SD','TN','TX','UT','VT','VA','WV','WI','DC'],
    notes:'NOT in HI/ID/MT/NV/OR/WA/NY (reliable core). LA/MI/NJ/MD/PA commonly excluded too.' },

  { id:'courtside', name:'Courtside', category:'social_sportsbook', min_age:18,
    blurb:'Free-to-play social sweeps: pick em + social casino (courtside.app).',
    referrer_bonus:'Free Coins + Cash (amount undisclosed)', referrer_value:0,
    referee_bonus:'Unverified', referee_value:0,
    required_action:'You must buy Coins first; friend signs up + verifies + purchases',
    mode:'exclude', states:['CA','CT','ID','LA','MI','MT','NV','NJ','NY'], confidence:'medium',
    notes:'Do NOT confuse with Courtside 1891 (FIBA streaming). Referral amounts undisclosed.' },

  { id:'bracco', name:'Bracco', category:'social_sportsbook', min_age:18,
    blurb:'Social sweeps sportsbook + casino (dual-currency).',
    referrer_bonus:'Up to $100 free social bet', referrer_value:100,
    referee_bonus:'Welcome: $5 + 100% match up to $100', referee_value:0,
    required_action:'Friend enters your username + first purchase >= $50 + wagers >= $200 sports',
    mode:'exclude', states:['CA','CT','ID','LA','MI','MT','NV','NJ','NY'], confidence:'medium-high',
    notes:'High playthrough flagged in reviews. Referral terms from affiliate sources.' },

  { id:'novig', name:'Novig', category:'prediction_market', min_age:21,
    blurb:'Peer-to-peer no-vig prediction exchange (sweeps model in US).',
    referrer_bonus:'25 Novig Cash (max 5 friends)', referrer_value:25,
    referee_bonus:'25 Novig Cash', referee_value:25,
    required_action:'Friend registers, verifies, enters code + purchases >= $25',
    mode:'exclude', states:['AL','CO','ID','LA','MI','MT','NV','TN','WA'], confidence:'medium',
    notes:'Exact exclusion list + CFTC-vs-sweeps framing need primary-source confirmation.' },

  { id:'predictionstrike', name:'PredictionStrike', category:'prediction_market', min_age:18,
    blurb:'Sports "stock market" — buy/sell athlete shares. Operating 2026 (app updated Nov 2025).',
    referrer_bonus:'~1 free share (unverified)', referrer_value:0,
    referee_bonus:'~1 free share / $10 (unverified)', referee_value:0,
    required_action:'Friend signs up with your code + deposits >= $20',
    mode:'none', confidence:'low',
    notes:'Confirmed operating, but state list AND referral amounts unverified — not routed until confirmed.' },

  { id:'thrillz', name:'Thrillzz', category:'social_sportsbook', min_age:18,
    blurb:'Sweepstakes social sportsbook (added casino in 2026).',
    referrer_bonus:'1 Sweep + up to 30 Sweeps on friend purchases', referrer_value:30,
    referee_bonus:'Standard welcome (verify)', referee_value:0,
    required_action:'Friend registers with your code + makes a pick; purchases up to $30 in 30 days',
    mode:'exclude', states:['AL','AZ','CA','CT','GA','HI','ID','KY','LA','MI','MS','MT','NV','NJ','NY','OH','TN','WA'], confidence:'medium',
    notes:'Exclusion list volatile (exited AZ on C&D). "Thrillz"/"Thrillzz" same brand.' },

  { id:'snoop-casino', name:'Dogg House (Snoop Dogg) Casino', category:'sweeps_casino', min_age:21,
    blurb:'Snoop Dogg / Death Row sweeps social casino (a.k.a. Dogg House), launched Jan 2026.',
    referrer_bonus:'125 Dogg Cash', referrer_value:125,
    referee_bonus:'Unverified', referee_value:0,
    required_action:'Friend signs up + deposits/plays >= $10',
    mode:'exclude', states:['CA','AZ','NV','CT','ID','LA','MD','MI','MT','NJ','NY'], confidence:'medium',
    notes:'Official name Dogg House Casino, built by Trivelta. Referral figures from single affiliate source.' },
];

const q = (v) => v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const sql = ['-- Generated by scripts/populate.mjs — as of ' + DATE, 'DELETE FROM legality;'];

for (const b of BOOKS) {
  sql.push(`UPDATE books SET name=${q(b.name)}, category=${q(b.category)}, blurb=${q(b.blurb)}, min_age=${b.min_age}, notes=${q(b.confidence + ' confidence. ' + (b.notes||''))} WHERE id=${q(b.id)};`);
  sql.push(`UPDATE offers SET referrer_bonus=${q(b.referrer_bonus)}, referrer_value=${b.referrer_value}, referee_bonus=${q(b.referee_bonus)}, referee_value=${b.referee_value}, required_action=${q(b.required_action)}, verified_at=${q(DATE)} WHERE book_id=${q(b.id)} AND active=1;`);

  for (const st of STATES) {
    let status, accepting, promo;
    if (b.mode === 'none') { status='unknown'; accepting=0; promo=0; }
    else if (b.mode === 'exclude') {
      if (b.states.includes(st)) { status='unavailable'; accepting=0; promo=0; }
      else { status='legal'; accepting=1; promo = b.referrer_value > 0 ? 1 : 0; }
    } else { // include
      if (b.states.includes(st)) { status='legal'; accepting=1; promo = b.referrer_value > 0 ? 1 : 0; }
      else { status='unknown'; accepting=0; promo=0; }
    }
    const note = (status === 'legal' || status === 'unavailable') ? null : null;
    const verified = status === 'unknown' ? 'NULL' : q(DATE);
    sql.push(`INSERT INTO legality (book_id,state,status,accepting_signups,promo_active,verified_at) VALUES (${q(b.id)},${q(st)},${q(status)},${accepting},${promo},${verified});`);
  }
}

writeFileSync(new URL('../populate.sql', import.meta.url), sql.join('\n') + '\n');
console.log(`Wrote populate.sql — ${BOOKS.length} books, ${BOOKS.length * STATES.length} legality rows.`);
