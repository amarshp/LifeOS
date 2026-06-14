# Implemented Features

Last updated: 2026-05-28

## Time Tracking
- Start a timer with title, category, tags, and optional custom start time.
- Run a timer alongside an existing timer for parallel work.
- Stop running timers from Home, Day, and the top running banner.
- Stopping the current timer from Home or the top running banner opens start timer mode automatically.
- Edit running or completed entries, including title, category, start time, end time, and tags.
- Delete entries with soft-delete behavior in the backend.
- Log past entries directly from the entry sheet.
- Long-press blank space in Day view to log a past entry with smart start/end times from surrounding actual and live blocks.

## Day View
- Scroll a continuous timeline across previous and future days; more days load as you keep scrolling.
- Header date follows the day currently centered in the timeline.
- Left/right day swipes stay synced with vertical scroll and preserve the same centered time of day.
- Pinch zoom the timeline, with display-synced zoom updates.
- Drag planned and actual blocks to adjust time.
- Single actual/running blocks render full-width; overlapping actuals and parallel running timers split side-by-side.
- Running timers update live on the timeline.
- Running timer blocks clamp to the current-time line and do not render into the future.
- Now line appears when today is inside the visible timeline range.

## Planning
- Create planned blocks from the main entry sheet.
- Create planned blocks with title, category, start/end time, recurrence, and tags.
- Edit and delete planned blocks.
- Recurring blocks are expanded into effective daily plans.

## Categories
- Create categories from timer/log/edit-entry flows without leaving the sheet.
- Select category colors from a palette.
- Category lists de-duplicate freshly-created categories while data reloads.
- Manage categories in Settings.

## Tags
- Tags are saved per category when entries or plans are saved.
- Tag suggestions appear as up to 4 chip buttons, not a dropdown list.
- Suggestions update as you type.
- Suggestions are filtered by selected category and hide already-selected tags.
- Suggestions are ranked from most-used to least-used using existing entry and plan usage, with saved category tags as fallback.
- Tapping a suggestion adds it to the current entry or plan.

## Home
- Single Home route uses the Monolith screen.
- Shows current running timer, title, category, elapsed time, and running count.
- Supports tapping a running task to open the Day edit sheet.
- Shows second running task when parallel timers are active.
- Day progress line only renders tracked time inside today and never paints future time.

## Week View
- Shows planned blocks, completed entries, and running entries across a week.
- Running entries are merged into the correct local day.
- Parallel running entries show distinct start positions.

## Settings
- Manage categories, tags, quick start count, week start, snap interval, theme, reduce motion, and export options.
- Settings sheets use bounded modal layouts with internal scrolling.

## Data And Sync
- Supabase-backed auth and persistence.
- Soft-delete pattern for recoverable cleanup.
- Timer change event bus keeps running timers synchronized across screens.
- Local-day range filtering handles timezone edges for Day and Week views.
- Daily plan schema and service foundation exists for future manual/AI-generated day plans.
