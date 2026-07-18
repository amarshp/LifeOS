# LifeOS Features

## UX Redesign v3 — ✅ SHIPPED 2026-07-04 (all phases in source; needs new IPA for device)

### One reality (single timer by default)
- `allowParallelTimers` server setting (Settings → Advanced → "Simultaneous timers", default OFF) enforced BELOW the UI: DB cap trigger (1, or 2 when on), voice path downgrades "parallel …"/"also …" to a clean switch, agent auto-switches, capture sheet hides the parallel checkbox
- Atomic switch everywhere: starting anything stops the previous timer at that instant (gap-free timeline); agent `start_timer` does the same and completes linked tasks

### Capture-first sheet
- Mode chooser removed — context infers it: gap tap → Log past (range fixed), past date → Log past (noon default), today → Start now; quiet "…instead" links keep other modes reachable
- Title-first ("What are you doing?"); category inferred from title keyword, else most-used-for-this-hour; task/category/tags/notes/start-time behind one More options disclosure

### Navigation: Now / Day·Tasks / Agent
- Now (evolved Home): bell → Notification Center, gear → Settings, tracking-gap card ("2h 1m untracked since 10:29 — Fill it in →") and plan-drift card (→ Agent replan), at most one at a time
- Day·Tasks: one tab, big serif segmented header (separate routes preserved); insights glyph in the header; Day view has a Timeline ↔ List toggle (ghost button above the FAB) — Toggl-style fixed-height rows, sub-minute entries visible, dashed tappable gap rows, sticky preference
- Week stays parked; Insights/Settings/Tasks remain as routes off the tab bar

### Notifications v1 (local — fire with the app killed)
- Derived reminders: plan blocks (1–3 lead-time offsets), task deadlines (own offsets), plan-tomorrow nudge (set time), reconciled into a rolling 48h window of local notifications on foreground/focus/prefs change
- Direct reminders: agent tools `add_reminder`/`cancel_reminder` ("remind me to call mom at 5"), Notification Center (/notifications) shows the whole upcoming queue with cancel
- Settings → 04 Notifications: toggles, cycling lead-time presets, nudge time, quiet hours
- Auto-clear on open: reconcile dismisses stale delivered (already-fired = outdated) notifications from the tray on foreground/focus, but KEEPS un-acted commitments (task deadlines `lifeq:task:` + agent/user reminders `lifeq:rem:`); plan nudges/rituals/runaway/stale remote pushes are cleared. Scheduled/future reminders are untouched (rescheduled immediately after), so no ping is lost
- Deferred to next IPA: bundled custom sounds

### Agent v4 (gpt-5.1)
- Model gpt-4.1-mini → gpt-5.1 (reasoning_effort low); entry/block/reminder/memory id allowlists (read-before-write), full date clamps
- Evidence snapshot in every turn: 7-day tracked hours by category, sleep avg, yesterday/today coverage — deterministic numbers the model interprets, never invents
- Plan semantics: blocks fixed/flexible/protected (proposal card marks ⊙/◈; planner won't move fixed without asking); todos commitment/flexible/reminder/someday (commitments can't be silently dropped from a finalized plan)
- Replan: ≤2 tradeoff questions grounded in the snapshot → proposal card shows a Keep/Move/Drop/Add diff (new/moved tags + "Drops:" line) → Apply (future-only) → "Undo last apply" pill restores replaced blocks
- Memories: agent saves durable facts ONLY with explicit consent ("remember that…"); /memories screen (bookmark icon) to add/pin/forget; memories + yesterday's journal injected into every turn
- Journal: "Evening review" chip → factual summary from the real timeline + ≤3 rotating questions → saved per-day (`journal_entries`), feeds next-day planning
- Deterministic gap detection: `list_time_entries` returns a computed `gaps[]` (uncovered spans ≥10 min); after any backfill the agent MUST re-list, raise every remaining gap in the same reply, and only call the day complete when `gaps[]` is empty (no more eyeballing timestamps / missed sleep→next boundaries)
- Agent-started timers get a Live Activity via the CLIENT's local reconcile (plan-chat only runs while the app is foreground, so it no longer fires an APNs push-to-start — that stamped `push_started_at`, made reconcile skip the local card, and left foreground-suppressed pushes with no card at all). Background/closed starts remain the voice path's job.
- Error/retry hardening: plan-chat client classifies failures — clean transport drops auto-retry once (safe, no server work ran); a non-2xx/timeout gets a plain-language message (incl. "changes may still be saving, refresh before resending" for gateway timeouts) instead of raw "non-2xx"; stale ⚠️ error bubbles no longer re-sent as model context
- Date anchoring: prompt now states today's weekday + an UPCOMING DAYS weekday→date map (next 8 days) so "Tuesday"/"Sunday" resolve to the exact date instead of being guessed; a dated commitment (day + time) is a calendar block, never a backlog todo
- No duplicate blocks: `add_calendar_block` is idempotent (same date+title+start returns the existing id) — re-issuing an "add" after "fix it" no longer stacks a second copy
- Verified action log: every real change the agent made that turn (`actions[]`) renders as ✓ chips under its reply — ground truth the model's prose can't contradict; prompt forbids claiming an action without a succeeded tool call
- Live streaming: plan-chat streams over SSE (`expo/fetch`) — the thinking bubble shows the current step ("Scheduling …", "Checking your schedule…") + elapsed seconds, a Stop button that quits waiting and refreshes what actually committed, and the input stays editable so messages typed mid-turn are queued and sent in order

### Autonomous brain (deterministic v1)
- Durable open CONCERNS (evidence, importance, cooldown, notified count, resolution) — not fire-and-forget pings; sensors: 45m+ tracking gap, 60m+ plan drift, due commitments with no disposition, no-plan morning, no-journal evening
- Triggers: pg_cron every 30 min (Vault-stored cron key, `setup_brain_cron` RPC) + throttled app-open tick; pushes via Expo to registered device tokens under a 5/day attention budget, per-kind cooldowns, quiet hours
- /brain "Watching" screen (eye icon in Agent): open concerns with evidence + last action, dismiss, recently closed, and the run log of every act-or-stay-silent decision
- Push transport: `push_tokens` registration on device (token lands after the next push-capable IPA build)

## Time Tracking

### Timer
- Start a timer for any category with optional name and tags
- Parallel timers: run multiple timers simultaneously; "Run alongside current timer" checkbox in the add sheet keeps the previous timer running
- Stop-and-start: tap the stop button in the running-timer banner to stop the current timer and immediately open a new one
- Running timer banner: persistent bar at the top of all non-home tabs showing the timer title, elapsed time, category-coloured pulse dot, and quick-stop button
- Runaway-timer guard: a local notification fires at start + 6h for each running timer (even when the app is closed) so a forgotten timer nudges you to stop/review it; cancelled automatically on stop (`runawayNotify.ts`, reconciled from the tab root alongside Live Activities)

### Log Past Entry
- Log a completed time block with explicit start and end times (no running timer)
- Accessible from the same sheet as "Start timer" via mode toggle chips
- Tapping a gap in the day timeline pre-fills start/end times for that gap

### Plan Block
- Schedule a future calendar block with start time, end time, and optional recurrence (Once / Daily / Weekdays / M W F / Weekly)
- Accessible from the same sheet via mode toggle chips
- Smart time suggestion: defaults to the next unoccupied hour after now
- Cross-midnight blocks: an end time at or before the start (e.g. 11:35PM → 3AM) rolls into the next day instead of being rejected; applies to Plan blocks, Log past entries, and edits to both. Day view renders the bar continuously across midnight; Week view renders the head (start → midnight) in its column and the tail (midnight → end) in the next day's column

## Sheet UX

### Error handling
- Validation and save failures in the add and edit sheets show as a dismissable inline error banner above the footer (tap to dismiss; auto-clears on retry, mode switch, or reopen) instead of a native popup — native alerts stacked over the sheet's modal could leave the screen dimmed and frozen on iOS. The keyboard stays up so the field can be fixed immediately
- The keyboard is dismissed before the remaining confirmation dialogs (Delete, Unsaved changes) so they don't trigger the same freeze

### Add sheet
- Single FAB (+ button) opens a unified sheet with three mode chips: Start timer / Log past / Plan block
- Section order: Category → Tags → Notes (optional) → Name (optional); time fields lead in Log past and Plan block modes
- Category chips sorted by frequency of use at the current time of day (descending, weighted: same hour ×3, ±1 hr ×2, ±2 hr ×1, over 90 days)
- Name auto-filled as selections are made: category alone → "Commute"; with tags → "Commute · office · morning"; updates live as tags are added or removed
- User edits to the name lock it; clearing the field reactivates auto-fill
- Empty name falls back to "Untitled" on save; empty category defaults to the first available (no blocking alert)
- Pull-down gesture: empty sheet closes silently; sheet with content saves immediately
- Tag autocomplete: suggestions from previously used tags for the selected category
- New category creation inline via "+ New" chip without leaving the sheet
- "Set to last stop time" shortcut button in timer mode to backfill the start time

### Edit sheets (entry and block)
- Section order: Time → Category → Tags → Notes (optional) → Name (optional, at bottom)
- Name auto-fills from category tap when the field is empty
- Empty name falls back to "Untitled" on save
- Unsaved-changes alert on backdrop tap with Discard / Keep editing / Save options
- "Set start to last stop time" and "Set end to current time" shortcut buttons in the entry edit sheet
- Resume a stopped entry: tapping "Set end to current time" flips that same button to "Resume timer"; tapping it re-opens the entry (applies any field edits, clears the end time, marks it running again) to undo an accidental stop — respects the 2-running-timer limit and surfaces failures inline. Resets to "Set end to current time" when the sheet is reopened

## Home View
- Live timer card showing title, elapsed time, and category-coloured pulse dot
- Category name shown in uppercase below the title
- Quick-start category chips: top N categories (configurable via quickStartCount setting) shown as colored-dot + name chips; sorted by weighted frequency (same hour ×3, ±1 hr ×2, ±2 hr ×1, same weekday +2, ±1 day +1, over 90 days); excludes already-running categories; tapping starts a timer immediately
- Next planned block shown with title and relative start time; tapping starts a timer for that block
- Centre control is a start/pause toggle: shows a stop square while a task runs (tap → stopAll), a `+` while idle (tap → new-timer sheet); `+` is centred (removed stray paddingLeft offset)

## Day View
- `Day` tab: timeline showing all entries and calendar blocks for the selected date
- Overlapping/parallel entries split into left-right lanes
- Tap any entry or block to edit it inline (time, category, tags, name)
- Tap a gap in the timeline to log a past entry for that time slot
- Navigate between days by swiping or tapping the date header
- Undo delete: deleting an entry or block shows a 5-second bottom toast with UNDO (soft-delete + `restoreEntry`/`restoreBlock`)
- Pinch-to-zoom with wider range (0.3×–8×) for fine-grained or panoramic views; pinch snaps to discrete levels so it stays crisp (no stretch) and relayouts only on level change for smooth framerate
- Hide sleep: toggle in Settings collapses the sleep window (configurable bedtime / wake time, default 11 PM–7 AM) out of the timeline so only waking hours are shown; per-hour pixel density stays constant
- A Day/Week toggle was tried and parked (2026-07-04, UX didn't land) — Week's grid still exists as `src/components/WeekTimeline.tsx` but isn't wired into any screen right now

## Insights View
- 5th tab (Home / Day / Agent / Tasks / Insights / Settings) with a bar-chart icon
- Global Day / Week / Month toggle drives the overview, breakdown, and time chart; deltas compare to the same *elapsed* slice of the previous period (month-to-date vs same days last month, not a full month)
- Hero strip: all-time hours, equivalent full days, total entry count, tracking-since line
- Overview: period total + Δ vs last; Essential-vs-Discretionary split bar so unavoidable time doesn't dominate; category donut; one merged breakdown grouped Discretionary-then-Essential — each row shows share %, time, Δ, and its tags by time underneath (no separate legend/tags lists)
- Time chart (Apple-Screentime style): pick a category (+ optional tag) → per-bucket bars (hourly for Day, daily for Week, weekly for Month) with period total and daily average
- Focus: deep sessions (>90 min) and context-switches/day for the selected period
- Consistency: overall current and best streak, 365-day GitHub-style heatmap (Mon–Sun rows, intensity 0–4h)
- Patterns: day-of-week average bar chart, peak hour, average start-of-day time (all-time)
- Sessions: average session length, longest session ever, 4-bucket histogram (<30m / 30–60m / 1–2h / 2h+)
- Milestones: most hours in a day, longest session, longest streak, staleness alerts (not tracked in 7+ days)
- Per-section ⓘ info popovers explain what each metric measures
- Empty state: before any time is tracked, shows a "No time tracked yet" prompt instead of an all-zeros dashboard
- Search affordance: a magnifier in the header opens the global entry search
- Typography pass: larger, lower-tracking labels and a unified number font for legibility
- Pull-to-refresh for fresh data

## Search
- Global entry search (`/search`): debounced case-insensitive title match across all days, with a horizontal category-filter chip row (All + each category)
- Empty query shows the most recent entries; tap any result to edit it in the Day view
- Reached from the magnifier in the Insights header

## Review queue
- `/review` lists every `review`-tagged entry (voice/Siri entries, which may be mis-heard) — running and completed, newest first
- Each row opens the full edit sheet (Day view) or clears the `review` tag in one tap ("✓ Reviewed")
- Home shows an "N entries need review →" pill when the count is above zero

## Todos / Backlog (Tasks tab)
- A backlog of intentions (timeless until planned), separate from time-boxed blocks. Each todo: title, optional category, priority (none/low/med/high), deadline, notes, and a one-level ordered checklist of steps ("phases").
- **Quick add**: a task is just a title — type into the "Add a task…" field and hit return. All details (priority, repeat, deadline, steps, category) are optional, edited by tapping the task; category is demoted to an optional field (a fallback category is auto-assigned when a category-less task gets scheduled).
- **Tasks attach to entries & blocks**: the add sheet (Start timer / Log past / Plan block) has an optional "Task" chip row — picking one links `todo_id`, prefills title/category. Stopping a linked timer, logging a linked past entry, or the handoff-stop of a linked timer **auto-completes the task** (recurring tasks roll forward). Home's "next planned" tap carries the block's task onto the timer.
- Recurrence (Once/Daily/Weekdays/M W F/Weekly): a recurring todo rolls forward — completing it records the occurrence and advances `next_due` (it never leaves the list); one-off todos complete and drop out. Completions are unique per occurrence (no streak inflation).
- **Tasks is its own bottom tab**, not nested under Agent: task list fills the screen, date bar below it, "Add a task…" input bar at the bottom — showing the backlog grouped Overdue / Today / Upcoming / No date, with priority dot, deadline, step progress, and a ↻ marker for recurring. Its own date, independent of Agent's planning-session date.
- **Add to plan**: "+ plan" on a todo creates a todo-linked `calendar_block` on the Tasks tab's selected date (default 1-hour slot, adjust in Day) → it appears in Day/Home. Needs the todo to have a category.
- The **AI/voice planner** sees open todos (priority, deadline, recurrence, category) as backlog and schedules the relevant ones into the day's plan — you don't pre-schedule; the plan is built on the day from tasks + priority.
- Data: `todos` / `todo_steps` / `todo_completions` tables; `todo_id` bridge on `daily_plan_items` and `calendar_blocks` (migration `20260617_002`).

## Categories
- Create categories with a name and colour chosen from a palette
- Each category is Essential (have-to: sleep, food, bath, commute, calls) or Discretionary (chose-to: work, study, gym, leisure), set in the Settings category editor; new categories are auto-classified from their name and used to split Insights so essentials don't dominate the rankings
- Editing a category in Settings auto-saves: expanding a row turns its name into an inline editable field (no duplicate name input), colour & kind save on tap, name on blur; only creating a new one needs a button. A Delete action sits in the expanded editor (long-press still works)
- Sorted by frequency of use at the current hour when opening any sheet

## Tags
- Free-text tags on entries and blocks, scoped to a category
- Autocomplete suggests previously used tags for the selected category
- Tag editor (Settings) mirrors categories: expand a tag to edit its name inline (auto-saves on blur), with an inline Delete; only adding a new tag needs a button
- Auto-enrichment enforces tag consistency: the capture-cleaner is fed the user's existing tag vocabulary and must reuse the exact existing tag over coining a near-synonym/platform variant (e.g. "reels" not "instagram"/"shorts"), and won't attach an unrelated project tag (e.g. no "lifeos" on an OCR entry)

## Sheets
- Bottom sheets share a draggable handle: drag it down to dismiss. Add/edit sheets save on drag-down; Settings editors (which auto-save) just close. Settings sheets use a clear "Done" button instead of a small ×

## Agent (AI day-planner chat)
- `Agent` tab: a conversational assistant that plans a single day and can act on real data (see below). Defaults to today; describe your day in plain language and it asks clarifying questions, suggests a schedule, and proposes a concrete plan
- **Layout**: simple "Agent" title with the TTS speaker icon on the right. Date selector (just the date, tap ‹ › to step) sits below the chat, right above the input bar. Tasks lives in its own tab now, not nested here
- **Say the date instead of using the stepper**: opening a fresh chat with a message that names a day ("tomorrow I want to gym…", "let's plan Friday", "plan July 10") sets the planning date (and header) from that automatically — parsed via `chrono-node`, gated on an explicit day/weekday component so a bare time like "at 7" never misfires. Only fires on the first message of an empty chat, so a date mentioned mid-conversation (e.g. a task "for Tuesday" while planning Monday) never resets the in-progress plan. The date arrows still work for manual stepping
- Voice input: **hold** the mic in the input bar to talk — release to transcribe & send (quick taps are discarded). Replies are spoken via `plan-tts` (expo-speech fallback) when the speaker toggle is on
- Quick prompts on an empty chat: "Plan my day" / "Replan from now" / "What's left today?" — the today-scoped ones flip the target date to today automatically
- **Replan from now**: asking to redo the rest of the day proposes a plan from the current time forward; Apply replaces only prior AI blocks starting at/after now, so the morning that already happened stays on the timeline
- **Agent manages tasks too**: it can list/add/complete backlog tasks mid-conversation ("remind me to renew my license" → task added; "I did the groceries 4–5" → time logged + task completed), links plan items and timers to tasks via `todo_id`, and the plan proposal card marks task-linked items with ☑
- Apply materializes uncategorized items into the fallback (first) category instead of dropping them
- **Backfill across midnight**: recounting a stretch that spans two calendar days (e.g. "left office 6:30 yesterday … worked till 1am … slept … woke today at 8") now dates every activity correctly — the prompt is given explicit TODAY'S/YESTERDAY'S dates and a sleep-period hinge rule, so pre-sleep activities land on yesterday and post-wake activities land on today instead of everything defaulting to today
- Structured turns: each reply is `{ reply, plan }` — `plan` stays empty until there's a concrete schedule, then refines as you adjust. Items map to your real categories (model is given category ids; hallucinated ids are dropped server-side)
- Apply: one tap materializes the plan into `calendar_blocks` for that date (shows in Day/Home). Replace semantics — re-applying wipes the prior AI plan for the day so there are never duplicates. Items with no matching category are reported, not silently dropped
- Backed by `daily_plans` + `daily_plan_items` (provenance: source=ai, prompt, model, generated_at). OpenAI key stays server-side in the `plan-chat` edge function (gpt-4o-mini, JWT-verified)

## Live Activities (iOS)
- Running timers appear on the Lock Screen + Dynamic Island, counting up live on-device (no push server) via expo-live-activity `elapsedTimer`
- Shows entry title + category; reconciled from the running-timer set (starts on run, updates on change, stops on stop), supports parallel timers
- Red **STOP** button on the lock-screen activity + expanded Dynamic Island: tapping it deep-links into the app (`lifeos://stop-start?entry=ID`), which stops that timer and opens the start sheet to begin another
- Compact Dynamic Island shows a category-color dot + count-up timer
- Subtitle shows the next planned task + when it starts ("Next: Lunch · 1:00 PM", name only)
- Parallel timers (max 2) each get their own activity
- Library SwiftUI customized via a config plugin (`plugins/withLiveActivityStopButton.js`) that injects the button/dot at prebuild (reliable on EAS, unlike postinstall)
- iOS 16.2+ only; no-op on Android/web

## Siri / Voice (iOS)
- One-shot: "LifeOS \<title>" captures the whole tail as the entry title (e.g. "LifeOS commute to office"); "LifeOS stop \<title>" / "LifeOS parallel \<title>" route by leading keyword — best for short, non-navigation-like words (Apple's NL router hijacks map/web/message-like phrases)
- Reliable two-step fallback: "New entry in LifeOS" → Siri asks "What are you tracking?" → dictate anything (captured as a parameter answer, immune to Siri domain routing)
- start / stop / parallel are parsed from the spoken title in JS (`siriQueue.ts`) so routing keywords are tunable without a native rebuild
- Auto-categorize: the spoken title is matched (whole-word) against tag names → that tag's category + the tag is added; else against category names → that category; else native value; else falls back to Misc/first
- Voice entries always get the `review` tag (may be mis-heard); commands run while locked, captured to a queue, applied on next foreground (backdated to when spoken) and the new entry shows immediately via a timer-change broadcast
- Siri dismisses immediately after capture (no lingering "Got it" confirmation snippet)
- Implemented via App Intents in the main target (config plugin `plugins/withTrackIntent.js` + `LifeOSTrackIntent.swift`)

## Lock Screen / Shortcut quick-log (iOS)
- The "New LifeOS entry" App Intent appears as a Shortcuts action → build a shortcut with the Task param set to "Ask Each Time" (text box) + optional "Open App", and pin it as a Lock Screen widget / Home Screen icon / Control Center control / Action button
- Same enqueue→drain pipeline as Siri (backdated, `review` tag, auto-category)

## Auth
- Email/password sign in & sign up via Supabase
- "Continue with Google" on both screens — Supabase OAuth (PKCE) opened in an in-app browser, returns to the app via the `lifeos://auth-callback` deep link
- New accounts auto-seed default categories if none exist

---

# Roadmap / Planned (NOT yet built)

## Plan chat v2 — ✅ SHIPPED 2026-07-02 (same-day turnaround on first-use feedback)
- **Natural TTS voice** ✅: `plan-tts` edge fn (OpenAI gpt-4o-mini-tts, voice "nova") replaces robotic expo-speech in chat + voice overlay; expo-speech kept as offline fallback. Planning-turn latency also dropped to ~4–5s (gpt-4.1-mini).
- **Parallel plan blocks** ✅: planner preserves explicitly-parallel items at full stated times (max 2 concurrent); sequential plans stay overlap-free. QC'd on the exact 7:30–10-study + calls scenario.
- **Expected-sleep setting** ✅: Settings → "Expected sleep" (6–10h, default 8.5h). Bedtime mention → full-duration sleep block (cross-midnight, e.g. 23:15→07:45); Insights Consistency shows avg sleep/night vs target.
- **Chat as full in-app agent** ✅: plan-chat runs an OpenAI tool loop (10 tools: time entries + calendar blocks CRUD, RLS-scoped). Killer backfill flow verified live: stale running Sleep + "woke 8, ready till 8:30, drove till 9, work since" → sleep ended 8:00, missed periods logged w/ correct categories, running Work backdated to 9:00. Hallucination armor: date clamping, id validation, idempotency guards. Chat auto-refreshes Home/Day when the agent changes data.

## No-app-open live sync (Siri + Lock Screen Shortcut) — ✅ SHIPPED (see "APNs push-to-start" above)
> STATUS 2026-06-16: **DONE.** DB-live + instant Live Activity while app-closed is built and the START path is device-proven. The "instant LA from a closed app" problem was solved with **APNs push-to-start** (Edge Function fires the push) + a background intent that **ends** activities locally — NOT by driving `Activity.request` from the intent (iOS forbids that). The design notes below ("Correct V1", HMAC/Keychain, "today it only enqueues") are **historical/superseded**; the shipped auth is a device-secret to the Edge Function and the shipped LA path is push-to-start. Remaining open item: 2 timers in one Live Activity for the Island (deferred — see `DUAL_TASK_PLAN.md`).
Goal: trigger Siri/Shortcut without opening or unlocking the app, and have it reflect **live** in BOTH:
1. **Supabase DB** (other apps consume this data — can't wait for next app open), and
2. the **iOS Live Activity** (Dynamic Island + Lock Screen).
Why it's hard: a background App Intent does NOT boot React Native, so the intent itself must (a) write to Supabase over the network in Swift and (b) drive ActivityKit directly. Today it only enqueues and applies on next foreground.
Recommended design (post Codex review — "Correct V1"):
- **Auth = device-scoped voice credential (NOT the Supabase JWT).** RN, while logged in, registers a per-device secret; server stores only a hash; raw secret lives in the **iOS Keychain** (accessible-after-first-unlock). The native intent signs each request with HMAC (`device_id + command_id + body + timestamp`). → truly live until logout, no JWT freshness/rotation fragility. Credential is narrowly scoped (create/stop voice entries only), revocable, rotated on logout/reinstall. Never let native refresh the Supabase session; never embed the service-role key; never use the anon key as a per-user credential.
- **Supabase Edge Function `voice-track`** = the single stable native contract. Authenticates the HMAC, maps to `user_id`, calls a security-definer SQL fn, returns canonical timer state. Lets us change auth/validation/response/APNs later **without a Swift rebuild**.
- **SQL `track_from_voice(...)`** (security-definer, one transaction): parse stop/parallel, match category+tag, stop-previous, insert. Advisory lock / partial unique index to enforce single running timer (unless parallel).
- **Idempotency:** every command carries a UUID; DB unique `(user_id, command_id)`; the native fallback queue retries the SAME UUID (never a new one) → no double inserts.
- **Native intent (tiny Swift):** read Keychain secret → POST `voice-track` → on success update Live Activity locally (reuse `expo-live-activity` `LiveActivityAttributes`, public init) → on failure enqueue the same command_id. No parsing/matching/schema knowledge in Swift.
- **DB is source of truth:** update the Live Activity only after DB success; if DB ok but ActivityKit fails, queue a "reconcile activity" task (not another insert).
- **RN on open:** reconcile LA by `entry_id` — enumerate `Activity<LiveActivityAttributes>.activities`, adopt the one matching the running entry, end duplicates (don't rely only on a saved activity_id).
- Offline can't satisfy DB-live → queue is the only fallback (optionally show a "pending" LA state, but don't pretend other consumers see it until Supabase confirms).
- **Simpler "Fast V1" alternative** (if we want least work first): native reads the last RN-saved JWT + same Edge Function/SQL + local ActivityKit + idempotent fallback — but it's only live while the JWT is fresh (app opened within token TTL). Codex recommends going straight to Correct V1.
- APNs Live Activity push deferred (needs push tokens + provider setup); local ActivityKit is simpler/deterministic for same-device Siri starts.

### APNs push-to-start (instant Dynamic Island, app closed) — 2026-06-15/16
> iOS blocks `Activity.request` from a background App Intent, so START while app-closed = APNs push-to-start (iOS 17.2+; device iOS 26+).
> - **START — PROVEN on device**: Siri (app closed) → `voice-track` Edge Function writes the DB entry AND fires an APNs push-to-start → Dynamic Island / Lock Screen appears, in sync with the DB. (APNs host = production `api.push.apple.com`; EAS ad-hoc export rewrites aps-environment to production. App must be backgrounded-not-killed.)
> - **STOP (app-closed) — ✅ PROVEN on device (2026-06-16)**: the native intent ENDS the activity locally (allowed in background) by matching `Activity.activities` on `attributes.name == entry_id` — card disappears + DB stops, app never opened. No push tokens. Push payload sets `name = entry_id`. (Phrase: "track in LifeOS" → dictate "stop swimming"; one-shot "track stop swimming in LifeOS" can confuse Siri's NL.)
> - **Dedup on open — ✅ PROVEN on device (2026-06-16)**: `reconcileLiveActivities` skips entries with a `command_id` (voice = push-managed) so opening the app never duplicates the card.
> - **Dedicated Stop shortcut — ✅ PROVEN on device**: `StopIntent` + `StopDictateIntent` prepend "stop " so the same parser stops the entry and the intent ends the card. Verb settled on **"finish"/"done"** ("stop" is Siri-reserved → leading-"stop" hijacked; "end" is heard as "and"). Built-in: "Finish \<task\> in LifeOS", "LifeOS finish/done" → dictate. Start mirror: "Track \<task\> in LifeOS", "LifeOS track" → dictate.
> - **Most reliable path = personal Shortcuts**: in the Shortcuts app, add the **"New LifeOS entry"** / **"Stop a LifeOS task"** actions and name them anything (e.g. **"Track"** / **"Finish"**) → "Hey Siri, Track" / "Hey Siri, Finish" with no app-name dependency (Siri sometimes splits "LifeOS" → "Life OS"). Run in background; same DB-write + Live-Activity behavior. Verified.
> - **Foreground refresh**: the app reloads running state on every foreground (not only when the local queue had items), so a Siri/Edge-Function entry — which writes the DB with no local queue item — shows in the banner/Home/Insights immediately instead of staying stale.
> - **Tap behavior — ✅ PROVEN on device (2026-06-16)**: card BODY → `lifeos://home` (opens Home); red STOP button → `lifeos://stop-start?entry=…` (stops + new-task sheet). Widget split (body uses `applyWidgetURL`; stop button uses `Link(URL(string:))`).
> - **Offline / push-failure fallback (2026-06-17)**: the Edge Function stamps `push_started_at` on a successful push; `reconcileLiveActivities` starts a LOCAL card for a `command_id` voice entry only when that stamp is null (phone was offline → command queued + applied via RPC with no push, or the push failed). So a missing card still appears on next foreground without duplicating push-started cards. (Migration `20260617_001`; needs the new client build to take effect.)
> - Credential gotcha (cost 2 builds): the dev (internal/ad-hoc) profile must be **deleted + recreated** while logged into Apple *after* Push is enabled on the App ID.
> - DEFERRED: 2 timers in ONE Live Activity for the Dynamic Island (see `DUAL_TASK_PLAN.md`).

### Day-view timeline — contiguous tasks (2026-06-16)
- **Lane-split tolerance**: the 2-column (parallel) split now ignores overlaps ≤ 1 min, so sequential tasks with minute-rounding drift (a new entry at HH:MM:00 vs the previous stop at HH:MM:43) no longer render as two alternating columns. Real parallel tasks (overlap by minutes) still split. (`timeRangeOverlaps` gained a `tolMs` arg; lane checks pass `LANE_OVERLAP_TOL_MS`.)
- **Contiguous chaining**: starting a new timer with a custom start time now ends the previous timer EXACTLY at that start (the handoff), instead of at now() — so tasks meet with no gap/overlap. Normal "start now" already chained (RPC uses one transaction-stable now()).

### Dual-task (parallel timers, max 2) — ✅ PROVEN on device (2026-06-16)
- Hard cap of 2 running timers enforced by DB trigger `enforce_max_running_timers` (all paths; pre-existing). Start sheet now hides the "Run alongside" toggle at 2 running and explains it; submit can't attempt a 3rd.
- Home (`test3.tsx`): 2 running tasks render as an `A | B` split (equal halves + divider), each with its own live timer; 1 task keeps the full-width centre stage.
- expo-live-activity `enablePushNotifications: true` → sets `aps-environment=development` + Info.plist `ExpoLiveActivity_EnablePushNotifications=true` (native then observes `pushToStartTokenUpdates`).
- RN `pushToStartToken.ts`: `addActivityPushToStartTokenListener` → `set_push_to_start_token(device_id, token)` RPC → stored on `voice_credentials.push_to_start_token` (migration `20260615_002`).
- Prereq done: Push capability enabled on App ID `com.pedapatiamarsh.lifeos` + dev profile regenerated via `eas credentials`.
- NEXT after token lands: server sends `start` push to `api.sandbox.push.apple.com`, topic `com.pedapatiamarsh.lifeos.push-type.liveactivity`, `apns-push-type: liveactivity` (needs APNs .p8 auth key). Then wire Siri/Edge Function to fire the push so the Island appears the instant the user speaks.

## Google Calendar import (PLANNED — not built)
- One-way, read-only: pull Google Calendar events via the Google API (add the Calendar scope to the existing Google OAuth) and show them as read-only blocks in Agent/Day. Schema already supports it (`BlockSource = 'google_calendar'`). Tapping a meeting can start a timer against it. No embedded Google UI (the app already has its own timeline). Two-way sync deferred further.

## Other deferred
- Lock-screen / home quick-start buttons: top-N tasks by historic use at the current time (one-tap start), beyond the generic text-box shortcut.
- Build pipeline: Codemagic `eas build --local` set up as the EAS-quota overflow valve (see repo `codemagic.yaml`).
