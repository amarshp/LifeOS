# Day-View Zoom — Fix Plan

_Status: PLAN — not implemented. Last updated 2026-06-14._

## Symptoms (from device)
- Pinch **stretches** the content mid-gesture (text distorts).
- On release, a **3–4s freeze** before the new zoom appears.

## Root cause (measured)
The timeline renders **every node in the whole scrolled range** and re-lays-out all of them whenever zoom (hour height) changes.
- The scroll window **grows unbounded** (`handleTimelineScroll` extends ±3 days at each edge, never trims) → after browsing, 10–20+ days are mounted.
- Per day it renders grid lines + hour labels from `createTimelineTicks`. At high zoom `gridMinutes = 5` → **288 grid lines/day**. 11 days ≈ **3,000+ absolute Views**, plus blocks/entries.
- Changing zoom recomputes `top`/`height` on all of them → React relayout of thousands of nodes = the 3–4s freeze.
- The old per-frame `setZoom` spread that cost across frames → the original "lag"; my transform approach deferred it into one freeze + stretched (scaling pixels ≠ relayout).

**So: smooth + crisp zoom is impossible until the node count is small. Everything else follows from that.**

## How Teams/Outlook actually do it
Not continuous pinch — they use a **discrete "time scale"** (60/30/15/10/5-min increments) and smooth scrolling; "zoom" = change the increment. Crisp because each level is a normal, cheap layout. Google Calendar *does* continuous pinch — it works because their day grid is virtualized (few nodes), so per-frame relayout is cheap.

Takeaway: **either model is fine once nodes are few.** Discrete snap is the simplest path to "premium + crisp".

## Plan

### Step 0 — Validate the baseline first (do before building anything)
The 3–4s freeze was measured with the (now-reverted) transform zoom **and** the sticky-title per-block `scrollY.interpolate` both active — recreating dozens of Animated nodes on one synchronous commit is itself a freeze suspect. A plain relayout of a few hundred views shouldn't take 3–4s. So: **reload the reverted build and report how zoom feels now.**
- Still frozen → node-count confirmed, do full virtualization.
- Just laggy → smaller problem; the window-cap alone may fix it.

### Phase 1 — Virtualize the timeline (required; the actual fix)
Cut mounted nodes from thousands to ~one screenful.
1. **Bound the day window.** Stop growing forever. Keep a small mounted set (e.g. current day ±1) and recenter on scroll instead of accumulating. (Or render only days intersecting the viewport ±1 buffer.)
2. **Virtualize ticks vertically.** Only render grid lines/labels whose `top` is within `[scrollY − pad, scrollY + viewportH + pad]`, not all 288/day. Recompute the slice on scroll (cheap; scroll already tracked).
3. **`React.memo` the block/entry items** so unchanged ones skip re-render (lanes already memoized).
- Result: a zoom relayout touches ~dozens of nodes, not thousands → **commit becomes instant**, which removes both the freeze and the lag — even with the *current* continuous zoom.

### Phase 2 — Zoom interaction (pick the model; do after Phase 1)
- **Option A — Discrete snap (Teams-style, recommended).** Pinch maps to the nearest of ~5 preset hour-heights (aligned to the existing `getTimelineGranularity` breakpoints). During the pinch show a light live transform for feedback, then **snap+relayout to the level on release** (instant now that nodes are few). Always crisp, never half-stretched. Predictable, premium.
- **Option B — Continuous (Google-style).** Drive hour-height on the UI thread via Reanimated (already in the app) and relayout continuously. Smoother infinitely-variable zoom, but more moving parts and only worth it if discrete feels too "steppy".

Recommendation: **Phase 1, then Option A.** Re-evaluate Option B only if you want infinitely-smooth continuous after feeling the discrete snap.

### Not recommended — migrate to @howljs/calendar-kit
It's already a dependency and has virtualization + zoom built in, but the day view's bespoke **plan-vs-actual lanes, drag-to-reschedule, long-press-to-add, parallel running timers, sticky title** would have to be rebuilt on top of it. High risk of feature loss for a perf win we can get by virtualizing our own view.

## Risks
- Virtualizing while preserving drag, long-press-to-add (px↔time math), cross-midnight blocks, the now-line, and infinite scroll needs care — these all read absolute `top`. The math stays; only *which* nodes mount changes.
- Re-introducing sticky title (#3) later should ride on the same scroll value used for tick virtualization.
- Blind on Windows, but reload-testable over the tunnel — tight iterate loop.

## Test
Pinch at low and high zoom on a day with many blocks; scroll far then pinch (was the worst case); confirm: no stretch, no freeze, crisp text, focal point stable. Then drag a block, long-press to add, cross-midnight block, now-line — all still correct.
