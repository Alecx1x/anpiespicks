-- Official affiliate-program application links (researched 2026-06-09).
UPDATE books SET affiliate_url='https://www.betr.app/picks-partner', affiliate_status='interested' WHERE id='betr';
UPDATE books SET affiliate_url='https://www.prizepicks.com/prizepicks-partner-application', affiliate_status='interested' WHERE id='prizepicks';
UPDATE books SET affiliate_url='https://help.underdogsports.com/en/articles/11103714-how-do-i-become-a-partner', affiliate_status='interested' WHERE id='underdog';
UPDATE books SET affiliate_url='https://www.draftkings.com/affiliate-offers', affiliate_status='interested' WHERE id='dk-pick6';
-- Sleeper has no affiliate/CPA program (only Sleeper Media creator deal) — set to none.
UPDATE books SET affiliate_url='https://sleeper.com/blog/introducing-sleeper-media-a-creator-centric-media-business', affiliate_status='none' WHERE id='sleeper';
