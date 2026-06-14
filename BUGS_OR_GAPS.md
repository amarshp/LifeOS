# Insights Redesign — Bugs / Gaps

Status legend: 🔴 open · 🟡 in progress · 🟢 fixed/handled · ⚪ won't-fix (with reason)

## Found during orientation (2026-05-28)
- 🟢 **Insights ignores plans entirely.** `insights.tsx:333` calls
  `computeInsights(entries, categories, [], …)` — the `blocks` param is always `[]`. The whole
  plan-vs-actual dimension is dead. → being addressed by this redesign.
- 🟢 **Misleading headline metrics** — hero (tracked/full-days/entries) + week-vs-last bar REMOVED;
  replaced by Untracked / Plan adherence / Unplanned / Parallel-overlap (all union-based).
- 🟢 **Donut linking** — row→segment highlight (dims others, center shows category) verified in-app;
  segment→row via angle hit-test on wrapping Pressable. Solves "can't tell which colour is what".
- 🟢 **Consistency heatmap** — now most-recent-quarter first (`.reverse()`).
- 🟢 **Pattern chart** — removed; replaced by actionable diagnosis cards + plan-vs-actual.
- 🟢 **Fonts** — bumped label/value sizes across new sections (labels 13.5–15, stat values 27).

## Data-quality gaps (inherent, surface as warnings, don't fake around)
- ⚪ **No FK link plan→actual** (`calendar_block_id` null) → matching is heuristic; a same-category
  plan + actual in the same window are *assumed* to be the same intent. Surface this in Diagnostics.
- ⚪ **Plans & actuals on different days** in current data → adherence is sparse; honest empty states.
- 🔴 **Future plan blocks** must be excluded from "missed" until their time has elapsed.

## Introduced during implementation
- 🟢 `onPress`/`onPressIn` on react-native-svg `<Circle>` is rejected on web (7 console errors).
  Fixed by moving the tap handler to a `Pressable` wrapping the donut + angle hit-test. 0 errors now.
- 🟡 Segment→row tap could not be exercised via synthetic DOM events (RN web responder system
  ignores them). Row→segment is verified; segment→row trusted via RN conventions. Re-verify on a
  real tap/device when convenient.

## Remaining / watch
- 🟡 With sparse data, Day/Week show several strong-negative diagnosis cards at once (Sleep deficit +
  Mostly off-plan). Accurate but could feel piling-on; revisit thresholds once more data exists.
- 🟡 Week-level "Untracked" is large (includes untracked nights/empty days). Honest per locked
  definition + tooltip; Day view is where it's most actionable.
