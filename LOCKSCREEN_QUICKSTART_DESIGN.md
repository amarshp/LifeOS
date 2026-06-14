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

## Siri command grammar (trigger word: "track")
Resolve a spoken task string + a leading modifier word into one of three actions. RN matches the spoken text to a category/recent-title by keyword (fuzzy, case-insensitive); for "stop", match against currently *running* timers.

| Phrase | Action | Rule |
|---|---|---|
| "track \<task>" | start, auto-stop previous | single mode |
| "track parallel \<task>" | start alongside | no stop; reject if already 2 running (DB trigger enforces max 2) |
| "track stop \<task>" | stop the running timer whose title matches \<task> | others keep running |

- **Every "track" start adds a `review` tag** (Siri entries are quick capture → review later).
- Likely 3 AppShortcut phrasings → 3 intents (`TrackIntent`, `TrackParallelIntent`, `TrackStopIntent`), each with a free-form String `@Parameter`. Keyword→task matching happens in RN on queue drain (native stays dumb).
- Running timers + categories are synced RN→App Group so "stop \<name>" matching has data (even though resolution happens on open in the local-queue model).

## Live Activity content requirements
- **Parallel:** show both running timers (max 2). Current `reconcileLiveActivities` already starts one activity per running entry — likely works; verify with 2.
- **Next planned task:** show the next upcoming `calendar_block` today — **name + when / how-long-until** it starts. No tags, names only.
- These are **app-driven content** (RN sets Live Activity state). Putting "next: \<name> in \<2h>" into the activity subtitle is JS-only; a distinct styled row would need a widget-layout change (native, rebuild).

## Reuse (don't rebuild)
- `getCategoryUsageNearHour` — top tasks (RN).
- `start_timer_stop_previous` RPC — RN replays the queue through it (backdated).
- `reconcileLiveActivities` — Live Activity sync on open.

## Phased plan
- **Phase 1 — Live status content (quick, JS-mostly, do now).** Verify 2 parallel render; add next-planned task (name + countdown) to the activity. No Siri, no new native target. Fast win the user asked for.
- **Phase 0 — SPIKE (one build, do before any Siri work).** Prove the single true unknown: *does a background App Intent run while the phone is locked without forcing Face ID?* ONE hardcoded `TrackIntent` + `AppShortcutsProvider` whose `perform()` only writes a timestamp to the App Group. EAS build → "track test" to Siri while locked → open app, confirm the timestamp landed. If yes, approach proven. If no, stop.
- **Phase A — Siri capture (local queue).** RN↔App Group sync (running timers + categories) + queue drain + the 3 intents (`TrackIntent`/`TrackParallelIntent`/`TrackStopIntent`) with keyword matching + auto `review` tag. Commands recorded while locked; **live status updates on next app open** (local-queue model).
- **Phase B — Quick-start buttons.** Home widget (4) + lock accessory (1–2) + `StartTaskIntent`/`RepeatLastTaskIntent`.
- **Phase C — Live status changes WHILE locked (hardest, optional).** Native drives Live Activities from the intent so "track stop commute" / "track parallel X" reflect on the locked screen immediately (needs the `ActivityAttributes` type — fork/extend expo-live-activity or own widget). Still no native Supabase.
- **Phase D — (only if ever needed) instant server write.** Native Supabase + shared Keychain token + refresh-rotation handling. Not recommended for single-device.

### Decision that gates scope
Do Siri commands need to update the **locked screen immediately** (Phase C), or is "recorded now, live status refreshes when you open the app" (Phase A) acceptable? A→ much smaller; C→ the big native bet.

## Risks / to confirm
- **R1 (spike answers this):** background intent executes while locked without Face ID; `authenticationPolicy` and Siri parameter-resolution-while-locked behavior — **to be confirmed empirically by Phase 0**, not assumed.
- **R2:** lock-screen widget button count is small (~2); home widget fits 4. Set expectations.
- **R3:** intent background budget is a few seconds — local write only (the whole reason we avoid native network).
- **R4:** native build is blind on Windows (~15–20 min/iteration) — stage tightly; Phase 0 is the cheap proof.
- **R5 (only if Phase D):** Supabase refresh-token rotation can silently log the app out if both RN and the extension refresh — avoided by the local-queue spine.

## Not possible / out of scope
- Free-text or arbitrary on-screen task picker on the lock screen.
- Editing tags/notes without unlocking.
