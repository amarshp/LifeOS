# LifeOS — Design

Personal time tracking + planning app for iPhone. Plan vs. actual rendered on a single timeline. **Opacity follows time** — past is solid, future is faded, and the currently-running task crosses the now-line with no fixed end.

---

## 1. Core metaphor

> **Past = opaque. Future = translucent. Running = both.**

Every block on the timeline belongs to one of three states. The transition between the first two is the **now-line**, a thin white rule that travels down the rail as the day progresses.

| State | Look | Meaning |
|---|---|---|
| **Planned** | Category color at **18%** opacity, no border | It hasn't happened yet — just intent. |
| **Actual** | Solid category color, dark text | It really happened. |
| **Running** | Solid color above the now-line → **gradient fade** into translucent below. **No end time shown.** | In progress. Open-ended. |

Drift is visible spatially: a planned 9–11 block sitting next to a tracked 9:15–10:17 block tells you you started late and finished early without any extra UI.

---

## 2. Brand & tokens

### Surfaces (dark theme — primary)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#000000` | App background |
| `--surface-1` | `#0C0D10` | Cards |
| `--surface-2` | `#15161B` | Inputs, chips, sheets |
| `--surface-3` | `#1D1E24` | Selected states |
| `--border` | `#22232A` | Card edges |
| `--border-2` | `#2C2E36` | Stronger edges, popovers |
| `--border-3` | `#3A3C46` | Active/focus |

### Text

| Token | Hex | Use |
|---|---|---|
| `--text-1` | `#FFFFFF` | Headlines, primary |
| `--text-2` | `#A4A7B0` | Body, secondary |
| `--text-3` | `#6C6F78` | Meta, captions |
| `--text-4` | `#4A4C54` | Hour ticks, deep disabled |

### Categories

The six categories from the brief. Hex is the **actual / solid** color. Planned uses the same hex at 18% opacity.

| Category | Hex | Hue |
|---|---|---|
| Deep Work | `#6366F1` | indigo |
| Study | `#8B5CF6` | purple |
| Admin | `#F59E0B` | amber |
| Gym | `#10B981` | emerald |
| Break | `#94A3B8` | slate |
| Commute | `#64748B` | gray |

Categories are the **only** source of color on the app. UI chrome (FABs, buttons, tabs, borders) stays neutral white/gray. This lets category color carry meaning on its own.

Users can add custom categories. Each new category picks a base hue from the same palette.

### Typography

- **UI** — Inter (300 / 400 / 500 / 600 / 700)
- **Monospace numerals** — JetBrains Mono (for the hero timer, time pills, hour ticks, stats)
- Letter-spacing tightened on display sizes: `-0.025em` at 28px, `-0.04em` at 56px
- All numerals use `font-feature-settings: "tnum"` for stable widths

### Radii & spacing

- Cards: `16px`
- Inputs / pills: `10–12px`
- Blocks on the timeline: `8px`
- Mini-rail blocks: `3px`
- Phone shell: `36px` (iPhone-suggestive, but bare — no bezel)
- 8px / 12px / 16px spacing scale throughout

### Block geometry

- Day view rail height: **484px** for 7a–10p → 1 hour ≈ **32px**
- Mini timeline (dashboard): full rail width = 15 hours, blocks positioned with `left: x%` and `width: y%`
- Now-line: 1px white rule with a 6px white dot on the left, label "NOW · 1:30" floating right

---

## 3. Navigation

Four tabs at the bottom. Day View is the workhorse; Home is the landing.

| Tab | Icon | Screen |
|---|---|---|
| **Home** | House | Dashboard |
| **Day** | Single column w/ rule | Day View |
| **Week** | 7-col grid | Week View |
| **Settings** | Gear | Categories, tags, integrations |

Sub-flows (not tabs):
- Tapping a **day cell** in Week View → that day's Day View
- Tapping the **mini timeline** on Home → today's Day View
- Tapping any **block** → inline edit popover
- Tapping the **NEXT card's "Start now"** → starts the planned task as an actual timer

---

## 4. Screens

### 4.1 Home / Dashboard

Landing screen. Three cards plus quick-start chips.

1. **NOW card** (hero) — category-tinted background, big mono timer (`0:24:08`), task name + category, tags, started-at + planned-window meta. Stop button in the corner.
2. **NEXT card** — countdown ("Next · in 1h 30m"), task name, time range, "Start now" shortcut that pre-fills from the plan.
3. **TODAY card** — horizontal mini timeline 7a→10p with past-actual blocks (solid), running task (gradient), future-planned blocks (translucent), now indicator. Day stats below: **tracked**, **planned**, **+drift** (orange highlight).
4. **Quick start** — chips for recent entries (e.g. `Deep · API refactor`). Tap to start the timer with the same name + category in one tap.

Empty state: when nothing is tracking, the NOW card collapses to a dashed "Nothing tracking — tap ▶ to start" prompt.

### 4.2 Day View

Single vertical timeline strip, 7am–10pm by default, scrollable.

- Hour ticks on the left in mono
- Single rail filled with blocks of all three states
- **Now-line** at the current time, with the running block crossing through it
- **Runner banner** at the top showing the current task + elapsed (this duplicates the NOW state but lets the user stop the timer from any screen)
- **Two FABs** stacked at bottom-right:
  - `▶` (white primary) — start tracking immediately. Sheet slides up to fill details.
  - `+` (outlined secondary) — open the Add Plan sheet to schedule a future block.

#### Edit mode
Tap a block to select. A **popover** anchored to the block lets you change:
- Start / end (time pills with pencil)
- Category (6 swatches in a row)
- Tags (chip list + add)
- Actions: `Delete · Split ↕ · Save`

#### Drag mode
Hold a block and drag. The block lifts (`scale(1.02)`, slight rotation, glow ring), a dashed ghost remains where it was, and a small `+55m` delta indicator appears showing the time change. Snaps to 5-minute increments.

### 4.3 Week View

Compact 7-column grid. All days fit on the phone — no horizontal scroll.

- Day-of-week initial + date number at the top; today's date sits in a white circle
- Hour ticks every 3 hours on the left (7a · 10a · 1p · 4p · 7p · 10p)
- Today column gets a subtle background tint and outline
- Now-line crosses only today
- **Parallel activities** render as half-width sub-columns within the day (e.g. coding + listening to a podcast)
- Tap any day cell → that day's Day View

### 4.4 Add Entry sheet (▶)

Triggered by tapping ▶. **The timer starts on tap**, not on Save. The sheet lets you fill details while it runs.

- **Tracking banner** at the top: category-tinted, with a live `0:00:12` mono counter and "Started 1:30 pm"
- **Start time** is editable. A dashed pill `← use last stop · 1:24p +6m` backfills the start to the previous task's end (no gaps)
- **Name** input
- **Category** chips (6 + "+ New")
- **Tags** — scoped to the chosen category. Tag suggestions come from previous entries of that category. Typeahead dropdown with counts (`Vincent · 1 prev. call`). Inline `+ create "Vi"` for new tags.
- Actions: `Discard` · `Save · keep tracking` (sheet closes, timer continues)

### 4.5 Add Plan sheet (+)

Triggered by tapping +. **No timer.** Just schedules a future block.

- Name
- **Start + End** time pills (required, side-by-side)
- Category chips
- **Repeat** pills: `Once · Daily · Weekdays · M W F · Weekly · Custom…`
- Tags
- Actions: `Cancel` · `Save plan`

---

## 5. Components inventory

Custom primitives in `hifi-common.jsx`:

| Component | Purpose |
|---|---|
| `HiPhone` | Bare 360×780 phone screen, dark, 36px radius |
| `HiStatusBar` | iOS-style status bar with SVG signal/wifi/battery |
| `HiRunner` | Top sticky banner — running task + elapsed + stop |
| `HiDateHead` | Date header with arrow nav |
| `HiTabBar` | Bottom 4-tab bar with SVG icons |
| `HiFab` | Stacked FABs (primary `▶` / secondary `+`) |
| `HiBlock` | Timeline block. Modes: `planned` (translucent), `actual` (solid) |
| `HiRunningBlock` | Block that crosses the now-line with the gradient fade |
| `HiHourCol` | Vertical hour-tick column |
| `HiChip` | Category chip with swatch |
| `HiTag` | Tag chip with × dismiss |

Shared CSS classes: `.hi-card · .hi-btn · .hi-input · .hi-time-pill · .hi-popover · .hi-sheet · .hi-scrim · .hi-now-line · .hi-mini-rail · .hi-freq · .hi-dropdown · .hi-tabbar`

---

## 6. Interaction rules

- **Timer starts on FAB tap.** Sheet appears after, not before. Save closes the sheet but keeps the timer running.
- **Discard** stops the timer and throws away the entry.
- **Stop** (on running task) ends the timer and saves it as-is.
- **Tap a block** → edit popover. Works on planned, actual, or running blocks.
- **Hold + drag** → move a block ↕ on the timeline. Snaps to 5 min.
- **Tap a planned block's "Start now"** (shortcut in popover) → starts that plan as an actual timer immediately.
- **Long-press ▶** → starts a parallel timer alongside the current one (does not stop the current one).
- **Tap a day in Week View** → that day's Day View.
- The `+` FAB never stops the current timer (it just creates a future plan).

---

## 7. Open questions

1. **Parallel activities** — 2-up column split is clean; 3-up gets tight on a phone. Cap at 2 visible with a "+1 more" overflow?
2. **Custom categories** — when "+ New" is tapped, do we open a full editor (name, color, default tags) or just `name + color`? Default tags can be added later from Settings.
3. **Tag scoping** — strictly per-category (current spec) or can a tag be global across categories (e.g. project name like "Atlas")?
4. **Repeating plans** — when you drag a single instance of a recurring plan, do you move just that one, this and future, or all? Need a 3-way prompt.
5. **Drift threshold** — at what minute count does drift go from neutral gray to orange to red? Today: `+12m` is orange.
6. **Stats / history** — not designed yet. Probably a Settings sub-screen or a 5th tab. Out of scope for v1.
7. **Light mode** — not designed. Brief specified dark only; a light variant would invert surfaces and tweak block opacities (planned probably needs ~28%, not 18%, on white).

---

## 8. File map

```
LifeOS/
├── index.html           ← hi-fi canvas (this design)
├── hifi-styles.css      ← all tokens, classes
├── hifi-common.jsx      ← primitives
├── hifi-dashboard.jsx   ← Home
├── hifi-day.jsx         ← Day View + edit + drag
├── hifi-week.jsx        ← Week View
├── hifi-sheets.jsx      ← Add Entry, Add Plan
├── design-canvas.jsx    ← presentation shell (pan/zoom canvas)
└── wireframes.html      ← archived hand-drawn wireframes
```

---

*Designed in HTML. Drop into the Figma equivalent or hand off straight to engineering.*
