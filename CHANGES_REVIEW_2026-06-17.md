# Changes Review — Action Areas A & B (2026-06-17)

Goal was "Complete A and B" from the flow review. Done: **A1, A2, A3, B5, B6, B7**.
Deferred (bespoke Swift, stated below): **A4, B8**.

All TypeScript typechecks clean (`npx tsc --noEmit`, exit 0). There is no test
harness in this project, so typecheck is the verification floor — **the UI/UX
itself is unverified until you run the new build on device.**

---

## What changed (per commit on `claude-auto`)

### A1 — Review queue  *(JS only, hot-reload)*
- New `/review` screen: every `review`-tagged entry (running + completed), newest first.
- Each row → Edit (opens Day edit sheet) or "✓ Reviewed" (clears the tag, one tap, optimistic).
- Home shows an "N entries need review →" pill when count > 0.
- Files: `app/app/review.tsx`, `test3.tsx`, `useHomeData.ts`, `time-entries.ts`
  (`getEntriesNeedingReview`, `clearReviewTag`).

### A2 — Runaway-timer guard  *(NEW NATIVE DEP — needs rebuild)*
- Added `expo-notifications ~0.32.17` + plugin in `app.json`.
- Schedules a LOCAL notification at start + 6h for each running timer; fires even
  when the app is closed; cancelled on stop. Reconciled from the tab root.
- Files: `app/src/lib/runawayNotify.ts`, `(tabs)/_layout.tsx`, `app.json`, `package.json`.

### A3 — Siri-offline / push-failure → missing Live Activity  *(server deployed + client gate)*
- DB: `push_started_at timestamptz` on `time_entries` (migration `20260617_001`, **applied to prod**).
- Edge Function `voice-track`: stamps `push_started_at` after a successful APNs push (**redeployed to prod**).
- Client: `reconcileLiveActivities` starts a local fallback card for a `command_id`
  voice entry only when `push_started_at` is null.
- Safe for the CURRENT app (nullable column it ignores; new gate activates only with the new build).
- Files: `supabase/migrations/20260617_001_push_started_at.sql`, `voice-track/index.ts`,
  `app/src/types/database.ts`, `app/src/lib/liveActivity.ts`.

### B5 — Undo delete  *(JS only)*
- 5-second bottom toast with UNDO after deleting an entry or block in Day view.
- Soft-delete already set `deleted_at`; `restoreEntry`/`restoreBlock` clear it.
- Files: `app/src/components/UndoToast.tsx`, `(tabs)/day.tsx`, `time-entries.ts`, `calendar-blocks.ts`.

### B6 — Global search + category filter  *(JS only)*
- New `/search` screen: debounced title search across all days + category-filter chip row.
- Tap a result → edit it in Day view. Reached via a magnifier in the Insights header.
- Files: `app/app/search.tsx`, `(tabs)/insights.tsx`, `time-entries.ts` (`searchEntries`).

### B7 — Empty state
- Insights shows "No time tracked yet" instead of an all-zeros dashboard for new users.
- Scoped to Insights (the one that looked broken); Home already has an idle state.
  Day's empty 24h grid + FAB is self-explanatory and the timeline is a virtualized
  multi-day component — left untouched to avoid risk. File: `(tabs)/insights.tsx`.

---

## How to test (after the new build installs)

> Reinstalling rotates the push-to-start token — **open the app once after install** before Siri tests.

1. **Review queue**: make a Siri/voice entry (gets `review` tag) → Home shows the pill →
   tap it → list shows the entry → "✓ Reviewed" removes it; "Edit" opens the sheet.
2. **Undo delete**: Day view → open an entry → Delete → toast appears → UNDO restores it;
   wait 5s → toast disappears and the delete stands. Repeat for a calendar block.
3. **Search**: Insights → magnifier → type part of a title → results filter live;
   tap a category chip to filter; tap a result → opens it in Day for editing.
4. **Insights empty state**: a fresh account with no entries shows the prompt (or temporarily
   verify by reasoning — once you have data it won't show).
5. **Runaway timer** (the one that needs care): start a timer; grant the notification
   permission prompt. To verify quickly without waiting 6h, temporarily lower
   `RUNAWAY_HOURS` in `runawayNotify.ts` to e.g. `0.02` (~1 min), rebuild, start a timer,
   lock the phone → notification should fire; stopping the timer cancels a pending one.
   **Reset it back to 6 before shipping.**
6. **Siri-offline fallback**: turn on Airplane Mode → "Hey Siri, Track …" (command queues) →
   turn data back on → open the app → a Live Activity card should now appear for that entry,
   and there should be NO duplicate for a normal online Siri start.

---

## Deferred (need bespoke Swift + a device — not written this session)

- **A4 — voice-stopping a manually-started card while the app is closed leaves it lingering.**
  Root cause confirmed: `expo-live-activity`'s `startActivity` has no `name` parameter, so
  RN-started cards get the library's fixed attribute name, while the native StopIntent ends
  activities by `attributes.name == entry_id`. Fixing it means changing the native side
  (set the activity name to the entry id, or change how the StopIntent matches). Bespoke Swift.
- **B8 — two parallel timers in ONE Live Activity for the Dynamic Island.**
  Designed in `DUAL_TASK_PLAN.md`; you put it on hold earlier. It is the largest native item
  (combined ContentState + widget A|B + update-push). Left on hold — say the word and I'll build it.

---

## Known limitations
- **A2 false positive**: the runaway notification is cancelled only by
  `reconcileRunawayNotifications`, which runs when the app is open. If you stop a
  timer **via Siri while the app stays closed** and don't reopen within 6h, the
  runaway notification still fires for an already-stopped timer. Inherent to a
  local-only schedule (no background task to re-check the DB at fire time);
  cancelling from the native stop intent would be bespoke Swift (same bucket as A4).

## Notes
- Prod changes made autonomously this session: migration `20260617_001` applied; `voice-track`
  redeployed. Both safe for the live app.
- Reminder: rotate the Codemagic API token when convenient (was pasted in chat previously).
