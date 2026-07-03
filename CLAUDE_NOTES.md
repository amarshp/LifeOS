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

### Open threads / later
- Live streaming transcription (expo-speech-recognition) — needs native rebuild, do with next IPA build.
- Task dropdown in EDIT sheets (entry/block) — only add sheets have it now.
- materializePlan not idempotent on re-apply of manual plans (pre-existing note in daily-plans.ts).
- Client JS changes need a new build/IPA to reach the phone (no OTA updates wired) — server-side (migration + edge fn) is live immediately.
- gpt-4.1-mini sometimes hallucinates dates — date-clamp guard exists in runTool; keep for new tools too.
