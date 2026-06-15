# Overnight changes — review + test plan (2026-06-15 → 16)

Everything below is committed on `claude-auto` and (where server-side) already deployed to prod. One iOS build was triggered for the native bits — install it, then test.

---

## A. What changed, by area

### 1. Push-to-start Live Activity (Siri/Shortcut, app closed) — now a real feature
**Already proven earlier tonight**: Siri with the app closed writes the DB entry *and* pops a Live Activity (Dynamic Island + Lock Screen), in sync.

This pass finalized it:
- **Local stop** (`app/plugins/LifeOSTrackIntent.swift`): a "stop" Siri command now **ends the Live Activity locally** from the background intent — allowed by iOS (only *starting* from background is forbidden). It matches `Activity.activities` by `attributes.name == entry_id` and calls `.end()`. No push tokens, no "must open the app first" limitation.
- **Start is push-only**: removed the old `Activity.request` attempt in the intent (it always failed silently); the Edge Function's APNs push owns starting. On a "start", the intent ends every *other* activity (so the previous task's card clears) but not the new one.
- **`name = entry_id`** (`supabase/functions/voice-track/apns.ts`, deployed): the push payload tags each activity with its entry id so the stop intent can find it.
- **Dedup on open** (`app/src/lib/liveActivity.ts`, already live via Metro): opening the app no longer creates a duplicate card for a voice entry — those are "push-managed" and skipped by reconcile.
- **Foreground refresh** (`app/app/(tabs)/_layout.tsx`, already live): the app reloads running state on every foreground, so a Siri entry shows immediately instead of staying stale (this was the "showed Commute / took so long" bug).

### 2. Tap behavior on the Live Activity card (needs the new build)
- **Body tap → opens Home** (`lifeos://home` → new route `app/app/home.tsx`).
- **Red STOP button → stops the timer + opens the new-task sheet** (`lifeos://stop-start?entry=…`, unchanged).
- Implemented in `app/plugins/withLiveActivityStopButton.js` by splitting the widget tap targets (body uses `applyWidgetURL`; the STOP button uses a `Link`, so they can differ).

### 3. Dual-task (parallel timers, max 2)
- **Hard cap of 2** was *already* enforced by a DB trigger (`enforce_max_running_timers`) for every path. Confirmed, not changed.
- **Client UX** (`app/app/(tabs)/day.tsx`, live via Metro): the start sheet **hides the "Run alongside" toggle when 2 are already running** and shows _"Max 2 parallel timers running — starting a new one will stop both."_ The submit can't sneak a 3rd past the cap.
- **Home `A | B` split** (`app/app/(tabs)/test3.tsx`, live via Metro): two running tasks now render as **equal halves with a divider**, each with its own live timer; one task keeps the full-width centre stage.

### 4. Deferred (designed, NOT in this build) — 2 timers in ONE Live Activity for the Dynamic Island
The Island shows only one activity at a time, so showing *both* parallel timers in the Island needs a single combined activity (new `ContentState` fields + widget A|B + an update-push pipeline for the app-closed case). It's the riskiest native change and I couldn't visually verify it overnight, so I kept it out to protect the proven push-to-start build. Full design in `DUAL_TASK_PLAN.md` → greenlight and I'll build it next. (Note: the **Lock Screen already stacks both** parallel cards today; it's only the Island that's limited.)

---

## B. Deployed already (no action needed)
- Supabase Edge Function `voice-track` (re-deployed with `name = entry_id`).
- DB: `push_to_start_token` column + `set_push_to_start_token` RPC (migration `20260615_002`), applied earlier. The 2-timer cap trigger pre-existed.

## C. The build
- Triggered on Codemagic for branch `claude-auto`. When it's green I'll attach the `.ipa` (or it's in the chat). Install via diawi (upload the `.ipa` → open its link in Safari → Install).
- JS changes (Home A|B, parallel-toggle UX, dedup, refresh) are also bundled in the build AND hot-reload over Metro — so if you just run `npx expo start` and relaunch, you get them without installing. The **native** changes (local stop, body→Home tap-split) require installing the new build.

---

## D. Test plan

### D1. Dual-task Home A|B (no build needed — Metro)
1. Start a timer (any). Home shows the big single timer. ✅
2. Start a 2nd with **"Run alongside current timer"** checked. Home should now show **A | B** side by side, each counting. ✅
3. Open the start sheet again (2 running): the parallel toggle is **gone**, replaced by the "Max 2…" note. ✅
4. Start a 3rd without parallel → it stops both and starts the new one (1 running). ✅

### D2. Hard cap
1. With 2 running, try via Siri: "parallel \<x\> in LifeOS" → should NOT create a 3rd (DB rejects). Confirm still 2 running.

### D3. Push-to-start + tap-split + stop (needs the new build installed)
1. **Clear** any old Live Activity cards (lock screen, swipe-left → Clear).
2. Install the new build, open it once (loads JS, registers token), then **background it (Home gesture, don't kill)**.
3. "Hey Siri, track gym in LifeOS" → a **Gym** card appears (Island + Lock Screen), app stayed closed. ✅
4. **Tap the card body** → app opens to **Home** (not stop). ✅
5. Background again. "Hey Siri, stop gym in LifeOS" → the **card disappears** (ended locally) and the DB entry stops. ✅
6. Re-start something via Siri, then tap the **red STOP button** on the card → timer stops + new-task sheet opens. ✅
7. Open the app after a Siri start → **only one** card (no duplicate), and the running banner/Home reflect it **immediately**. ✅

### D4. Regression
- Manual in-app start/stop, the Day-view A|B timeline, and the lock-screen STOP button for manually-started timers should all still work.

---

## D5. Status honesty
Only **push-to-START** (D3 steps 1-3) is device-proven from earlier tonight. Everything else here — **stop-by-name (D3.5), tap-split (D3.4/6), dedup (D3.7), and all of dual-task (D1)** — is **implemented + compiles clean but has NOT run on a device yet.** This test plan is what promotes them from "implemented" to "working."

## E. Watch-outs (things only the device can confirm)

- **The stop linchpin (most likely failure point):** app-closed stop assumes the freshly-woken background intent process can *enumerate* `Activity.activities` and see the push-started card. "Ending from background is allowed" is confirmed; "the woken intent can *see* the push-started activity" is the untested hinge. **If D3-step-5 shows the card NOT disappearing, that enumeration is the cause** — not the `.end()` call or the `name` match. (Workaround if so: have the Edge Function send an `end` push instead — needs the per-activity token pipeline.)

### Known gaps the dedup introduced (edge cases — not tonight's scope, just so they're not surprises)
- **Siri command that fails the network (offline):** it falls back to the local queue; on next open, the entry is written *with* a `command_id`, so reconcile now **skips** starting a card — but no push ever fired either, so that one entry gets **no Live Activity** until something restarts it. Narrow (Siri-offline only), but a real regression in the degraded path vs. before dedup.
- **Voice "stop" of a *manually*-started card while app-closed:** in-app starts hardcode `name="ExpoLiveActivity"`, so the intent's `name==entry_id` match won't find them → that card **lingers** until the app opens and reconcile cleans it. Self-heals on open.

### Other watch-outs
- **Lock-screen body vs STOP-button tap separation** is an iOS-17+ behavior; on iOS 26 it should work, but if a body tap ever triggers stop (or vice-versa) on the **Lock Screen specifically**, that's the thing to report — the Dynamic Island expanded view is where the separate `Link` is most reliable.
- `lifeos://home` should land on the Home tab; if it dead-ends, the route `app/home.tsx` may need a tweak.
- A Siri "stop" only ends the card if the activity's `name` is the entry id — which is true for cards started **after** this Edge Function deploy. Old test cards won't match (clear them).
