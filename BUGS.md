# BUGS.md — Issue Tracker

_Last updated: 2026-05-27 07:25 IST_

Status legend: 🔴 open · 🟡 in progress · 🟢 fixed (code) · ✅ verified

---

## #2 — Day view missing tasks that Week view shows  ✅ verified (Playwright: "Nigga2" + 3:56am entries now in Day)
- **Symptom:** live tasks today + "Nigga2" + others present in Week, absent in Day.
- **Root cause:** `getEntriesForDate()` filters by timezone-naive string boundaries `${date}T00:00:00 / T23:59:59` against `timestamptz`. In IST (UTC+5:30) the naive UTC window is shifted −5:30 from the true local day, so entries near the day's edges fall outside and are dropped. Week view masks this by loading a wide range and re-bucketing via `toLocalDateStr` + merging `timer.running`.
- **Files:** `src/services/time-entries.ts` (`getEntriesForDate`, `getEntriesForDateRange`), `app/(tabs)/day.tsx` (running merge).
- **Fix strategy:** pad the SQL window ±1 day, then filter client-side by `toLocalDateStr(start_time) === date` (mirror Week). Extract boundary/bucket logic into pure, tested helpers. Also merge `timer.running` into Day like Week does.
- **Regression risk:** Week uses `getEntriesForDateRange` — pad it too so its `toLocalDateStr` re-bucket still catches edge entries. Do NOT change Week's render logic.

## #3 — Parallel running tasks show same start time  ✅ verified (Day + Week: Tret/Yet at distinct start y-positions)
- **Symptom:** two running tasks with different starts render as starting together.
- **Root cause:** Day & Week timeline split renders both A and B side-by-side columns at `topB` (later start). Edit sheet shows correct per-entry start (not the bug site).
- **Files:** `app/(tabs)/day.tsx` (~603-665), `app/(tabs)/week.tsx` (~373-416).
- **Fix strategy:** position each running column at its own `hourToPx(start_time)` down to now-line so distinct starts are visible.

## #4 — Live running count wrong (2 running, shows 1)  ✅ verified ("2 RUNNING" + second task on home; "②" in top bar)
- **Root cause:** both home screens + top bar rendered only `timer.running[0]`.
- **Files:** `app/(tabs)/test3.tsx` (real Home tab), `app/(tabs)/index.tsx` (`/` route), `app/(tabs)/_layout.tsx`.
- **Fix strategy:** surface count of running timers; show both running entries (or a "+1 more" affordance). Ensure `getRunningTimers` orders by start_time so [0] = earliest is deterministic.

## #5 — Home current-task click doesn't open edit  ✅ verified (tap on test3 + index → Edit entry sheet opens, matches top bar)
- **Root cause:** top bar `openRunningEntry` pushes `/(tabs)/day` with `editEntry`; home cards had no such navigation.
- **Files:** `app/(tabs)/test3.tsx`, `app/(tabs)/index.tsx` (shared `openEntry` pattern).
- **Fix strategy:** wrap the Now card in a Pressable that mirrors `openRunningEntry` (same params: date, editEntry, focusTs).

## #6 — Home running task shows tag but not name  ✅ verified (title "Tret" now shown above category/tag on both homes)
- **Root cause:** home cards rendered category + tags, never `currentEntry.title`.
- **Files:** `app/(tabs)/test3.tsx`, `app/(tabs)/index.tsx`.
- **Fix strategy:** show task **title** prominently + category + tag.

## #1 — Home page vertical alignment / top spacing  ✅ (code)
- `test3.tsx` (real home) is centered with `paddingTop:32` and balanced negative space (verified). `index.tsx` header `paddingTop` 18→32.

## #8 — Settings sheets clipped / broken container sizing  ✅ verified (Categories sheet fully contained, CREATE visible)
- **Root cause:** `SheetFrame` wraps the sheet in a `ScrollView` containing a `Pressable flex:1` with no bounded height → pushes content, clips bottom.
- **Files:** `app/(tabs)/settings.tsx` (`SheetFrame`).
- **Fix strategy:** restructure to `maxHeight: '85%'` sheet with its own internal scroll + fixed header (mirror `day.tsx` `SheetShell`).

## #9 — Category icon system unclear / half-finished  ✅ verified (icon section gone from Categories sheet)
- **Decision: REMOVED from UI**, kept nullable `icon` schema column for future. Icons are SF-Symbol strings shown as raw text, never rendered as real icons; SF Symbols are iOS-only. Full integration is out of budget. Document so it isn't reverted.
- **Files:** `app/(tabs)/settings.tsx` (icon grid + "No icon" meta).

## #10 — Settings selection layout inconsistency  ✅ (addressed via #8 structural SheetFrame fix)
- All sub-sheets (Categories, Tags, QuickStart, WeekStart, Snap, Export) render through the now-bounded `SheetFrame` with fixed header + internal scroll → consistent container structure. Category sheet verified.

## #7 — AI/custom daily planning architecture (foundational)  ✅ (schema+types+service; migration APPLIED to remote)
- Migration `20260530_001_daily_plans.sql`: `daily_plans` (source manual|ai|template, status, prompt, model, generation_meta jsonb, generated_at; partial unique active-plan index) + `daily_plan_items` (nullable category, calendar_block_id link). RLS on both.
- Types in `database.ts`; service `src/services/daily-plans.ts` with CRUD, `materializePlan()` (items → calendar_blocks), and pluggable `PlanGenerator` + `generateDailyPlan()` hook for future Claude.ai.
- **✅ Applied to remote DB 2026-05-27** via `supabase db push` (ref `iwkiflvwrzfvtpsmhpgd`); `migration list` confirms 20260530 on Remote.

## #11 — Full testing + stabilization pass  ✅
- `day-range` unit tests: 4/4 pass under IST(+5:30) and US-Eastern(−5:00). `tsc --noEmit`: 0 errors (was 1). Visual QA via Playwright on all major screens — see `/debug_screenshots` and TESTS.md.
