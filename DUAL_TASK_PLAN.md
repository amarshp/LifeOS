# Dual-task (parallel timers) — design + status

_Authored 2026-06-16 (overnight autonomous work). Owner handoff doc._

## Goal
Make running **two tasks at once** a first-class, elegant experience, with a **hard cap of 2**.

## What the app already had
- DB **hard cap of 2** running timers: trigger `enforce_max_running_timers` → `check_max_running_timers()` raises `Maximum 2 parallel timers allowed` on a 3rd insert/update. Enforced for **all** paths (in-app insert, voice RPC, resume). ✅ already correct — no change needed.
- `useTimer`: `start()` (stops all, starts one), `startParallel()` (inserts alongside), `stop`, `stopAll`, `refresh`. Elapsed tracked per entry id.
- Home (`test3.tsx`): showed running[0] big + running[1] as a small line below.
- Day view: already renders 2 running timers as left/right halves.
- Parallel is opt-in via a checkbox ("Run alongside current timer") in the start sheet.

## Decisions made (this pass)

### 1. Hard 2-task limit — client UX (DB already enforces)
The DB rejects a 3rd; the app now communicates it instead of surfacing a raw error:
- The **parallel checkbox** in the start sheet is **hidden** when 2 are already running, replaced by: _"Max 2 parallel timers running — starting a new one will stop both."_
- The submit path forces non-parallel when `runningCount >= 2` (belt-and-suspenders against a stale checkbox state).
- Rationale: at 2 running, the only valid new action is a normal start (which stops both). Hiding the toggle makes the cap legible rather than a failure.

### 2. Home `A | B` split (the requested UI)
`test3.tsx` now branches on running count:
- **1 task** → unchanged full-width centre stage (68px timer).
- **2 tasks** → equal halves with a vertical divider: each half shows its own elapsed timer (40px, auto-shrinks), dot + title, and category. `"    A    "` → `"  A | B "`.
- Removed the old "small second line below" + the "N running" label (the split is self-evident).
- Tapping either half opens that entry in edit mode (unchanged behavior, now per-half).

### 3. Banner (other tabs) — intentionally unchanged
Re-read of the ask: _"2 timers in the live status — for notifications and for island"_ refers to the **Live Activity** (lock screen + Dynamic Island), not the in-app top banner. The banner keeps showing the primary entry + a count badge (it has a single STOP affordance that doesn't map cleanly to 2 tasks). Revisit if you want the A|B treatment there too.

## DEFERRED (designed, not built) — Live Activity showing 2 timers

This is the one piece **not** in tonight's build, on purpose — it's the riskiest native change and I can't visually test it overnight; shipping it blind could break the proven push-to-start features in the same build. Greenlight after validating the rest and I'll build it next.

**The Apple constraint:** the Dynamic Island shows **one** Live Activity at a time. Two separate activities (today's model for 2 parallel) → the Lock Screen stacks both cards (so "2 in notifications" already works), but the **Island only shows the most recent**. To show **both in the Island**, both timers must live in **one** activity.

**Recommended design (one combined activity):**
- Extend `ContentState` with a secondary task: `title2`, `elapsedTimerStartDateInMilliseconds2` (mirror in the pod copy + widget copy — both must match for Codable).
- Widget renders `A | B` in the Lock Screen view, the Dynamic Island expanded (two regions), and a compact/minimal fallback (likely show the primary, or both as tiny stacked timers).
- **Lifecycle (the hard part):**
  - 1 task → single-task content (as today).
  - 2nd parallel starts → must **update the existing activity** to the 2-task content (not start a 2nd activity).
  - In-app: trivial (RN has the activity id, calls `updateActivity`).
  - App-closed (voice): needs an **update push** to that activity's per-activity push token → re-introduces the token-capture pipeline (capture `onTokenReceived` keyed by `name`/entry id, store in DB, Edge Function sends `event:"update"`). This is why it's a separate sub-project.
- Stopping one of two → update back to single-task content for the survivor; stopping both → end.

**Alternative (cheaper, partial):** keep 2 separate activities. Lock Screen already shows both; accept the Island showing only the most recent. Zero native ContentState change. Good enough if the Island-both requirement is soft.

## Files touched (dual-task, this pass)
- `app/app/(tabs)/test3.tsx` — Home A|B split + styles.
- `app/app/(tabs)/day.tsx` — `runningCount` prop → parallel toggle gated at 2 + submit guard.
- (DB limit already existed — no migration.)

## Test plan → see `CHANGES_REVIEW.md`.
