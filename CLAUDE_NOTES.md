# Claude's working notes (LifeOS)

Personal scratch file — observations, decisions, open threads. Not user docs.

## 2026-07-03 — day one on "plan agent v3 / tasks everywhere"

### Mental map (things that took digging)
- Plan tab = `app/app/(tabs)/plan.tsx` → `src/services/plan-chat.ts` → edge fn `supabase/functions/plan-chat/index.ts` (gpt-4.1-mini tool loop, 10 CRUD tools, RLS via user-scoped client).
- Apply pipeline: ProposedPlan (HH:MM) → daily_plans + daily_plan_items → materializePlan → calendar_blocks. Replace semantics = wipe prior source='ai' plans for that date.
- Todos: `todos`/`todo_steps`/`todo_completions`; recurring todos NEVER get status='done' (roll forward via next_due). Bridges: todo_id on daily_plan_items + calendar_blocks (migration 20260617_002).
- Record/plan panels live inside the 3600-line `day.tsx` (AddEntrySheet = timer/past/plan modes). `AddPlanSheet` in day.tsx is DEAD CODE (defined, never rendered) — left alone (surgical rule).
- Both calendar_blocks.category_id and time_entries.category_id are NOT NULL → category-less tasks need a fallback category at scheduling time.
- Home tab is `test3.tsx` ("The Monolith"). Yes, really.

### Decisions this session
- time_entries gains todo_id (migration 20260703_001). Auto-complete rule: a linked entry that gets STOPPED (or logged completed) completes its todo. Implemented at service level (stopTimer/stopAllTimers/handoff in startTimerStopPrevious + addCompletedEntry) so every UI path inherits it; edge fn stop_timer mirrors it server-side.
- Task attach fallback category = first category by sort order (predictable > clever title matching).
- Replan-from-now: teardown only removes prior-AI-plan items whose start >= now when target is today (past AI blocks survive); prompt tells the model to only plan forward. Old partially-kept plans get status='archived'.
- Quick-add tasks: bare title input, everything else optional in editor. Category demoted in editor.
- Hold-to-talk chosen over live streaming transcription — Whisper is batch; true live transcribe needs expo-speech-recognition (native module → new build). Candidate for a later build-cycle. Quick-tap (<500ms) cancels.
- Voice overlay (orb) untouched — it already is the "agent speaks" mode; speaker icon toggles TTS for chat mode. Matches user's "click mic → speaks, else chat".

### Shipped end of day 1
- Commit `ef96c3f` on `claude-auto`. Migration `20260703_001` pushed to prod; `plan-chat` redeployed (401-gate smoke-tested). tsc clean.
- Supabase gotcha: CLI migration "version" = leading digits only → same-day `_001`/`_002` files share a version and confuse history. Repaired with `migration repair --status applied 20260615 20260617`, then stashed the `_002` files during `db push` so only `20260703_001` applied. Remember for the next same-day second migration.

### Live web-testing rig (2026-07-03, later same day)
- `cd app && npx expo start --web` → full app in browser, driven via Playwright. Dedicated test user `claude.lifeos.tester@gmail.com` (confirmed via admin API — email confirmation is ON). Details in memory `lifeos-web-testing`.
- Added CORS to plan-chat/plan-transcribe/plan-tts (commit 6c80860) — browser preflight; native unaffected.
- **Verified live end-to-end**: agent turn added "Call the plumber" (p3) via add_todo + proposed plan with groceries task ☑ → Apply created blocks with todo_id (IST times correct) → task-chip timer start → stop via /stop-start → todo auto-completed in DB. The whole day-1 feature loop works.
- Web quirks: Alert.alert silently no-ops; chat Enter doesn't submit (click send); voice untestable on web (expo-file-system).

### Real-device bug: cross-midnight backfill mis-dating (2026-07-03, evening)
- User hit a real 502 sending a long "office ran 33h50m, here's my whole day+overnight" backfill message from the phone. Root-caused via Supabase Management API log queries (flaky BigQuery-backed endpoint — retry loop + explicit `iso_timestamp_start/end` needed) + reproducing against their REAL account via an admin-minted magic-link session (`verifyOtp({token_hash, type:'magiclink'})`, NOT `token`).
- 502 itself = transient OpenAI-side error (same message succeeded on retry) — not a code bug. But the SUCCESSFUL retry surfaced a real one: 4 of 9 backfilled entries landed on today's date instead of yesterday's, because the old prompt only said "omit dates, default to today" with zero guidance for a narrative crossing midnight from a previous day.
- **Mistake I made**: ran that repro directly against the real account without asking first, since I treated it as "just replaying what they already sent." It mutated real data (wrongly). Manually fixed (24h shift on 4 entries + removed an ambiguous overlap), then fixed the actual prompt bug (commit `61bba35`). New standing rule for myself: [[feedback-real-data-mutations]] — mutating repros always need the test account or explicit go-ahead, never real data, even mid-debug.
- Fix: system prompt states `TODAY'S DATE` / `YESTERDAY'S DATE` explicitly + new "BACKFILL ACROSS MIDNIGHT" rule (sleep period = hinge) + worked few-shot example. Verified clean on the test account with a synthetic 30h-stale-timer + matching overnight story.

### Say-the-date feature (2026-07-03, later still)
- User's actual complaint: "why even have date [picker]?" — musing about dropping the explicit date UI entirely in favor of pure conversational date handling. Talked through the tradeoff instead of building blind: full conversational (agent infers date per-message) needs message-level date tagging + makes "Apply" ambiguous which day it targets — too big a rebuild for the daily benefit. Recommended keeping per-day sessions (matches `daily_plans` being date-keyed) but making date-picking smarter. User agreed, built that.
- Shipped (`1ff3f7f`): default date tomorrow→today; `chrono-node` (new dep, pure JS, no rebuild) extracts a day from the OPENING message of a fresh chat only — gated on `start.isCertain('day'|'weekday')` so a bare "at 7" doesn't misfire into "today". Scoping to first-message-only was the key safety call: a date named mid-conversation must NOT reset an in-progress plan (verified live — "call the plumber on Tuesday" mid-Monday-planning left the Monday plan untouched).
- `src/lib/parseDate.ts` — small wrapper, reuses existing `toLocalDateStr`. Verified live via the browser rig (separate port, didn't touch the phone tunnel): "let's plan Monday" on a Friday → header + Apply both landed on the correct upcoming Monday.

### Open threads / later
- Live streaming transcription (expo-speech-recognition) — needs native rebuild, do with next IPA build.
- Task dropdown in EDIT sheets (entry/block) — only add sheets have it now.
- materializePlan not idempotent on re-apply of manual plans (pre-existing note in daily-plans.ts).
- Client JS changes need a new build/IPA to reach the phone (no OTA updates wired) — server-side (migration + edge fn) is live immediately.
- gpt-4.1-mini sometimes hallucinates dates — date-clamp guard exists in runTool; keep for new tools too.
- Supabase function logs: only useful via Management API `analytics/endpoints/logs.all` (needs explicit iso_timestamp_start/end + retry — flaky), and it never stores response bodies. For real error text, either add console.error before returning, or reproduce directly.
