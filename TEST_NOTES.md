# Insights Redesign — Test Notes

## Environment
- Expo dev server already running on `http://localhost:8081` (web). App is **logged in**
  (Supabase session in localStorage). Real user data.
- Screenshots saved to `debug_screenshots/insights_redesign/`.
- DB queried read-only via the page's authed session (Playwright `browser_evaluate` → Supabase REST).

## Commands
| When | Command | Result |
|------|---------|--------|
| orient | `node -e` package scripts | scripts: start/android/ios/web; charts: react-native-svg only |
| orient | DB counts | 11 cats, 14 blocks, 15 entries, 0 recurring, 0 linked |

## Reference dataset snapshot (IST, 2026-05-28 ~06:13)
**PLANS (calendar_blocks) — all May 28:**
- Sleep 03:00–13:00
- Self-care(Brush,Skincare) 13:00–13:30
- Food(Lunch) 13:30–14:00
- Watching(Series) 14:00–16:00
- Study(Job Applications) 16:00–17:00  ⟂ Study(Project) 16:00–17:00  ← parallel plan
- Reading(Stranger) 17:00–18:00
- Activity(Gym) 18:00–19:30
- Self-care(Skincare,Bath) 19:30–20:00
- Call(Mom,Diya) 20:00–21:00
- Study(Project) 21:00–23:00  ⟂ Watching(From,Series) 21:00–23:00  ← parallel plan
- Reading(Stranger) 23:00–23:59
- Study(Project) [May 29] 00:00–01:00

**ACTUALS (time_entries) — May 27 → early 28:**
- Sleep 27 07:42–12:56
- Self-care 27 12:56–13:35
- Commute(Office) 27 13:35–14:30
- Office 27 14:30–16:40
- Commute(Antera) 27 16:40–17:30
- Food(Lunch,Antera) 27 17:30–18:40
- Commute(Home) 27 18:40–19:30
- Activity(Swim) 27 19:30–21:00
- Self-care(Bath) 27 21:00–21:45
- Call(Diya) 27 21:45–23:23  ⟂ Study(Project) 27 22:00–23:23  ← parallel actual
- Self-care 27 23:23–23:35
- Study(Project) 27 23:35 → 28 03:00 (cross-midnight)
- Watching(From) 28 00:20–03:25  ⟂ (overlaps the Study above) ← parallel actual
- Study(Project) 28 03:25 → RUNNING

### Hand-verifiable expectations (for unit tests)
- May 27 actual wall-clock **union** ≈ 07:42→23:35 minus any gaps; the Call⟂Study overlap (22:00–23:23,
  83 min) must NOT be double counted. Summed durations > union by ~83 min + Study-tail.
- May 27 has **no plan** → 100% of May 27 actual is "unplanned".
- Today (May 28) elapsed plan window 03:00–06:13 is planned **Sleep**; actual is **Study** →
  Sleep adherence ≈ 0, large sleep deficit; Study is unplanned-overrun.

## Screenshots taken
| File | What |
|------|------|
| `00_before_full.png` | Current Insights page (before redesign) — headline 27h/1 full day/15 entries |

## Typecheck / lint / test runs
_(to be filled as the loop runs)_

## Real-data verification gate (engine definitions vs live data) — PASS
Now = 2026-05-28 06:27 IST (tz Asia/Calcutta). Inline union math (mirrors engine) vs live DB:
- **Today** [00:00→now, elapsed 6.45h]: tracked(union)=6.45h, untracked=0.00h, summed=9.12h,
  overlap=2.67h, plannedElapsed=3.45h (only Sleep 03:00→06:27 elapsed; rest of plan is future).
  → adherence ≈ 0% (planned Sleep, did Study). The off-plan-night story is real.
- **Week** [Mon 00:00→now, elapsed 78.45h]: tracked=22.75h, untracked=55.7h, overlap=4.05h,
  plannedElapsed=3.45h (May 25–26 empty, May 27 no plan, today's other blocks future).
These are the numbers the UI Overview must reproduce. Engine unit tests: 12/12 pass.

## v1 build verification
- `npx tsc --noEmit` → 0 errors.
- `node --test --experimental-strip-types day-range.test.ts planVsActual.test.ts` → 16/16 pass.
  (Directory-glob mode fails to load on Windows — run files explicitly.)
- Page renders with 0 runtime console errors (2 benign warnings: pointerEvents deprecation from a
  global banner, useNativeDriver from animations — both pre-existing).

### In-app numbers (match verification gate)
- Week: Untracked 55h42m, Plan adherence 8%, Unplanned 22h36m, Overlap 4h3m; Diagnostics
  tracked-union 22h53m vs summed 26h56m, planned-elapsed 3h35m, blocks 1 judged / 13 upcoming.
- Day (today): Untracked 0m, Plan adherence 2%, Unplanned 6h36m, Overlap 2h40m;
  Sleep plan 3h40m · did 3m · Missed; "Also tracked, unplanned: Study 5h53m · Watching 3h5m · Misc 18m".

### Screenshots (debug_screenshots/insights_redesign/)
- 00_before_full · 01_v1_week_full · 02_v1_top · 03_v1_mid · 04_v1_bottom
- 05_donut_baseline · 06_donut_segment_click · 07_row_click_highlight (row→segment WORKS)
- 08_day_top
