# TESTS.md — Test & QA Tracking

_Last updated: 2026-05-27 07:25 IST_

## Strategy
- No test framework installed; installing Jest for Expo SDK 54 / RN 0.81 / React 19 is high-friction and not the deliverable.
- **Pure-logic tests** for the root-cause fixes run via `node --test` against extracted, dependency-free helpers (no React/Supabase imports).
- **Manual / visual QA** via `npm run web` + Playwright screenshots into `/debug_screenshots` (best-effort; documented if dev server can't start cleanly).

## Automated (pure-logic) — run: `TZ=Asia/Kolkata node --test src/lib/__tests__/day-range.test.ts`
| Test file | Covers | Status |
|-----------|--------|--------|
| `app/src/lib/__tests__/day-range.test.ts` | #2 local-day bucketing/boundaries | ✅ 4/4 pass under IST(+5:30) AND US-Eastern(−5:00) |

`tsc --noEmit`: **0 errors** (baseline was 1 pre-existing, now fixed).
Note: `__tests__` excluded from app `tsconfig` (uses `.ts` import extensions for the Node runner).

## Manual / visual QA (Playwright vs Expo web :8081, 390×844)
| Scenario | Issue | Result | Screenshot |
|----------|-------|--------|-----------|
| Day shows early-morning entries + "Nigga2" | #2 | ✅ pass | 03 |
| Two parallel timers at distinct start positions (Day & Week) | #3 | ✅ pass | 03, 06 |
| Home + top bar reflect 2 running timers | #4 | ✅ pass | 01, 02, 05, 06 |
| Tap home live task → Edit entry sheet (test3 & index) | #5 | ✅ pass | 02 |
| Home shows task title + category + tag | #6 | ✅ pass | 01, 05 |
| Home vertically balanced / top spacing | #1 | ✅ pass | 05 |
| Settings sheet fully visible, no bottom clip | #8 | ✅ pass | 04 |
| Icon section removed from Categories | #9 | ✅ pass | 04 |
| Settings sheets consistent container | #10 | ✅ pass | 04 |
| Week view not broken | regression | ✅ pass | 06 |

## Visual validation (screenshots in /debug_screenshots)
- `01_initial.png` … `06_week_intact.png` (objectives #1–#10, week regression).
- `07_settings_tags_sheet_8_10.png` — Tags sheet contained (most complex sheet).
- `08_root_redirects_to_test3.png` — `/` redirects to the single home.
- `09_clean_slate_home.png` — post-wipe idle home renders cleanly.

## Follow-up tasks (2026-05-27)
- #7 migration applied to remote (`supabase db push`; verified on Remote).
- Single home: `/` → redirect → `test3`; verified.
- Dev data: full soft-delete wipe (30 time_entries + 11 calendar_blocks) via PostgREST + user JWT; re-inspect shows 0 active; app shows idle. Recoverable via `deleted_at`.

## Notes
- Console shows only deprecation warnings (pointerEvents, useNativeDriver, shadow*) — 0 errors.
- #7 daily-plans has no UI yet (by design) — verified statically (tsc) + migration live.
