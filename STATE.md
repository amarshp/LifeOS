# STATE.md — Architecture & Engineering Memory

_Last updated: 2026-05-27 07:25 IST_

## Stack
- **Expo SDK 54**, React Native 0.81.5, React 19.1, expo-router 6 (file-based routing).
- **Supabase** (`@supabase/supabase-js`) — Postgres backend, `timestamptz` columns, soft-delete via `deleted_at`.
- **react-native-web** target available (`npm run web`) — used for Playwright screenshots.
- No test framework installed. No lint config. `tsc --noEmit` is the only static check.
- AsyncStorage for local settings persistence.

## Routing
- `app/(auth)/*` — sign-in / sign-up.
- `app/(tabs)/_layout.tsx` — tab navigator + the **live timer top bar (RunnerBanner-style)** rendered above tabs when a timer runs and the route is not Home.
- Tabs: **`test3.tsx` ("The Monolith") = the single Home screen** (uses `useHomeData()`), `day`, `week`, `settings`. `test1/2/4` are hidden scratch screens.
- **Single home (resolved 2026-05-27):** `app/(tabs)/index.tsx` is now just `<Redirect href="/(tabs)/test3" />`; post-login redirect in `app/_layout.tsx` goes straight to `/(tabs)/test3`. The old standalone home design is archived at `_archive/home-index.tsx.bak`. (Previously there were two diverged home screens.)

## Data model (`src/types/database.ts`)
- `categories` (id, name, color, **icon: string|null**, sort_order…)
- `tags` (id, category_id, name…)
- `weekly_template_blocks` (recurring template, day_of_week…)
- `calendar_blocks` (planned blocks; date + start_time/end_time timestamptz; recurrence; tags[])
- `time_entries` (**actual tracked time**; start_time, end_time|null, **is_running** bool, tags[])

## Timer system (`src/hooks/useTimer.ts`)
- `getRunningTimers()` → `time_entries WHERE is_running = true`. Ordered by insertion (NOT explicitly by start_time — see BUG note).
- `useTimer()` holds `running: TimeEntry[]`, `elapsed: Record<id, seconds>` (recomputed every 1s from each entry's own `start_time`).
- Cross-screen sync via `src/lib/timer-events.ts` (`emitTimerChange` / `subscribeTimerChange`) — start/stop emit, all `useTimer` instances refresh.
- **Parallel tasks**: up to 2 running entries supported. `startParallel` inserts a new running entry without stopping the previous. `start` calls `start_timer_stop_previous` RPC (or stopAll+insert when a custom startTime is given).

## Day / Week data flow (key to BUG #2)
- **`getEntriesForDate(date)`** filters `start_time >= '${date}T00:00:00'` AND `<= '${date}T23:59:59'` — **timezone-naive strings** compared against `timestamptz`. Postgres interprets the naive literal in the DB session TZ (UTC). In IST (UTC+5:30) the real local day [00:00–24:00 IST] maps to [18:30 prev–18:30 UTC]; entries before 05:30 IST / after... fall OUTSIDE the naive UTC window → **dropped from Day view**. ROOT CAUSE of #2.
- **Week view** loads a 7-day range with the same naive window BUT then re-buckets each entry by **`toLocalDateStr(new Date(e.start_time))`** and **merges `timer.running`** per day. The wide range + local re-bucket masks the timezone bug → Week is "accurate". Day view does neither → "missing tasks".
- `getEffectiveBlocksForDate` expands recurring `calendar_blocks` (daily/weekdays/mwf/weekly/custom) onto the target date.
- `getVisiblePlannedBlocks` trims past planned blocks (hides ended; clips in-progress start to now).

## Running-block timeline rendering (key to BUG #3)
- Day (`day.tsx` ~603-665) & Week (`week.tsx` ~373-416) render 2 parallel running entries as A│B split columns. **Both columns are positioned at `topB` (the later start)** for the side-by-side region → two distinct starts visually share a top edge = "same start time". ROOT CAUSE of #3.

## Settings (`app/(tabs)/settings.tsx`)
- `SheetFrame` (used by manager sheets) wraps content in `<ScrollView><Pressable flex:1>…</ScrollView>` with no bounded height → bottom clipping (#8).
- `day.tsx` `SheetShell` is a better pattern (maxHeight + internal scroll + fixed footer).
- Category **icon** field stores SF-Symbol-style **strings** ("brain","book") rendered as **raw text**, never as real icons (#9 — incomplete system).

## Known tech debt
- Single home resolved (test3 + redirect). Old design archived at `_archive/home-index.tsx.bak` — delete if no longer wanted.
- `getRunningTimers()` now `.order('start_time')` — running[0] is deterministically the earliest (was unordered).
- Pre-existing `day.tsx:104` type error fixed (`DimensionValue`).
- Dev data wiped to a clean slate 2026-05-27 (soft-delete; recoverable via `deleted_at` on `test@lifeos.dev`).

## Remote DB / admin notes
- Project linked: ref `iwkiflvwrzfvtpsmhpgd` (region ap-southeast-2). CLI authenticates via cached access token + login role; **no static DB password** in repo (`supabase/.temp/pooler-url` has none).
- Apply migrations: `npx supabase db push --linked`. Check state: `npx supabase migration list --linked`.
- Ad-hoc data ops without a DB password: use the PostgREST API (`$EXPO_PUBLIC_SUPABASE_URL/rest/v1/...`) with the anon key + a user JWT (from the app's `localStorage['sb-<ref>-auth-token']`). Respects RLS.
