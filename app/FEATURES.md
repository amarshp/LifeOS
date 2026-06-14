# LifeOS Features

## Time Tracking

### Timer
- Start a timer for any category with optional name and tags
- Parallel timers: run multiple timers simultaneously; "Run alongside current timer" checkbox in the add sheet keeps the previous timer running
- Stop-and-start: tap the stop button in the running-timer banner to stop the current timer and immediately open a new one
- Running timer banner: persistent bar at the top of all non-home tabs showing the timer title, elapsed time, category-coloured pulse dot, and quick-stop button

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

## Day View
- Timeline showing all entries and calendar blocks for the selected date
- Overlapping/parallel entries split into left-right lanes
- Tap any entry or block to edit it inline (time, category, tags, name)
- Tap a gap in the timeline to log a past entry for that time slot
- Navigate between days by swiping or tapping the date header
- Pinch-to-zoom with wider range (0.3×–8×) for fine-grained or panoramic views
- Hide sleep: toggle in Settings collapses the sleep window (configurable bedtime / wake time, default 11 PM–7 AM) out of the timeline so only waking hours are shown; per-hour pixel density stays constant

## Week View
- 7-column grid showing entries and blocks for the current week
- Overlapping entries in each day column split into left-right lanes
- Running parallel timers shown side-by-side
- Default zoom level set higher (0.85×) for better readability on open
- Can be hidden from the tab bar via Settings → "Show Week tab" toggle

## Insights View
- 5th tab (Home / Day / Week / Insights / Settings) with a bar-chart icon
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
- Typography pass: larger, lower-tracking labels and a unified number font for legibility
- Pull-to-refresh for fresh data

## Categories
- Create categories with a name and colour chosen from a palette
- Each category is Essential (have-to: sleep, food, bath, commute, calls) or Discretionary (chose-to: work, study, gym, leisure), set in the Settings category editor; new categories are auto-classified from their name and used to split Insights so essentials don't dominate the rankings
- Editing a category in Settings auto-saves: expanding a row turns its name into an inline editable field (no duplicate name input), colour & kind save on tap, name on blur; only creating a new one needs a button. A Delete action sits in the expanded editor (long-press still works)
- Sorted by frequency of use at the current hour when opening any sheet

## Tags
- Free-text tags on entries and blocks, scoped to a category
- Autocomplete suggests previously used tags for the selected category
- Tag editor (Settings) mirrors categories: expand a tag to edit its name inline (auto-saves on blur), with an inline Delete; only adding a new tag needs a button

## Sheets
- Bottom sheets share a draggable handle: drag it down to dismiss. Add/edit sheets save on drag-down; Settings editors (which auto-save) just close. Settings sheets use a clear "Done" button instead of a small ×

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
- "Track \<task> in LifeOS" (stop current, start), "Track parallel \<task> in LifeOS", "Track stop \<task> in LifeOS" — run while locked, no unlock
- Task name matches your categories + recent task titles (synced to a native AppEntity); arbitrary free text isn't supported (Apple requires a known entity)
- Commands are captured to a queue while locked and applied (backdated to when spoken, auto `review` tag) when the app is next opened; Siri speaks a confirmation
- Implemented via App Intents in the main target (config plugin `plugins/withTrackIntent.js` + `LifeOSTrackIntent.swift`)

## Auth
- Email/password sign in & sign up via Supabase
- "Continue with Google" on both screens — Supabase OAuth (PKCE) opened in an in-app browser, returns to the app via the `lifeos://auth-callback` deep link
- New accounts auto-seed default categories if none exist
