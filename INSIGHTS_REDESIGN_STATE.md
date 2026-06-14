# Insights Redesign — State

_Last updated: 2026-05-28 (session start). Owner: Claude Code (orchestrator)._

## Goal (GSD outcome)
Turn the Insights page from a generic tracked-time dashboard into a **plan-vs-actual
behaviour coach**. The page must answer: where did my day/week drift from plan, which
categories I consistently under/over-do, how much was untracked, how much actual work
was unplanned, which planned blocks were missed/late/shortened, and what to change.

Scope is **only** the Insights tab + any new helper modules/components for it. Do NOT
redesign other pages.

## Tech / repo facts
- React Native + Expo (SDK 56, web target via Metro on :8081), TypeScript, Supabase.
- Charts are **hand-rolled** with `react-native-svg` + Views. No chart lib. Keep that.
- **No git** in this repo → backups made: `insights.tsx.bak`, `computeInsights.ts.bak`.
- Theme tokens in `src/theme/tokens.ts` (`fonts`, color roles via `useSettings().colors`).
- Timezone: IST (UTC+5:30). Local-day bucketing matters.

## Data model (verified against live DB 2026-05-28)
- **PLAN = `calendar_blocks`**: `{date (LOCAL ist date), start_time/end_time (timestamptz),
  category_id, title, tags text[], recurrence}`. Recurrence expanded via
  `calendar-blocks.ts:expandRecurrence`. `daily_plans`/`daily_plan_items` exist but **no UI
  consumes them** — ignore for insights.
- **ACTUAL = `time_entries`**: `{start_time, end_time(null=running), category_id, tags text[],
  is_running, calendar_block_id}`.
- **`calendar_block_id` is ALWAYS null** — timers never link to plans. → plan↔actual matching
  must be **heuristic** (category + time overlap within a local day).
- Categories carry `kind: 'essential' | 'discretionary'` and `color`. Tags are scoped per category.
- `calendar_blocks.date` already equals the LOCAL IST date (saw date=2026-05-29 w/ start 18:30Z).
  → bucket plans by `date`; do overlap math in epoch ms.

## Live data volume (THE binding constraint)
- 11 categories, **14 calendar_blocks, 15 time_entries**, 0 recurring, 0 FK-linked.
- ~2 days of history (May 27–28, 2026). Now ≈ 06:13 IST May 28.
- **Plans and actuals barely overlap**: all plans are for May 28 (mostly FUTURE — it's 06:13);
  all actuals are May 27 → early May 28. May 27 had **no plan**. Today's Sleep plan (03:00–13:00)
  is being violated live (user is doing Study).
- **Parallel/overlapping PLANS exist** (2× Study 16:00–17:00; Study+Watching 21:00–23:00) → the
  plan side also needs union math, not just sums.

### Design consequences
1. Build the compute engine at full power (pure, period-agnostic) BUT gate each visible section
   behind a **min-data threshold**; below it show an honest empty state, never a fake small number.
2. Lead with metrics that work at **N=1 day**: today's plan-vs-actual by category, untracked time,
   missed/late blocks, start-time drift, unplanned actual.
3. Only judge adherence for the **elapsed** portion of the period (ignore future blocks).
4. Multi-week calibration / day-of-week patterns: **hide until enough days exist** (≥7).
5. Default period: **Week** (more overlap), but everything must be correct at Day too.

## Untracked-time definition (IMPLEMENTED)
`untrackedMs = elapsedMs − unionMs(actual ∩ window)` where
`elapsedMs = winEnd − max(winStart, firstEverEntryMs)`.
The `firstEverEntryMs` (trackingStart) clamp was added after seeing Month show a useless
"631h (96%) untracked" on a 2-day-old account — pre-adoption time isn't "untracked", the user
just wasn't using the app. So untracked = "time with no entry, since you started tracking."
Established users are unaffected (their trackingStart ≪ winStart). Parallel/overlapping entries
merged via union so it never goes negative. Do NOT subtract planned sleep/blocked time — sleep is
just a category. Tooltip in `INFO.overview` reflects this. For this user (continuous tracking) it
reads 0m → subtitle shows "all accounted for".

## Architecture decision
- New pure module **`src/lib/planVsActual.ts`** holds all matching/union math + unit tests
  (model after `src/lib/__tests__/day-range.test.ts`). `computeInsights.ts` stays for the
  tracked-time stats we keep.
- New service to fetch blocks for insights (range) — reuse `calendar-blocks.ts`.
- Page stays **single scroll with sections** (NOT tabs) to avoid introducing a nav pattern the
  rest of the app doesn't use. Re-evaluate tabs only if it gets too long.

## Planned page structure (sections, top→bottom)
1. **Overview** — Untracked time, Plan adherence %, Unplanned actual, Missed planned, Overlap.
2. **Plan vs Actual** — planned vs actual by category (diverging bars), drift table (missed/late/short).
3. **Calibration** — over/under-planned categories + completion ratio (gated ≥3 days).
4. **Trends** — category+tag dropdown trend chart (keep, improve); consistency recent-first.
5. **Diagnostics** — overlap/parallel impact, untracked breakdown, data-quality warnings, metric defs.
6. **Diagnosis cards** — 3–5 plain-language statements derived from real data (the payoff).

## User's explicit asks (checklist)
- [ ] Remove tracked-hours headline; show **untracked** instead (union-based).
- [ ] Remove "entries" count headline.
- [ ] Reconsider/remove "full days".
- [ ] Remove week-vs-last-week total bar.
- [ ] Donut↔row two-way highlight (click row dulls other segments; click segment selects row).
- [ ] Time-chart row: category dropdown + tag dropdown filters.
- [ ] Consistency: most-recent quarter FIRST.
- [ ] Pattern chart: make actionable or remove.
- [ ] Fonts were "too small / illegible" — bump legibility.
- [ ] Plan-vs-actual is the main new direction (sections A–F in brief).

## Open questions / assumptions
- Matching window for "unplanned actual": an actual is "planned" if a same-category plan block
  overlaps it (within the day). Tag match is a secondary signal, not required.
- Start-drift: match each elapsed plan block to the nearest same-category actual that starts within
  ±90 min; drift = actualStart − plannedStart.
