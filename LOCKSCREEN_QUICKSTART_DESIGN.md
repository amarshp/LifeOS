# Design: Start a Task Without Unlocking (Lock-Screen Quick Start + Siri)

_Status: DESIGN — not yet implemented. Last updated 2026-06-14._

## Goal
Start a time entry **without unlocking the phone**, two ways:
1. **Quick-start buttons** — top tasks by historic use at the current time-of-day (same ranking as the Home quick-start chips, `getCategoryUsageNearHour`).
2. **Siri voice** — "start a Gym timer in LifeOS" → starts any task by name.

## Hard iOS constraints (shape everything)
- **No arbitrary picker / text field / custom menu on the lock screen.** No "hold → type/pick any task" popup. Selection without unlock = **predefined buttons** or **Siri voice** only.
- **While locked/unopened the RN+Supabase JS never runs.** Whatever happens on tap must be done by **native Swift**.
- A button/intent must run in the **background** (`openAppWhenRun = false`). Opening the app forces Face ID → defeats the goal.

## Core design choice: capture locally, sync on open (NOT native Supabase)
The goal is *capture* ("log this entry now"), not *write-to-server-this-instant*. So the intent does the **minimum reliably possible while locked: a local write.**

```
Locked (native, background)                 App opens (RN)
───────────────────────────                 ──────────────
Intent.perform():                           on foreground:
  append to App Group queue:                  • drain queue
   {action:'start', categoryId,               • for each: call start_timer_stop_previous
    title, tappedAt}                            with start_time backdated to tappedAt
  (trivial local write, returns fast)         • reconcileLiveActivities()
```

Why this is the right spine:
- **Deletes the riskiest half** of a native build: no shared-Keychain Supabase token, no native REST client, no token refresh in Swift (Supabase rotates refresh tokens — an extension refreshing would silently log the app out; avoided entirely).
- A local UserDefaults write is exactly what an intent *can* do reliably in its ~few-second background budget.
- The entry lands with the correct timestamp (`tappedAt`), synced on next open. For a single-device personal tracker, "server knows this instant" has no real value.
- The count-up Live Activity ticks via `Text(timerInterval:)` on its own — so even future "live status while locked" needs native **Live Activity start**, NOT native Supabase.

## Components
1. **App Group** `group.com.pedapatiamarsh.lifeos` — entitlement on app + widget/intent extension; shared container.
2. **RN → App Group sync** (app open / foreground / hourly): write `quickTasks` = top-N from `getCategoryUsageNearHour` `[{categoryId,title,colorHex}]`, plus all categories (for Siri name matching). No secrets.
3. **App Group → RN queue:** intents append start-commands; RN drains + clears on foreground.
4. **App Intents** (one Swift file in app + extension targets), all `openAppWhenRun = false`:
   - `StartTaskIntent(categoryId, title)` — buttons.
   - `RepeatLastTaskIntent`.
   - `StartNamedTaskIntent(task)` — Siri; `@Parameter` resolved from categories in App Group; exposed via `AppShortcutsProvider` ("Start \(.$task) in LifeOS").
5. **Widget (WidgetKit, iOS 17+ interactive):** Home-Screen medium widget ≈ **4 buttons**; lock-screen accessory ≈ **1–2** (tiny). Buttons = `Button(intent: StartTaskIntent(...))`, labels/colors from App Group.
6. **Siri / App Shortcuts:** the real "pick any task without unlocking" — voice, works locked.

## Reuse (don't rebuild)
- `getCategoryUsageNearHour` — top tasks (RN).
- `start_timer_stop_previous` RPC — RN replays the queue through it (backdated).
- `reconcileLiveActivities` — Live Activity sync on open.

## Phased plan
- **Phase 0 — SPIKE (one build, do first).** Prove the single true unknown: *does a background App Intent run while the phone is locked without forcing Face ID?* Build ONE hardcoded `StartNamedTaskIntent` + `AppShortcutsProvider` whose `perform()` only writes a timestamp to the App Group. EAS build → "Hey Siri, start X" while locked → open app, confirm the timestamp landed. If yes, approach proven. If no, we stop before investing.
- **Phase A — Siri capture (local queue).** RN↔App Group sync + queue drain + `StartNamedTaskIntent` real (categoryId/title). "Hey Siri, start Gym in LifeOS" while locked → entry recorded (synced on open).
- **Phase B — Quick-start buttons.** Home widget (4) + lock accessory (1–2) + `StartTaskIntent`/`RepeatLastTaskIntent`.
- **Phase C — Live status while locked (optional, hardest).** Native Live Activity *start* from the intent so the count-up shows before opening the app (needs the `ActivityAttributes` type — fork/extend expo-live-activity or own widget). Still no native Supabase.
- **Phase D — (only if ever needed) instant server write.** Native Supabase + shared Keychain token + refresh-rotation handling. Not recommended unless multi-device sync demands it.

## Risks / to confirm
- **R1 (spike answers this):** background intent executes while locked without Face ID; `authenticationPolicy` and Siri parameter-resolution-while-locked behavior — **to be confirmed empirically by Phase 0**, not assumed.
- **R2:** lock-screen widget button count is small (~2); home widget fits 4. Set expectations.
- **R3:** intent background budget is a few seconds — local write only (the whole reason we avoid native network).
- **R4:** native build is blind on Windows (~15–20 min/iteration) — stage tightly; Phase 0 is the cheap proof.
- **R5 (only if Phase D):** Supabase refresh-token rotation can silently log the app out if both RN and the extension refresh — avoided by the local-queue spine.

## Not possible / out of scope
- Free-text or arbitrary on-screen task picker on the lock screen.
- Editing tags/notes without unlocking.
