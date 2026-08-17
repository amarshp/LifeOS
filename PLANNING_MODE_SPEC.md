# Planning Mode Redesign — Spec

Status: Phase 4 (§13) BUILT 2026-08-17 — client (service + `/pulse` screen + Now-tab peek icon) and
server (`concerns.metric_at_open`, migration applied) both complete; see §13f. Sequencing was
originally "Phase 4 waits for Phase 3 to close out," superseded same day (§13e) — both ship
together in one build. Phase 1 (§9) AND Phase 2 (§11) built and deployed. Phase 3 (§12) BUILT
2026-08-17 (revised design per §12e — the first draft's trigger was rejected by Amarsh before
implementation, see below), NOT YET DEPLOYED — code complete in `brain/index.ts` and
`plan-chat/index.ts`, holding per his "don't run the build yet" (referring to the Codemagic/native
IPA build; this covers edge-function deploys too — the actual `late-diversion` push firing on his
real phone before he's seen it calibrated is exactly the kind of thing worth a check-in before
deploying, not just before the native build). Two claim-accuracy audit passes done after Phase 1
shipped: §4a (bias check, md-vs-md) and §4c (raw-data re-derivation from the actual CSVs, not just
the `.md` summaries) — both found and fixed real errors. Live code current as of both passes plus
Phase 2; Phase 3 + Phase 4 code written but not deployed/built. REMAINING before this can ship:
deploy `brain` + `plan-chat`, one consolidated Codemagic build, then the §13d walkthrough.

## 13. Phase 4 — closed feedback loop, trends, correlations + a new calm "what matters" page (BUILDING 2026-08-17)

**Why:** After Phase 3 shipped its research, Amarsh asked what else the Agent should do to actually
improve his life, plus asked for competitor research (3 parallel agents: AI day-planners, quantified-self/
wellness apps, habit/voice-journaling apps). One finding triangulated independently across my own
read AND the wellness-app research: LifeOS's nudges have no memory — a concern fires, maybe gets
pushed, and nothing ever checks whether it actually changed behavior. Oura Advisor's "Memories"
feature does exactly this (remembers past advice, checks if metrics moved, refines future advice).
Separately, Amarsh flagged that `/insights` (the existing analytics screen) is "too much information"
and he's never once opened it — confirmed by reading it: 8 dense sections (diagnosis cards, plan-vs-
actual bars, drift table, donut breakdown, trend chart, calibration, streak heatmap, diagnostics),
built to audit tracking accuracy, not to answer "how is my life going." He wants Phase 4's findings
surfaced somewhere calm and visible instead — his words: "so I can open it peacefully," "not
something hidden."

**Real-data dry-run before building** (scratch script against the live account, read-only, same
discipline as §11's verification): confirmed the §12e→§12b fix was not just theoretically correct
— last night (Aug 16) had 3 unplanned late entries ("Watching Chainsaw Man" 3:01am, "Discussion
about Chainsaw Man movie" 4:39am, "Watching reels" 4:49am), which the old per-entry design would
have counted as 3/3 toward the threshold; the fixed night-based counting correctly collapses this
to 1. Current live state: `count7d=1, sleepCost=false, gymCost=true → would NOT trigger`.

**Gym-gap staleness finding:** the "43 days since gym" number is measuring from **2026-07-05**, the
most recent `time_entries` row titled Gym — which is the tail of the one-time Hevy CSV backfill
(§11's `scripts/backfill-hevy.cjs` run, CSV only covered up to late June/early July). Amarsh
confirmed: this gap is substantially a data-staleness artifact (his own gym use likely continued
past the CSV cutoff, just not reflected here), not confirmed real absence. He's sending a fresh
Hevy export ([[hevy-amazfit-refresh-pending]]) to close the gap, and will log new sessions directly
in LifeOS going forward — no further Hevy exports needed after that specific backfill. Amazfit is a
separate, already-one-time thing (calibration only, never a live sync into `time_entries`) — not
needing more of it isn't new, and isn't related to in-app logging. The real open item is separate:
**sleep logging in LifeOS itself is sparse right now** (1 real Sleep entry in the last 7 days, ~15
real nights out of the last 90 — confirmed via raw query, plus 3 stray zero-duration "Sleep" rows
found, probably failed Siri voice-track attempts, left untouched pending Amarsh's say-so per
[[feedback-real-data-mutations]]). This directly shapes what Phase 4 can honestly show on day one
(see 13b).

### 13a. Underlying data work (feeds the page, also improves `brain`'s own future decisions)

1. **Outcome tracking — reusing `concerns`, not a new table.** `concerns` already has `created_at`,
   `status`, `resolution`, `updated_at` (checked the live schema before designing this — no new
   table needed, REUSE not duplicate). Adding one column, `metric_at_open numeric` (nullable),
   captured when a concern is first created — each `DetectedConcern` in `brain/index.ts` gains an
   optional `metricValue` (debtH for sleep-debt, daysSinceAny for gym-gap, count for
   late-diversion) so the code never has to regex-parse the `evidence` string. On resolution (the
   existing "condition cleared" follow-up loop), compute days-to-resolve from `created_at` and
   write an enriched, specific `resolution` string ("resolved in 3 days: gym gap 43→0") instead of
   the current generic "condition cleared". This is what makes the "did it work" card real — reading
   resolved concerns IS the log, no new table required.
2. **Trend queries** — client-side service function querying `time_entries` directly (same pattern
   as `insightsService`/`categoriesService` — RLS-scoped, no new edge function needed for a read),
   rolling 30/90-day series for gym frequency now; sleep-debt trend held back per the sparsity
   finding above until logging is denser.
3. **Confidence-gated correlations** — building the general-purpose logic now (paired-day
   Pearson/Spearman, lagged day-N-vs-N+1, gated on n≥14) even though the sparsity finding means it
   will correctly render nothing today — that's the design working as intended (§13c), not a bug to
   route around.

### 13b. The page — finalized v1 content, based on measured data density, not imagined

- **Gym-frequency trend card** — real, dense data once the fresh Hevy backfill lands; ships now.
- **"Did it work" card(s)** — starts empty (nothing has resolved under the new tracking yet),
  fills in naturally as concerns open and clear post-deploy.
- **Sleep-debt trend and any correlation card — held back at launch**, not because the code is
  hard but because 1-in-7-nights data would produce a misleading sparse chart. Code ships ready;
  content appears once density supports it, same "no placeholder" discipline as 13a.3.
- **New: a plain callout if sleep logging itself has gone quiet** ("no Sleep entry in N days") —
  more honest and more useful right now than a chart would be, and cheap off data that already
  exists. Added after the real-data dry-run surfaced the sparsity, not part of the original design.
- Placement: a small peek ("N things worth knowing") surfaced from the Now tab, tapping through to
  the full page.

### 13c. Non-goals

- Not a redesign of `/insights` — that screen stays as the tracking-accuracy audit tool it already
  is; this is a genuinely separate, smaller surface with different curation logic (show only
  signal, vs. show everything).
- No correlation claims below the confidence threshold, ever — matches the raw-data-verification
  standard the rest of this project has held to ([[feedback-verify-against-raw-data]]).

### 13d. Explanation-on-ship requirement

Amarsh explicitly flagged: "if I don't know what's there, I won't use them." Shipping Phase 4 (and
closing out Phase 3) must end with a plain walkthrough of what's new and where to find it — not a
silent deploy. Add this as the literal last task of whichever phase ships last.

### 13e. Sequencing note

Originally scoped to start only after Phase 3 (§12) fully closed out (deploy + native build).
Superseded 2026-08-17: Amarsh said to build Phase 4 fully now, in parallel with Phase 3 still
sitting undeployed — both will ship together in one consolidated build per his standing "don't
push more builds" instruction, not as strictly sequential phases.

### 13f. Client build (2026-08-17)

- `app/src/services/lifeSignals.ts` — client-side reads only, same pattern as `insightsService`
  (direct `supabase.from(...)`, RLS-scoped, no new edge function). `getGymFrequencyTrend(days)`
  (weekly buckets), `getDaysSinceLastSleep()`, `getRecentNudgeOutcomes(days)` (resolved concerns
  with `notified_count > 0`), `getSleepGymCorrelation(lookbackDays)` (lagged Pearson, sleep hours
  night N vs. Gym on N+1).
- **Sleep-category matching corrected mid-build.** First draft used a Supabase embedded-relation
  filter (`categories!inner(name)` + `.eq('categories.name', ...)`) that has no precedent anywhere
  else in this codebase — untested syntax, not a proven pattern. Replaced with the same
  fetch-categories-then-filter-by-id approach `brain/index.ts` already uses (`catName` lookup),
  matched to its exact "name contains 'sleep'" heuristic so client and server agree on what counts
  as a sleep entry.
- **Correlation gate was too weak as first written.** Gating on `n >= 14` alone lets a near-zero
  `r` render as a directional claim — real-data dry-run below hit exactly this (`r = -0.05` on 15
  paired nights, which the original code would have shown as "tend to move apart" with 1 star).
  Added `MIN_ABS_R = 0.3`: below that, the function returns `null` and the card doesn't render,
  same as the sample-size gate. This is what §13c's "no correlation claims below the confidence
  threshold" actually requires — sample size alone isn't a confidence threshold, effect size is
  part of it.
- **Real-data dry-run** (scratch script mirroring the service functions exactly, read-only, real
  account): gym trend over the last 56 days shows only 2 sparse weeks (`2026-06-22: 1`,
  `2026-06-29: 4`) then nothing — consistent with the already-confirmed gym-gap staleness finding,
  not a bug; the sparkline will render mostly empty until the fresh Hevy backfill lands.
  `getDaysSinceLastSleep` = 0 (last Sleep entry ended same-day) — quiet-callout correctly gated
  off right now. `getRecentNudgeOutcomes` returns real resolved concerns, but all still show the
  OLD generic `"condition cleared"` string — expected, since `brain/index.ts`'s
  metric-at-open/verdict logic (§13a.1) hasn't been deployed yet; new resolutions will use the
  richer format once it is. Correlation: 15 paired nights, `r = -0.054` — correctly gated out by
  the new `MIN_ABS_R` check (would have rendered a misleading card without it).
- `app/app/pulse.tsx` — new route (sibling to `notifications.tsx`/`review.tsx`, same
  SafeAreaView+header pattern), renders only the sections with real signal; an explicit "Nothing
  notable yet" empty state only if literally every section is gated off.
- Entry point: a small pulse-line icon added to `app/app/(tabs)/test3.tsx` (the Now tab) next to
  the existing bell/gear icons — always visible (per Amarsh: "not something hidden"), with a quiet
  dot badge when something's fresh (sleep gone quiet, or a nudge resolved in the last 3 days).
  Verified live via Expo web + Playwright: icon renders, tap routes to `/pulse`, page renders the
  real "did it work" card from the tester account's actual `concerns` data.
- Verified: `npx tsc --noEmit` clean. No project ESLint config exists (checked `package.json`) so
  type-check + live browser verification is the bar, matching how the rest of this session's UI
  work was verified.

## 12. Phase 3 — general-evidence tier + late-night diversion nudge (scoped 2026-08-17, not yet built)

**Why:** Amarsh wants the Agent's knowledge visibly split into two tiers instead of blended: (1)
general research-backed evidence (sleep hygiene, exercise recovery, screens-before-bed — with
Bryan Johnson's Blueprint as one explicitly-flagged reference, not gospel), and (2) evidence
inferred from his own tracked data (tier 2 — already built, §11, already live-refreshing). Plus a
new generic capability: gently flag when he starts logging something unplanned late at night —
gaming/reels/a movie, but also "starting new work late" (his own example — this is about
diversion from the plan, not a leisure-activity blacklist).

**Research done, 4 independent agents, each with its own sourced/confidence-tagged file** (research
only — no product claims taken on faith, each doc tags every claim CONSENSUS/MODERATE/WEAK or
A/B/C/D, and two of the four agents caught and fixed their own sourcing mistakes — fabricated
citation details, one misattributed vendor blurb — via an advisor pass before finalizing):
- `research/sleep-hygiene-evidence.md` — screens/light, wind-down window, caffeine/alcohol timing,
  naps, sleep debt & "catch-up" (mostly a myth for chronic debt), revenge bedtime procrastination.
- `research/exercise-recovery-evidence.md` — same-muscle recovery windows, overtraining signals
  (no single diagnostic marker exists — need ≥2 concurrent signals over ≥1-2 weeks), AM/PM
  training (no real performance edge either way), detraining curves, exercise-before-bed buffer.
- `research/bryan-johnson-blueprint.md` — his protocol itemized rule-by-rule with an A-D
  credibility tag each; explicitly separates his personal daily routine from Blueprint's published
  generic reader program (they don't fully agree). Several items flagged D (contested/walked
  back): chasing a "100 sleep score" (orthosomnia risk), zero-rest-day daily training (evidence
  points to a J-shaped dose-response curve — benefit peaks ~30-60 min/week, not 6 hrs/day), and
  sleeping separately from his partner (he abandoned this himself).
- `research/avoidable-behavior-psychology.md` — bedtime procrastination is a reclaiming-autonomy /
  self-regulation pattern, not an information gap ("ego depletion" as a resource-drain model
  failed a 23-lab replication, d≈0.04 — the credible framing now is a motivational *shift* toward
  reward, not a depleted *capacity*). Directive/shame framing measurably backfires via
  psychological reactance; autonomy-supportive framing referencing the person's own stated intent
  works better. Implementation intentions ("if-then" pre-commitments) are one of the most
  robustly-replicated levers in behavior-change psychology (d≈0.65, 94 studies).

### 12a. Two-tier split — where each piece of knowledge actually lives

- **Tier 1 (general, near-static)** — a curated set of only the CONSENSUS/WELL-ESTABLISHED and
  A/B-tier claims (never Blueprint's C/D-tier specifics — no 300mcg melatonin, no 8:30pm bedtime,
  no HBOT, no "no sex after 8pm") gets added to `plan-chat`'s system prompt as general knowledge
  the Agent can cite in conversation, explicitly labeled as research-derived and kept visibly
  separate from tier 2 ("general research says X" vs. "your own data shows Y" — never blended into
  one unattributed voice). No new automated `brain` rule for most of tier 1 — it's conversational
  knowledge, not a structured trigger, because LifeOS doesn't track caffeine/alcohol/screens as
  data, so there's nothing to gate an automated check on. Covers: wind-down window (45-60 min),
  caffeine cutoff (8-10h, dose-dependent), alcohol disrupts sleep architecture even at low doses,
  nap duration (~20min or ~90min, avoid the 30-60min zone, by ~3pm), weekend catch-up sleep does
  NOT fully reverse chronic debt, exercise-before-bed buffer (≥4h safe any intensity, ≤1h risky if
  high-intensity), same-muscle recovery floor (~36-48h for a trained lifter), detraining is
  forgiving for ~2 weeks off.
- **Tier 2 (personal, already live)** — unchanged, already built in §11/§6a: `wellness-evidence.ts`
  queries live `time_entries` every call, no caching, always current. Nothing new needed except
  the already-parked Hevy/Amazfit CSV refresh ([[hevy-amazfit-refresh-pending]] memory).
- **Two small existing-code refinements, informed by tier-1 research:**
  1. `post-activity-nap`'s suggestion text (brain) gets the evidence-backed duration guidance
     added ("~20 min, or a full ~90 min if you can spare it — avoid 30-60 min, that's the grogginess
     zone") instead of just suggesting a nap with no duration guidance.
  2. `RECOVERY_DAYS`/`DEFAULT_RECOVERY_DAYS` in `wellness-evidence.ts` (currently `legs: 3,
     lower: 3, default: 2`) — flagged as a CANDIDATE change, not committed: the new research
     suggests a trained lifter's per-muscle recovery is often *shorter* than the current 3-day
     legs/lower figure (~36-48h floor once trained), but the source for that specific number is a
     single small study on an untrained population, and the code's own existing comment says his
     raw Hevy data "neither confirms nor contradicts" a specific number. Leaving as-is unless
     Amarsh wants it touched — this is population research, not a personal-pattern finding, and
     changing a working threshold on weak single-study evidence isn't obviously worth it.

### 12b. New `brain` concern: `late-diversion` (FINAL design — see §12e for the rejected first draft)

- **Trigger, pattern-gated not moment-to-moment:** `lateDiversionCount >= 3` in a rolling 7 days
  AND (sleep debt > 3h OR gym gap >= 3 days — the same thresholds already used by `sleep-debt`/
  `gym-gap`, reused rather than invented fresh). An "unplanned late" instance = a non-Sleep entry
  starting inside the late window (personal `recBedClock` from `computeSleepEvidence` minus a
  ~60min wind-down buffer, or a fixed fallback of 23:00 if `nightsLogged` is too low for a personal
  estimate yet) where NO `calendar_blocks` row's time window covers that start at all — a
  time-overlap check only, never a title match (Amarsh explicitly said block titles/timing vary
  too much to compare against). No category blacklist: "starting new work late" and "opening
  reels" both qualify identically, since the trigger is *unplanned + late + part of a real
  pattern*, not a specific activity type or a single instance.
- **Rate limit:** undated key `late-diversion` (continuous concern like `gym-gap`, not daily-reset
  — refreshes each run, auto-resolves when the pattern clears), 48h cooldown once it has fired.
- **Logging, every run regardless of trigger** (Amarsh explicitly asked for this — "so we can give
  you this whole thing and make changes as necessary"): `detectConcerns` now returns
  `{ concerns, diagnostics }`, and `runForUser` always appends the diagnostics line to
  `brain_runs.summary` — `late-diversion: count7d=N, sleepCost=bool, gymCost=bool` on every single
  run, whether or not the concern actually opens. This means the count(3)/cost-signal thresholds
  can be tuned against real observed data from `brain_runs` before ever changing behavior, not
  guessed once and left alone.
- **Wording — built directly from the psychology research's design-implications section:** always
  a real choice, never a directive, references the actual pattern + actual cost signal with real
  numbers, never mentions willpower/tiredness/depletion (found both scientifically unsupported and
  likely to backfire). E.g. *"3 late, unplanned nights this week, and you're already ~4.2h short on
  sleep — worth a look at what's driving the late starts?"* Counts distinct NIGHTS, not raw entries
  — three unplanned switches in one bad night is one data point, not three (Codex review caught the
  original draft conflating the two; also caught an off-by-window bug on overnight `calendar_blocks`
  and a null-title crash risk — all three fixed, see `brain/index.ts`).
- **One-off deviation deliberately does NOT live here** — it stays exactly where it already lived
  before this phase: the Agent's existing evening-review step ("point out ONE meaningful deviation
  from the plan," `plan-chat/index.ts`, already built, unchanged) — a conversational surface Amarsh
  opens himself, not a push notification. No new code needed for this half; it was already correct.

### 12c. Explicitly not building in this pass

- No phone/OS-level screen-time or app-usage integration — LifeOS only knows what's logged, and
  the research's own recommended design (plan-vs-actual divergence) doesn't need more than that.
- No automated rule for every tier-1 fact (caffeine/alcohol/exercise-timing) — those stay
  conversational/system-prompt knowledge since there's no structured data to gate a `brain` check
  on; only nap-duration and the new late-diversion rule become automated triggers.
- No retrieval/RAG system for the research docs — a single-user app doesn't need one; curated
  constants in the prompt/shared module is the same pattern tier 2 already uses successfully.
- No implementation-intention ("if-then" pre-commit) UI yet, even though the research flags it as
  the single strongest lever (d≈0.65) — worth a future pass once the plain divergence-nudge above
  has been used for a while and Amarsh has a feel for whether it's enough on its own.

### 12d. Tasks

1. DONE — tier-1 general-knowledge block added to `plan-chat`'s system prompt, explicitly
   separated in framing from tier-2 evidence.
2. NOT NEEDED — `post-activity-nap`'s suggestion text already had the 20min/90min duration
   guidance from Phase 2, before this research existed to confirm it. Checked the live text before
   assuming it needed a change; it didn't.
3. DONE — `late-diversion` concern kind added to `brain/index.ts`'s `detectConcerns`, pattern-gated
   design per §12b (not the rejected §12e draft), reusing `computeSleepEvidence`/`computeWorkoutEvidence`
   for the cost-signal thresholds and a `calendar_blocks` time-overlap lookup for the
   planned-vs-actual check. Diagnostics-every-run logging added per Amarsh's explicit ask.
4. NOT YET DONE — dry-run the decision logic read-only against real data (same verification
   pattern as §11), then deploy and confirm via `brain_runs`. Holding per "don't run the build yet"
   — deploying activates a real push if his current data already crosses the threshold, which he
   hasn't seen calibrated yet; worth an explicit go-ahead separate from the native-build hold.
5. NOT YET DONE — one consolidated Codemagic build once this + the already-fixed `plan.tsx` UI bug
   are both in and Amarsh has confirmed the deploy.

### 12e. Rejected first draft (kept for the record, not the live design)

The first pass at `late-diversion` (written before Amarsh reviewed it) triggered on ANY single
unplanned-late entry, matched by comparing the entry's title against `calendar_blocks` titles for
that slot. Amarsh corrected this before any code was written: block titles legitimately differ
from what actually happens, timing against a tentative plan is always going to be loose, and a
push that fires on every mismatch trains him to ignore it — dead weight for the rare time it
matters. He drew a sharper line: plan-timing reminders (the existing "starts in 5 min" nudge) are
the right proactive channel for *timing*; going off-plan in the moment is a conversation topic
(evening review), not a push; only a genuinely *destructive, sustained pattern* — his own example,
saying he'd take a break and then overworking morning after morning — earns a proactive nudge. He
also raised the deeper open question of nudge "personality" (too pleasing → never pushes back, too
Goggins → never allows rest) — the answer applied here: gate on multi-signal + duration (never a
single data point, so it can't default to either extreme) and word every nudge as a choice
referencing his own stated intent (never a directive, so it structurally can't become a commanding
voice). Both constraints were already implicit in the existing brain design (budget/cooldown, the
overtraining-consensus multi-signal gating from `exercise-recovery-evidence.md`); §12b's final
design applies them explicitly to this new concern rather than inventing new rules.

## 11. Phase 2 — brain proactive nudges (built same day as Phase 1 + audits)

Extended `supabase/functions/brain/index.ts`'s `detectConcerns` with three new kinds, following
the exact existing pattern (GAP/DRIFT/COMMITMENT/MORNING/EVENING) — same push/cooldown/budget/
quiet-hours pipeline, no new delivery mechanism:
- `gym-gap` — undated key (continuous concern, like COMMITMENT), fires when `daysSinceAny >= 3`,
  importance 3 if `>= 7`. 24h cooldown.
- `sleep-debt` — dated key (resets daily, like EVENING), fires when `debtH > 3` AND hour is 19-23
  (only actionable in the evening). 24h cooldown.
- `post-activity-nap` — dated key, fires when in the 13:00-16:00 nap window AND `debtH > 1` AND
  the most recently completed entry was Commute or Office AND ended within the last 20 minutes —
  the concrete "as soon as I get home" trigger, riding the existing 30-min cron / app-foreground
  tick rather than a new real-time pipeline. 4h cooldown.

**Reuse, not a third copy of the math:** extracted the sleep-debt/wake-bedtime and
workout-rotation computation (already audited twice for `plan-chat`) into
`supabase/functions/_shared/wellness-evidence.ts`, and refactored `plan-chat`'s
`buildEvidenceSnapshot` to call it instead of keeping its own inline copy. Both edge functions
now compute these numbers from one source — they can't silently drift apart. Verified after the
refactor: re-ran the live plan-chat check on the real account, numbers matched exactly (43 days,
114/106/105/43 by type, 4.6h/2.4h sleep) — no regression from moving the code.

**Bug caught before deploy:** an initial version tried to build `catName` and call
`computeSleepEvidence` inside the same `Promise.all` array that also fetches `categories` —
`categories` isn't assigned until the whole `Promise.all` resolves, but `computeSleepEvidence`
needs to call `catName` (which reads `categories`) *during* that same `Promise.all`, before it
resolves. Fixed by resolving `categories` in its own `Promise.all` first, then building `catName`,
then a second `Promise.all` for the evidence functions — matches how `plan-chat` already
sequences this (categories loaded before evidence snapshot).

**End-to-end verified on the real account:** dry-ran the three new blocks' decision logic
read-only against live data first (nap-suggestion correctly silent outside the window,
sleep-debt correctly silent at 2.4h debt < the 3h evening threshold), then invoked the deployed
function for real. Result: `gym-gap` correctly opened (43 days, importance 3, detail/evidence
correct in the `concerns` table) but stayed silent — the existing daily attention budget was
already spent on other concerns today, so nothing pushed to the phone. No new code was needed to
get that protection; it's inherited from the existing pipeline. Confirmed no real push landed by
checking the run's own result string (`silent gym-gap (attention budget spent)`).

**Not yet tried**: `sleep-debt` and `post-activity-nap` haven't fired for real yet (conditions
weren't both true at test time) — will only be seen when the real conditions line up during
normal use.

## 1. Problem

The Agent day-planner (`plan-chat` edge function) currently produces a generic plan. Amarsh's
own words: *"I can make my own generic plan but I will do what I want to do, not what should be
done cuz I don't have enough data."* He wants the plan grounded in his own tracked behavior
(recency/frequency of activities, sleep, workout rotation) and willing to have the agent push
back on him when the data says he's overreaching — explicit, deliberate opt-in to nudging:
*"I feel the balance is being disturbed because I'm too aggressive when I work and motivate
myself... I'm willing to nudge."*

Behavioral spec he gave, concretely:
- Proactively ask clarifying questions during planning ("Are you feeling sleepy now?").
- Suggest a nap right after he gets home from office, if evidence supports it.
- Tell him to skip the gym some days ("you're not sleeping properly... I think you should take
  a rest day") or go "at any cost" if he's been skipping it.
- Ground all of this in empirical data, not vibes, and be blunt when the data is bad.

## 2. Prior art found (do not rebuild)

| Need | Already exists | Where |
|---|---|---|
| Feed computed facts into planning chat, "interpret never contradict" | `buildEvidenceSnapshot` | `supabase/functions/plan-chat/index.ts` (~line 1300-1377) — currently only 7-day category totals + crude nightly sleep average |
| Recency/frequency weighting of activities | `getCategoryUsageNearHour` | `app/src/services/time-entries.ts:373-408` — 90-day window, hour + weekday proximity weighting. Only wired into Home tab quick-start chips, **not** the planner |
| Real-time proactive nudges (30-min cron + app-foreground trigger) | `detectConcerns` | `supabase/functions/brain/index.ts` (418 lines) — concern shape `{key, kind, title, detail, evidence, importance}`, kinds today: `gap \| drift \| commitment \| morning \| evening`. No sleep/gym kind exists |

Conclusion: this is an **extension** of two existing systems, not a new subsystem.

## 3. The staleness question — answered

Checked `C:\...\Personal\Projects\LIFE Data\` directly (sibling project, not a git repo, no
scripts). It contains:
- `Hevy Data.csv` — 4 years of gym logs, one-time manual export.
- `Zepp data/` — Amazfit companion app's one-time raw export (timestamped dump folder). No
  automated pull exists or is practically buildable (no stable public API).
- `INSIGHTS.md` / `CHECKLIST.md` — a genuinely rigorous one-off analysis (HAC-corrected trends,
  FDR-corrected significance testing) done manually on that export.

**Decision: do not build an ongoing external sync.** There is nothing to sync from — both
sources are dead exports. Instead:

- Treat `INSIGHTS.md`/`CHECKLIST.md` as a **one-time calibration source**: the specific,
  already-validated numeric thresholds below get seeded as starting constants.
- From day one of the new feature, **LifeOS's own live `time_entries`/sleep logs become the
  source of truth** going forward, via the same rolling-window pattern `getCategoryUsageNearHour`
  already uses. Nothing goes stale because nothing is a static import — it's a live query.
- The 4-year Hevy history is *optionally* useful as a one-time historical backfill import so the
  rolling stats aren't starting from zero — see Open Question 1.

## 4a. Bias check (2026-08-17, prompted by Amarsh's brother)

Two claims below were flagged as possibly biased, and checking `FINDINGS.md` (a file I hadn't
read when I first wrote this section — should have) confirms both concerns, with the source
document's OWN caveats:

1. **"Morning gym is better" — never actually encoded anywhere (neither in this spec's constants
   nor in the deployed prompt/code).** It exists only in `FINDINGS.md` as a weak, self-flagged
   hypothesis: "you lift relatively better earlier in the day (ρ=−0.16)... **Morning-lift edge
   rests on only 88 morning sessions; may skew fresh/weekend**" — the source material already
   treats it as "test this," not a rule. Confirmed: not a live bug, nothing to fix, just don't
   promote it later without the same caveat attached.

2. **"PPL types (Push/Legs/Boxing) are more consistent than Full-body/Pull" — real finding, but
   Amarsh's brother's instinct about reverse causation is exactly right for a DIFFERENT, related
   claim I almost let bleed in: whether PPL as a whole PROGRAM is better than Upper/Lower.**
   `FINDINGS.md` has an entire section on this, titled **"Is PPL 3:1 optimal for you? No — use
   Upper/Lower"** — and the reasoning is sharper than a confounding story: PPL needs ~5-6
   sessions/week to hit each muscle twice; Amarsh's real frequency is ~1.6-2.7/week, so PPL
   trains each muscle group LESS than any alternative at his actual cadence — a structural
   mismatch, not just a correlation. His real, currently-followed `CHECKLIST.md` program is
   Upper/Lower — deliberately, for this reason, not as a symptom of being busy. **§6a's original
   framing ("PPL floating-cycle is gold-standard") was generic-literature framing that never made
   it into the deployed prompt/code (checked: it didn't), but was the wrong takeaway to lead
   with for him personally — corrected here.**
   The distinct, narrower finding that DOES hold up — individual session TYPE (not whole-program
   choice) predicts how fast he returns — is still real (p=0.001, see corrected numbers in §4c;
   an earlier pass of this bullet mis-grouped Pull into a slow-return bucket it doesn't belong in)
   but is a correlation about which activity he reaches for, which can itself be confounded by why
   he reached for it that day. Downgraded accordingly (see prompt change below) — mentioned as a
   loose pattern, never as sole grounds for a directive, and the code's rotation logic
   (`WORKOUT_TYPES`/`RECOVERY_DAYS`) was already program-agnostic — it treats
   push/pull/legs/upper/lower symmetrically and doesn't privilege PPL, so no code fix was needed
   there.

**Systemic fix, not just a patch on these two claims** — added to the live prompt: (a) an
explicit instruction to always state WHICH number drove a recommendation, not just the
conclusion, so Amarsh can catch a wrong read himself; (b) an explicit distinction between direct
measurements (days since last session, hours slept — state as fact) and behavioral correlations
(which activity choice predicts which outcome — confoundable, state as a loose pattern at most,
never as sole grounds for a directive).

## 4c. Second audit pass (2026-08-17, same day) — raw data, not just the .md summaries

Amarsh's direct pushback: *"how can you trust the md files blindly?"* — correct. §4a only
cross-checked one markdown file against another; that verifies transcription, not truth, since
the `.md` files are themselves an earlier session's DERIVED conclusions, not the source data. This
pass went to the actual artefacts: `Hevy Data.csv` (raw, 8,948 sets) and the raw Zepp export
(`SLEEP_*.csv`, 327 nights) — recomputing key numbers independently, plus two parallel agents (one
mining the 6 remaining LIFE Data `.md` files not yet read, one re-verifying every baked-in number
against `INSIGHTS.md`/`FINDINGS.md` line-by-line). Three real findings, already fixed above and in
the live code:

1. **The 3-day "comeback odds" curve doesn't reproduce.** Independently recomputing the discrete
   hazard P(resume next day | already off k days) from the raw Hevy CSV gave 24% / 20% / 13% /
   22% / 19% for days 1-5 — not close to the cited 48% / 47% / 36% / 25%, and not even the same
   monotonic shape (day 4 is HIGHER than day 3 in the recompute). This may be a metric-definition
   mismatch rather than the original number being wrong — the exact original method wasn't fully
   specified — but the doubt is real enough that asserting the precise curve as fact in the live
   product isn't honest. Fixed: the evidence line no longer states a specific curve, just the
   plain day-count (`plan-chat/index.ts`, deployed). The underlying gym-frequency decline
   (11.5→7.0/mo) and the general "long gaps are risky" direction both hold up independently and
   are untouched.
2. **Pull was wrongly grouped as a slow-return type.** `INSIGHTS.md`'s own median-gap table:
   Boxing 1.6d, Legs/Push 2.1d, **Pull 2.9d**, Full-body/Upper 3.9d — Pull belongs with the fast
   group, not "~4 days" with Full-body. This exact error was in an earlier version of §4's
   bullet and **survived the §4a bias-check pass without being caught** — a reminder that one
   audit pass doesn't catch everything. Independently confirmed from the raw CSV too (pull median
   2 days in my own recompute). Fixed in §4's bullet above.
3. **"Sunday is worst" is superseded by the source document's own later, more careful section**
   (`FINDINGS.md` "When you break your sleep cycle"), which found the real weekday driver is an
   early forced wake (Sun-Wed), not a late bedtime — bedtime only explains the Fri-Sun shortfall.
   The document says so explicitly ("Mon-bed / Tue-wake is the true bottom... reconciles with the
   earlier 'Sunday worst' finding"). Independently confirmed from the raw Zepp CSV: Monday's
   wake-morning average is 6.29h (clearly the worst of any weekday), Sunday's is 7.6h (one of the
   best) — "Sunday worst (6.3h)" does not survive a from-scratch recompute. Fixed in §4's bullet.

**What DID hold up under raw-data re-derivation** (worth stating plainly, not just the misses):
gym frequency decline (11.6/mo → 7.0/mo, near-exact match), weekday-vs-weekend sleep gap (43min
raw vs 47min cited, close), the bedtime→duration correlation (raw Pearson r=−0.301 vs cited
ρ=−0.31 HAC-adjusted — a striking independent match), the "one bad night doesn't hurt lifting"
finding, the 1-rest-day-is-peak finding with its correctly-scoped hedge on the weaker 3+-day part,
break-rate-by-type numbers (Push 8%/Boxing 9%/Legs 11%/Untagged 17%/Pull 25%/Full-body 32% — my
own recompute landed within a few points of every one of these), and the 48h/72h generic recovery
defaults (neither confirmed nor contradicted by anything in LIFE Data — correctly labeled as
generic literature, not personal data, in both the code comment and this spec).

## 4. Personal calibration constants (seeded from his own data, not textbook averages)

These come from `INSIGHTS.md`/`CHECKLIST.md` and are more authoritative than generic literature
where they overlap — they're his own statistically-tested findings, not population averages:

- **CORRECTED (§4c) — sleep shortfall has TWO different mechanisms, not one:** late bedtime
  (ρ=−0.31, p<0.0001) explains the Fri-Sun shortfall; but the bigger, more chronic Sun-Wed
  shortfall is driven by an EARLY FORCED WAKE despite an already-early bedtime, not by staying up
  late — `FINDINGS.md`'s own later, more careful section says this explicitly and supersedes the
  simpler "Sunday is worst" framing this bullet used to have. Confirmed independently against the
  raw Zepp CSV, not just the doc's own words: Monday's wake-morning average is 6.29h (clearly the
  worst), Sunday's is 7.6h (one of the best) — the old "Sunday worst (6.3h)" claim doesn't survive
  a from-scratch recompute. Weekday-vs-weekend gap independently confirmed (~43min raw vs ~47min
  cited — close). Practically the ACTIONABLE fix barely changes (still: bank sleep earlier
  Sun-Wed) — this correction is about the agent explaining the right WHY, not a behavior change.
- **Sleep quality does NOT predict next-day lift performance for him** (tested multiple ways, all
  null) — evidence snapshot should never suggest "skip gym, you slept badly" on a single bad
  night. Only sustained multi-day sleep debt should trigger a rest-day nudge.
- **3-day gym gap is worth flagging, but the specific "comeback odds" curve is now UNVERIFIED —
  removed from the live evidence text (§4c).** An independent re-derivation from the raw Hevy CSV
  (discrete hazard: P(resume next day \| already off k days)) gave 24%/20%/13%/22%/19% for days
  1-5 — nowhere close to the cited 48%/47%/36%/25%, and not even the same monotonic shape. Could
  be a metric-definition mismatch (their exact method wasn't fully specified) rather than the
  original being wrong, but given real doubt, the live code now reports the plain day-count and
  lets the model's own hedging rules frame it, instead of asserting a precise curve as fact.
- **Workout TYPE predicts adherence, not day/fatigue — CORRECTED grouping (§4c):** actual median
  days-to-next-session per `INSIGHTS.md`'s own table: Boxing 1.6, Legs/Push 2.1, **Pull 2.9**,
  Full-body/Upper 3.9. Pull was wrongly folded into a "Full-body/Pull ~4 days" slow-return bucket
  in an earlier pass of this doc — Pull actually returns almost as fast as Push/Legs (2.9d, not
  ~4d). Confirmed independently from the raw CSV too (pull median 2d in my own recompute). The
  BREAK-RATE numbers (chance of a ≥4-day gap: Push 8%, Boxing 9%, Legs 11%, Untagged 17%, Pull
  25%, Full-body 32%) are a different, separately-accurate metric — Pull has fast *typical*
  returns but a fatter tail of long breaks; conflating the two metrics is what produced the wrong
  grouping. Still downgraded per §4a: a correlation about which activity he reaches for,
  confoundable by why — mention as a loose pattern at most, never as sole grounds for a directive.
- **His own analysis explicitly recommends Upper/Lower over PPL for him** (§4a) — not a
  generic-literature default. Rotation eligibility (recommend whichever tagged type/muscle group
  rested longest, ≥48h non-leg / ≥72h legs-lower) is program-agnostic in the actual code — it
  works the same for an Upper/Lower split as a PPL one, no fix needed there.
- **1 rest day between sessions is measurably peak performance**; back-to-back is flat, 3+ rest
  days trends worse (rust, weaker/suggestive result per §4a's source).
- Current state per his own data: gym frequency has fallen from ~11.5/mo to ~7/mo over the last 3
  months, legs volume near zero — the planner should be aware it's mid-decline, not steady-state.

## 5. Data model gap

**Correction after querying the real account (there is no "Gym" category — verified, not
assumed):** categories are Study/Office/Food/Activity/Break/Commute/Self-care/Call/Watching/
Sleep/Reading/Misc/Shopping. "Gym" is a *title* that lands under the `Activity` category, which
also holds Walking, Swimming, and commute-adjacent walks. So any workout query must filter on
`title = 'Gym'` within Activity, not on category alone — Activity is not a proxy for "workout."

`time_entries` has no field for *which* workout type a "Gym" entry was. Reuse the existing `tags`
array. **No new UI needed** — checked `enrich-capture` (async title-cleanup function that already
runs on every capture) and it *already* does exactly this: its prompt literally has the example
`"leg day workout" → title "Gym", tags ["legs"]`. Amarsh types naturally ("Leg day", "Push day",
"Hyrox"), enrich-capture normalizes the title to "Gym" and lifts the specific into a tag. The only
gap is canonicalization — nothing currently pins the tag vocabulary, so it drifts: checked, and one
of his 12 real logged Gym entries already has tag `"Push pull"` (capitalized, spaced) instead of
`"push"`. Fixed: added a canonical-vocabulary line to `enrich-capture`'s system prompt (done, see
`supabase/functions/enrich-capture/index.ts`) so it converges to the same tags evidence-snapshot
will query for.

**Also verified**: only 12 real Gym-titled entries exist in the app to date (several are
seconds-long test noise from development, e.g. a 15-second entry from mid-June) — live in-app
workout history is essentially empty right now, which is exactly why the Hevy backfill (§6c)
matters and why evidence-snapshot (§6a) needs a minimum-duration filter to ignore junk entries.

**Canonical vocabulary** (revised after checking actual Hevy title data, see §6c):
`push`, `pull`, `legs`, `upper`, `lower`, `full-body`, `boxing`, `run`, `hyrox`, `rest` — his real
program is Upper/Lower (per `CHECKLIST.md`), not pure PPL, so both splits need to be representable.

## 6. Proposed changes

### 6a. `buildEvidenceSnapshot` (plan-chat) — extend, don't rewrite
Add, computed live from `time_entries`/sleep logs each call (no caching, no cron):
- Rolling sleep debt (7-14 day deficit vs. his own rolling-average target, clamped 7-9h per NSF
  band) and last-night duration.
- Median recent wake time and derived recommended bedtime (wake − target duration).
- Days since last workout, days since each tagged type, and which type is "eligible" by the
  floating-cycle rule (≥48h / ≥72h for legs) — flag loudly if `daysSince(any) >= 3`.
- Nap eligibility: only surfaced as evidence if it's currently within a plausible nap window
  (roughly early-afternoon through a few hours before his derived bedtime) AND sleep debt is
  elevated — the LLM still decides whether to mention it, evidence just makes it possible.

The system prompt already tells the model to interpret this and never contradict it — so this is
where "empirical data drives the plan" actually lands. This is also where the prompt gets updated
to (a) permit/encourage asking a clarifying question when evidence is ambiguous (e.g., "are you
feeling sleepy now?" when nap-window evidence is borderline), and (b) be direct/blunt when
multiple signals stack (bad sleep + gym gap + user wants to "just work") rather than softening it.

### 6b. `detectConcerns` (brain) — new concern kinds
Add `sleep-debt`, `gym-gap`, `post-activity-nap` to the existing kind union, following the same
pattern as the current DRIFT/EVENING blocks (threshold check → push a concern object → existing
cooldown/budget/quiet-hours logic handles the rest, no new delivery mechanism needed):
- `gym-gap`: fires once `daysSince(gym) >= 3`, importance scaled by how far past 3.
- `sleep-debt`: fires when rolling debt crosses a threshold, timed for evening (suggest earlier
  bedtime) rather than mid-day.
- `post-activity-nap`: fires shortly after a commute/office-type entry is stopped, if nap-window
  + debt conditions from 6a are both true. This is the concrete mechanism for the "as soon as I
  get home" example — it rides the existing app-foreground/cron trigger, not a new real-time
  pipeline.

### 6c. Historical Hevy backfill (decided: yes)
Checked actual title values in the 4-year CSV (4,940 rows of session titles). Distribution:
`Push` 1521, `Pull` 1497, `Legs`/`Leg` 632, `FBD`/`FBD A`/`FBD B` 449 (full-body), `Lower
(Hypertrophy)` 198, `Upper`/`Upper - Strength`/`Upper - Hypertrophy` 167, `Boxing` 15 — these map
directly and cleanly to the canonical vocabulary above. But the largest chunk, ~4,344 sessions
(`Late night workout`, `Evening workout`, `Morning workout`, `Afternoon workout`), is time-of-day
only with no type signal in the title — those import as untagged Gym entries (still useful for
gap/frequency stats, just not rotation-type stats). Not worth inferring type from individual
exercises for a one-time backfill — diminishing returns. One-time Python/Deno script, run once,
not part of the shipped app.

## 7. Non-goals for this pass
- No ongoing Hevy/Amazfit sync (justified in §3).
- No new notification delivery system — reuses brain's existing budget/cooldown/quiet-hours logic.
- No new tagging UI (§5) — reuses `enrich-capture`, just tightens its prompt.
- No attempt to type-classify the ~4,344 generic-titled historical Hevy sessions (§6c).

## 8. Decisions (confirmed by Amarsh)
1. **Historical Hevy import**: yes, backfill (§6c).
2. **Tagging UX**: no new UI — free-typed titles + `enrich-capture` cleanup, canonicalized (§5).
3. **Phasing**: build 6a (evidence snapshot) first, ship/test, then 6b (brain nudges) as a
   separate follow-up pass.

## 9. Phase 1 task breakdown

1. [DONE] `enrich-capture`: canonical workout-type tag vocabulary added to the system prompt,
   deployed. Corrected mid-build: the prompt referenced a "Gym category" that doesn't exist in
   the real account (Gym is a title under Activity) — fixed to match reality.
2. [DONE] Backfill script `scripts/backfill-hevy.cjs`: imported 559 historical Hevy sessions
   (256 tagged by type, 303 untagged/generic titles) into the real account. Verified no date
   overlap with existing app-logged Gym entries first (no double-counting). Caught and fixed a
   side effect: the (still old-deployed) enrich-capture webhook auto-added a noise "gym" tag to
   279 rows before the corrected version was deployed — stripped after redeploying. Final state
   verified: 571 total Gym entries, clean tag distribution.
3. [DONE] `buildEvidenceSnapshot`: added rolling sleep debt + derived wake/bedtime (own rolling
   avg, clamped 7-9h NSF band), and days-since-last-workout-by-type + floating-cycle eligibility.
   Caught and fixed a bug during verification: the gym query had a 30-day floor, which returned
   "no sessions" instead of the real number when the actual gap (42 days, verified against his
   real account) exceeded it — switched to an unbounded, row-limited query so genuinely long gaps
   still surface their real length instead of going silent.
4. [DONE] `plan-chat` system prompt: added explicit permission to state evidence-grounded
   directives plainly when signals stack, ask one direct question on ambiguous evidence (e.g.
   nap window), and NOT treat a single bad night as gym-skipping grounds (matches his own data:
   sleep doesn't predict next-day lift performance for him).
5. [OPEN — needs Amarsh] Manual test pass in the Agent tab on the real account. Verified so far:
   the evidence computation is correct against real data (spot-checked outside the LLM), and the
   deployed function runs end-to-end without error (smoke-tested on the dedicated tester
   account). NOT yet verified: whether the model's actual phrasing/judgment in a real
   conversation matches the intent — that's a taste call only he can make on his own account.

Both edge functions (`enrich-capture`, `plan-chat`) are deployed and live.

## 10. Post-deploy fixes (Codex review + bias check, same day)
- Codex caught: `buildEvidenceSnapshot` early-returned on zero tracked entries in the last 7 days,
  silently dropping the already-fetched gym-gap data — exactly the "gone quiet" case the gym
  signal most needs to survive. Fixed: removed the early return, gym/sleep sections now compute
  independently of whether anything else was tracked. Redeployed, smoke-tested (200 OK, no
  crash) on the near-empty tester account.
- Codex caught: `backfill-hevy.cjs` deduped on `start_time` alone (any entry, not just Gym),
  which could wrongly skip a real session if something unrelated started at the same instant.
  Fixed (scoped dedupe to `title=Gym`) for safety on any future re-run — the already-completed
  backfill wasn't affected (0 collisions occurred in the actual run).
- Bias check (Amarsh's brother, see §4a): corrected spec framing that over-stated PPL as the
  right structure for Amarsh specifically, downgraded the workout-type→adherence claim from rule
  to loose pattern, added a live prompt rule requiring the agent to cite the specific number
  behind any directive and flag correlational (vs directly-measured) evidence as such.
