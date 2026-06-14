# WORKLOG.md — Chronological Execution Log

## 2026-05-27

### 07:25 IST — Session start / orientation
- No prior WORKLOG/BUGS/STATE/TESTS existed → created fresh.
- Read core architecture: `index.tsx`, `day.tsx`, `week.tsx`, `settings.tsx`, `_layout.tsx`, `useTimer.ts`, `useHomeData.ts`, `time-entries.ts`, `calendar-blocks.ts`, `planned-blocks.ts`, `SettingsContext.tsx`, `date.ts`, `database.ts`, `RunnerBanner.tsx`.
- Stack confirmed: Expo SDK 54 / RN 0.81 / React 19 / Supabase / expo-router. No test framework. `npm run web` available.
- TypeScript baseline: **1 pre-existing error** (`day.tsx:104` loose `colLeft/colRight` type). Everything else clean.
- Consulted advisor → sequencing: tracking docs → Tier A (clear root cause: #5,#6,#4,#2) → Tier B verify (#3) → Tier C UI (#1,#8,#10) → judgment (#9) → architecture (#7). Don't install Jest (use node --test on extracted helpers). Don't consolidate useHomeData duplication. #9 → remove. #8 → structural fix.

### Root-cause findings
- **#2:** `getEntriesForDate` timezone-naive window drops IST edge entries; Week masks via wide range + `toLocalDateStr` re-bucket + running merge.
- **#3:** Day/Week split renders both parallel columns at later start `topB`; per-entry edit sheet is correct.
- **#4/#5/#6:** Home + top bar use `timer.running[0]` only; Home Now card lacks edit-navigation and omits the task title.
- **#8:** `SheetFrame` unbounded Scroll"+Pressable flex:1" clips bottom.
- **#9:** icon strings rendered as text, never real icons → remove from UI, keep schema.

### Created
- `STATE.md`, `BUGS.md`, `WORKLOG.md`, `TESTS.md`, `debug_screenshots/`.

### 07:45 IST — Tier A functional fixes + #3 (code complete, tsc clean)
- **#2** Added pure helper `src/lib/day-range.ts` (`shiftDate`, `paddedDateRange`, `isOnLocalDay`, `filterByLocalDay`); self-contained (inlined local-date fmt) for `node --test`. Tests `src/lib/__tests__/day-range.test.ts` — **4 pass under TZ=Asia/Kolkata AND TZ=America/New_York** (proves both offset signs). Wired into `time-entries.ts`: `getEntriesForDate` now queries ±1-day-padded window then `filterByLocalDay`; `getEntriesForDateRange` padded ±1 day for Week's local re-bucket; `getRunningTimers` now `.order('start_time')` (deterministic earliest-first).
- **#6** Home Now card now shows task **title** (new `nowTaskName`) above timer, then category + tags.
- **#5** Home Now card primary task wrapped in Pressable → `openEntry()` mirrors `_layout.tsx#openRunningEntry` (same params date/editEntry/focusTs).
- **#4** Home shows `N running` badge + a second compact running-task row (tappable, own elapsed + stop). Top bar `_layout.tsx` shows a running-count badge when >1.
- **#3** Day & Week parallel split rewritten: each running timer renders at its OWN `hourToPx(start_time)` in its half-column (dropped the shared-`topB` head-band that made distinct starts look identical). Also fixed pre-existing `day.tsx:104` type error via `DimensionValue`.
- **tsc --noEmit: 0 errors** (was 1 pre-existing).

### 08:10 IST — Tier C UI + #9 + #7 (code complete, tsc clean)
- **#8** Restructured settings `SheetFrame`: dismiss `Pressable` is now `StyleSheet.absoluteFill` behind the card (was a `flex:1` sibling inside a wrapping `ScrollView` that collapsed the sheet); card keeps `maxHeight:'88%'` with an internal `ScrollView` (`sheetScroll`/`sheetScrollContent`). Fixed/visible header.
- **#9** Removed category icon UI (constant, state, grid, "No icon" meta, subtitle "& icons", styles). Kept nullable `icon` schema column. Decision recorded in BUGS.md.
- **#10** Addressed via the SheetFrame structural fix — all settings sub-sheets share the now-bounded frame.
- **#7** New migration `supabase/migrations/20260530_001_daily_plans.sql` (`daily_plans` + `daily_plan_items`, RLS, partial unique active-plan index). Types in `database.ts`. Service `src/services/daily-plans.ts` with CRUD, `materializePlan`, and a pluggable `PlanGenerator` interface + `generateDailyPlan()` hook for future Claude.ai. No UI wired (per scope).
- **#1** Home header top spacing increased (`index.tsx` paddingTop 18→32).

### 08:25 IST — Visual QA via Expo web + Playwright (dev server already up on :8081)
- **CRITICAL DISCOVERY:** the **Home tab routes to `test3.tsx` ("The Monolith"), not `index.tsx`**. `index.tsx` renders only at cold-start `/`. `test3.tsx` consumes `useHomeData()` (so that hook is NOT dead). My #4/#5/#6/#1 edits initially landed on `index.tsx` (valid for `/`), so I **ported them to `test3.tsx`** too: title (#6), tap-to-edit `openEntry` (#5), `N running` caption + second-task line (#4). Both home screens now fixed; aesthetic preserved.
- Screenshots in `/debug_screenshots`:
  - `01_initial.png` — `/` (index.tsx) home: "2 RUNNING" badge, "Tret" title, second "Yet" row. ✅ #4 #6
  - `02_home_click_opens_edit_5.png` — tapping home task → Edit entry sheet opens; top bar shows "②" badge. ✅ #5 #4
  - `03_day_timeline_2_3.png` — Day shows **"Nigga2" (4:04→5:22am)** + early entries (#2 fixed); two running blocks at distinct start y-positions (#3). ✅
  - `04_settings_categories_sheet_8_9.png` — Categories sheet fully contained, CREATE button visible (no clip, #8); no Icon section (#9). ✅
  - `05_home_test3_4_5_6.png` — real Home (test3): "2 RUNNING", "Tret" title, "Yet" second line. ✅ #4 #6
  - `06_week_intact.png` — Week unbroken; Wed shows Tret(left, higher)/Yet(right, lower) at distinct starts (#3); top bar "②". ✅
- Also verified #5 tap on test3 opens the edit sheet.
- Final: **tsc 0 errors; day-range tests 4/4 pass under both IST and US-Eastern.**

### Status: all 11 objectives addressed. See BUGS.md for per-item status.

### 13:10 IST — Follow-up: migration apply, single home, data cleanup
- **Applied #7 migration to remote DB.** Project linked (ref `iwkiflvwrzfvtpsmhpgd`), logged in via cached access token. `supabase migration list` showed 20260530 local-only → dry-run → `supabase db push` applied it. Re-verified: 20260530 now on Remote. `daily_plans` + `daily_plan_items` live.
- **Single home screen.** Archived old `index.tsx` → `_archive/home-index.tsx.bak` (outside routes dir, `.bak` so tsc/Metro ignore it). Replaced `app/(tabs)/index.tsx` with `<Redirect href="/(tabs)/test3" />`. Updated `app/_layout.tsx` post-login redirect `/(tabs)` → `/(tabs)/test3`. Verified: navigating `/` lands on `/test3` (Monolith). test3 is now the sole home.
- **Cleaned dev data (full clean slate, user-confirmed).** DB is the `test@lifeos.dev` test account — all data synthetic (May 25–27). No raw DB password available (CLI uses token-based login role); pooler-url has no password. Used the **PostgREST API with the browser's authenticated session token** (respects RLS, same path as the app). Soft-deleted (set `deleted_at`, recoverable) ALL 30 time_entries (running ones stopped) + 11 calendar_blocks, scoped `deleted_at=is.null`; categories preserved. Both PATCH → 204. Re-inspect: 0 active rows. App reload shows clean "idle" home (`debug_screenshots/09_clean_slate_home.png`).
- Removed one-off admin scripts; uninstalled transient `pg` (`--no-save`, package.json untouched). **tsc 0 errors.**

### Final status: all objectives + follow-up tasks complete and verified.

### 13:30 IST — Day-view running-block follow-ups
- Home top spacing bumped (`test3.tsx` content `paddingTop` 32→72) — `debug_screenshots/10`.
- **Solo running task now full-width** (`left:0,right:0`); only parallel timers split (now full-width halves `0–50%` / `50–100%`). Was rendering solo at the half-width actuals lane — `11` (before) / `12` (after).
- **Running-block start position fixed:** removed the `nowPx−40` upward floor that made just-started timers look ~40min early; now `top = hourToPx(start_time)` with min height growing DOWNWARD (`height = max(40, nowPx−top)`). Block top now sits at the true start time. (Files: `app/(tabs)/day.tsx`.)
- tsc 0 errors.

### 16:18 IST — Second data wipe (user requested fresh test)
- Cleared a stale Playwright profile lock (killed 7 orphaned `mcp-chrome-765dde3` processes; user's own Chrome untouched), relaunched, grabbed a fresh user JWT.
- Soft-deleted 4 active time_entries (0 calendar_blocks) via PostgREST → 0/0 active. App shows idle home (`debug_screenshots/13`). Recoverable via `deleted_at`.

---

## 2026-05-28 — Insights page redesign (plan-vs-actual)

### Orientation (done)
- Read current `insights.tsx` (660 lines), `computeInsights.ts` (450), services, schema, live DB.
- Key finding: insights passes `blocks=[]` → **zero plan data used today**. Whole plan-vs-actual
  dimension absent.
- Live data: 14 plans (all May 28, mostly future), 15 actuals (May 27→early 28), 0 recurring,
  0 FK links, parallel blocks on BOTH plan and actual sides. ~2 days history. See
  `INSIGHTS_REDESIGN_STATE.md` for the full data-model + constraint write-up.
- Backups: `insights.tsx.bak`, `computeInsights.ts.bak` (no git in repo).
- Created `INSIGHTS_REDESIGN_STATE.md`, `BUGS_OR_GAPS.md`, `TEST_NOTES.md`.
- Advisor consulted: build engine at full power but gate sections behind min-data thresholds;
  lead with N=1-day metrics; sections not tabs; matching → pure module `planVsActual.ts` + tests.

### Implementation (v1)
- **New engine `app/src/lib/planVsActual.ts`** (pure, TZ-independent, epoch-ms). Interval primitives
  (merge/union/sum/intersect/subtract/gaps/clamp) + `computePlanVsActual()` returning untracked,
  overlap, adherence%, per-category planned/actual/matched/shortfall/unplanned, per-block drift
  (done/partial/missed + start drift), and `buildDiagnoses()` plain-language cards. 12 unit tests.
- **`app/src/lib/__tests__/planVsActual.test.ts`** — 12 tests incl. hand-verified scenario. All green.
- **`calendar-blocks.ts:getBlocksInRange()`** — one-shot range fetch + recurrence expansion (Week/Month
  no longer fire per-day requests).
- **Rewrote `app/(tabs)/insights.tsx`** around plan-vs-actual. New section order:
  Diagnosis cards → Overview (Untracked / Plan adherence / Unplanned / Parallel overlap) →
  Plan vs actual (per-cat bars + "also tracked, unplanned" line) → Plan drift table →
  Where the time went (donut w/ two-way row↔segment highlight) → Trend (category + tag dropdowns) →
  Planning calibration (gated ≥3 days) → Consistency (recent-quarter first) → Diagnostics & defs.
  Removed: tracked-hours/full-days/entries hero, week-vs-last bar, day-of-week Patterns, Sessions,
  Milestones.
- Donut row→segment highlight verified in-app (Playwright). Segment→row uses an angle hit-test on a
  wrapping Pressable (real taps populate locationX/Y; works on web+native).
- tsc 0 errors; 16/16 unit tests pass. 0 runtime console errors on the page.
- Backups: `app/src/lib/computeInsights.ts.bak`, `_archive/insights.tsx.prebak`.

### v2 polish (post-review)
- **Untracked now anchored at first-ever entry** (`trackingStartMs` clamp) — Month no longer shows
  "631h (96%) untracked" on a 2-day account; for continuous trackers it reads "0m · all accounted for".
  +1 unit test (17/17 pass). Updated `INFO.overview` tooltip + STATE.md to match.
- Verified Day/Week/Month render with 0 console errors. Other tabs unaffected (only additive
  `getBlocksInRange` added to calendar-blocks.ts).
- Final screenshots: 09_month_top_after_clamp, 10_final_week_top.
