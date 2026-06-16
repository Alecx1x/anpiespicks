-- Intent calendar seed (researched 2026-06-09). High-intent US betting/DFS windows.
-- Far-out dates (esp. UFC) can shift — edit/delete freely in the Grow tab. Re-apply: npm run db:events
DELETE FROM events;
INSERT INTO events (date, name, sport) VALUES
  ('2026-06-14','UFC White House Card: Topuria vs Gaethje','ufc'),
  ('2026-06-20','UFC Fight Night: Kape vs Horiguchi','ufc'),
  ('2026-06-23','NBA Draft (Round 1)','nba'),
  ('2026-06-27','UFC Fight Night (Baku)','ufc'),
  ('2026-07-11','UFC 329: McGregor vs Holloway 2','ufc'),
  ('2026-07-14','MLB All-Star Game (Philadelphia)','mlb'),
  ('2026-07-25','UFC Fight Night (Abu Dhabi)','ufc'),
  ('2026-08-06','NFL Hall of Fame Game','nfl'),
  ('2026-08-15','UFC 330 (Philadelphia)','ufc'),
  ('2026-08-27','College Football Week 0','ncaa'),
  ('2026-09-05','College Football Week 1 (Labor Day wknd)','ncaa'),
  ('2026-09-09','NFL Kickoff Game','nfl'),
  ('2026-09-12','Canelo vs Mbilli (Boxing)','boxing');
