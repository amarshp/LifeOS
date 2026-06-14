# Life OS — High Level Requirements

> Personal operating system for tracking, planning, and optimizing every domain of life. Built natively for iOS with live status on home screen.

---

## Vision

A single app that mirrors real life in real time. Not just a planner, not just a tracker — a system where every domain (time, health, money, mind) feeds into a unified picture of how you are actually living versus how you planned to live.

Primary context: relocating to Dubai, starting a new job, high-accountability phase. The app must reduce friction, surface drift early, and save mental overhead.

---

## Core Philosophy

- **Plan vs Actual is the engine.** Every module compares what was planned against what happened.
- **Friction must be near zero.** If logging takes more than 5 seconds, it won't happen.
- **Live status is a first-class feature.** Not a nice-to-have. Always visible on home screen.
- **Modules are independent but connected.** Sleep data influences energy. Energy influences task performance. Everything talks to everything.
- **Build iteratively.** Core first, modules added only once core is in daily use.

---

## Platform

| Decision | Choice | Reason |
|---|---|---|
| Platform | Native iOS | Live Activities (home screen live status) require ActivityKit — not available on web/PWA |
| Build tool | Claude Code | Rapid agentic development, handles SwiftUI well |
| Storage | Local + optional cloud sync | Privacy first, iCloud backup as optional layer |
| Notifications | Native iOS push | Full background notification support |

---

## Live Status (Home Screen / Dynamic Island)

The killer feature. Always visible without opening the app.

**What it shows:**
- Currently running task/block name
- Elapsed time
- Module context (Work / Study / Gym / Break)
- Quick action to stop or switch

**Implementation:** iOS Live Activities via ActivityKit. Updates in real time via push-to-start or app-initiated activity.

---

## Architecture: Four Layers

### Layer 1 — Core Data (inputs everything else depends on)
- Sleep (bedtime, wake time, quality score)
- Energy level (1-5, logged manually a few times a day)
- Mood (1-5, optional)
- Weight (daily, manual)

### Layer 2 — Plan vs Actual Engine
- Calendar plan (imported from Google Calendar or entered natively)
- Time tracker (what is actually running right now)
- Drift report (how today compared to plan)

### Layer 3 — Domain Modules (plug into Layer 1 and 2)
- Health (gym, diet, steps)
- Mind (journal, study, todo)
- Money (expenses, budget, net worth)

### Layer 4 — Intelligence (later phase)
- Weekly review generation
- Pattern detection (e.g. low energy on days with poor sleep)
- Suggestions and nudges

---

## Modules

### 1. Time Tracker
The core of the app. Everything else supports this.

**Features:**
- Start / stop / switch task with one tap
- Task linked to a category (Deep Work, Study, Admin, Gym, Break, etc.)
- Timer visible on home screen via Live Activity
- Daily timeline view showing what actually happened hour by hour
- Plan vs actual overlay — planned blocks shown alongside actual

**Data captured per session:**
- Task name, category, start time, end time, duration, notes (optional)

---

### 2. Calendar / Planning
Plan layer that the time tracker runs against.

**Features:**
- Weekly template — repeating skeleton of ideal week
- One-off events layered on top
- Google Calendar import (read) for existing commitments
- Daily view with time blocks
- Drag to adjust blocks

**Integration:**
- Blocks from calendar are the "plan" side of plan vs actual
- Notifications fire at block start time

---

### 3. Todo
Task backlog. Separate from calendar — no time = no calendar entry.

**Features:**
- Projects / areas (Job Search, Learning, Life, Dubai Setup)
- Priority and due date
- Link task to a calendar block when ready to schedule
- Daily focus list — 3 tasks picked each morning
- Recurring tasks

**Integration:**
- Tasks can be started from here and fed into the time tracker
- Todoist import/sync considered (optional, later)

---

### 4. Health
**Sub-modules:**

**Sleep**
- Log bedtime and wake time
- Sleep quality score (1-5)
- Weekly sleep chart

**Gym**
- Workout log (exercise, sets, reps, weight)
- Streak tracker
- Session started from time tracker (auto-logs as Gym block)

**Diet**
- Meal log with rough calorie estimate
- Water intake
- Not calorie-obsessive — high-level awareness only

**Weight**
- Daily weigh-in
- Trend chart over weeks/months

---

### 5. Journal
**Features:**
- Daily entry (free text)
- Mood tag
- Prompted questions (optional): What went well? What drifted? What is the priority tomorrow?
- Searchable history
- Weekly reflection template

---

### 6. Finance
Critical for the Dubai transition.

**Features:**
- Expense logging (amount, category, note, date)
- Categories: Rent, Food, Transport, Subscriptions, Going Out, Career, Misc
- Monthly budget per category
- Budget vs actual per month
- Net worth tracker (savings snapshot, updated manually)
- Currency support (AED primary, INR secondary)
- No bank API dependency — manual logging, near-zero friction entry

**Entry flow:**
- Tap "+" → amount → category → done (3 taps max)
- Recent entries editable

---

## Notifications

| Trigger | Notification |
|---|---|
| Calendar block starting | "Deep Work block starts now" |
| Block ending soon | "10 min left in current block" |
| No active tracker for X mins during work hours | Gentle nudge |
| Daily plan not set by 9am | Morning planning reminder |
| Weight not logged by 10am | Quick log reminder |
| Weekly review not done by Sunday 8pm | Weekly review prompt |

---

## Plan vs Actual — Drift Reports

**Daily drift view:**
- Timeline showing planned vs actual side by side
- Total planned hours vs total tracked hours per category
- Unplanned time highlighted
- One-line summary: "You planned 3h Deep Work, did 1h 40m. Biggest drift: took 2h unplanned break."

**Weekly drift view:**
- Category breakdown across 7 days
- Trends vs previous week
- Sleep and energy correlation

---

## Data & Privacy

- All data stored locally on device (Core Data or SQLite)
- No accounts, no sign-up
- iCloud backup optional (encrypted)
- Export to CSV / JSON available
- No third-party analytics

---

## MVP Scope (Phase 1)

Build only this to start. Use it daily. Add everything else on top.

1. Time tracker with Live Activity on home screen
2. Calendar view with weekly template
3. Plan vs actual daily view
4. Basic notifications (block start, nudge when idle)

Everything else — Health, Finance, Journal, Todo — comes in Phase 2 and beyond, one module at a time.

---

## Phase Roadmap

| Phase | Scope |
|---|---|
| 1 — Core | Time tracker, calendar, plan vs actual, live status, basic notifications |
| 2 — Mind | Todo with projects, daily focus list, journal |
| 3 — Health | Sleep log, weight, gym log, diet (rough) |
| 4 — Money | Expense logging, budget vs actual, net worth |
| 5 — Intelligence | Weekly review generation, pattern detection, cross-module insights |

---

## Open Decisions (to resolve before or during Phase 1)

- [ ] Google Calendar — read-only sync or full bidirectional?
- [ ] Storage backend — Core Data vs SQLite vs SwiftData?
- [ ] iCloud sync — Phase 1 or later?
- [ ] Todoist sync — build native todo or sync with Todoist?
- [ ] Apple Watch support — Phase 1 or later?

---

*Document version: May 2026. Authored for Claude Code handoff.*


