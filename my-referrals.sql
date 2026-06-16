-- Your real referral URLs (personal). Re-apply after any db:init with: npm run db:referrals
-- Add more here as you find them, then re-run.

UPDATE books SET referral_url='https://rebet.appsonair.link/U-ANP-PIE-LF' WHERE id='rebet';
UPDATE books SET referral_url='https://get.fliffapp.com/QlC3/gubqvb35' WHERE id='fliff';
UPDATE books SET referral_url='https://play.underdogsports.com/vgwg/2j79007p' WHERE id='underdog';
UPDATE books SET referral_url='http://sleeper.com/i/k99arDmq50BQ' WHERE id='sleeper';
UPDATE books SET referral_url='https://click.dabble.com/GaFA/c6ixshcb' WHERE id='dabble';
UPDATE books SET referral_url='https://promos.betr.app/referafriend/pickem?userId=4051db6e-2a0c-49de-9b5a-5972034d6b4a' WHERE id='betr';
UPDATE books SET referral_url='https://pick6.draftkings.com/r/psx/anpie/US-PSX/US-OK' WHERE id='dk-pick6';
UPDATE books SET referral_url='https://game.playbracco.com/join?referredBy=XEOSVUF5&utm_source=invite&utm_term=XEOSVUF5' WHERE id='bracco';
UPDATE books SET referral_url='https://app.prizepicks.com/p/SlH78UBc' WHERE id='prizepicks';

-- Courtside: only a CODE provided (NPIE7), no shareable link yet — recorded in notes so it isn't lost.
UPDATE books SET notes = notes || ' | Referral CODE: NPIE7 (no share link yet)' WHERE id='courtside';
