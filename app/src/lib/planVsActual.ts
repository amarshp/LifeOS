import type { CalendarBlock } from '../types/database'
import type { InsightEntry } from '../services/insights'

/**
 * Plan-vs-actual engine.
 *
 * Pure, timezone-independent (all math in epoch ms). The Insights page is the
 * only consumer. Design notes live in INSIGHTS_REDESIGN_STATE.md.
 *
 * Two data sides:
 *   PLAN   = calendar_blocks (start/end timestamptz, category, tags)
 *   ACTUAL = time_entries    (start/end, category, tags; running → end = now)
 *
 * There is NO foreign-key link between them (calendar_block_id is never set), so
 * a plan and an actual are treated as "the same intent" when they share a
 * category and overlap in time. That heuristic is surfaced to the user as a
 * data-quality caveat — it is never hidden.
 *
 * Parallel/overlapping entries exist on BOTH sides, so every wall-clock total
 * uses an interval UNION (sweep-merge), never a naive sum of durations.
 */

const MIN_MS = 60_000

// ─── Interval primitives ──────────────────────────────────────────────────────

export interface Interval { start: number; end: number }

/** Clip intervals to [winStart, winEnd], dropping anything empty or outside. */
export function clampIntervals(ivs: Interval[], winStart: number, winEnd: number): Interval[] {
  const out: Interval[] = []
  for (const iv of ivs) {
    const s = Math.max(iv.start, winStart)
    const e = Math.min(iv.end, winEnd)
    if (e > s) out.push({ start: s, end: e })
  }
  return out
}

/** Sort + merge overlapping/touching intervals. */
export function mergeIntervals(ivs: Interval[]): Interval[] {
  if (ivs.length === 0) return []
  const sorted = [...ivs].sort((a, b) => a.start - b.start)
  const out: Interval[] = [{ ...sorted[0] }]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end)
    else out.push({ ...cur })
  }
  return out
}

/** Total wall-clock time covered by the union of intervals (no double counting). */
export function unionMs(ivs: Interval[]): number {
  return mergeIntervals(ivs).reduce((a, iv) => a + (iv.end - iv.start), 0)
}

/** Naive sum of durations (≥ unionMs; the gap is parallel-overlap time). */
export function sumMs(ivs: Interval[]): number {
  return ivs.reduce((a, iv) => a + Math.max(0, iv.end - iv.start), 0)
}

/** Intervals present in `a` AND `b` (each side merged first). */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a), B = mergeIntervals(b)
  const out: Interval[] = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i].start, B[j].start)
    const e = Math.min(A[i].end, B[j].end)
    if (e > s) out.push({ start: s, end: e })
    if (A[i].end < B[j].end) i++; else j++
  }
  return out
}

/** Wall-clock time in both sets. */
export function intersectMs(a: Interval[], b: Interval[]): number {
  return unionMs(intersectIntervals(a, b))
}

/** Intervals in `a` with `b` removed. */
export function subtractIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a), B = mergeIntervals(b)
  const out: Interval[] = []
  for (const cur of A) {
    let segStart = cur.start
    for (const hole of B) {
      if (hole.end <= segStart || hole.start >= cur.end) continue
      if (hole.start > segStart) out.push({ start: segStart, end: Math.min(hole.start, cur.end) })
      segStart = Math.max(segStart, hole.end)
      if (segStart >= cur.end) break
    }
    if (segStart < cur.end) out.push({ start: segStart, end: cur.end })
  }
  return out.filter(iv => iv.end > iv.start)
}

/** Uncovered parts of [winStart, winEnd] given covered intervals. */
export function gaps(ivs: Interval[], winStart: number, winEnd: number): Interval[] {
  return subtractIntervals([{ start: winStart, end: winEnd }], ivs)
}

// ─── Domain types ──────────────────────────────────────────────────────────────

export interface PlanBlock { id: string; categoryId: string; title: string; tags: string[]; startMs: number; endMs: number }
export interface ActualEntry { id: string; categoryId: string; tags: string[]; startMs: number; endMs: number; isRunning: boolean }

export function toPlanBlocks(blocks: CalendarBlock[]): PlanBlock[] {
  return blocks.map(b => ({
    id: b.id, categoryId: b.category_id, title: b.title, tags: b.tags ?? [],
    startMs: new Date(b.start_time).getTime(), endMs: new Date(b.end_time).getTime(),
  })).filter(b => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
}

export function toActualEntries(entries: InsightEntry[], nowMs: number): ActualEntry[] {
  return entries.map(e => {
    const startMs = new Date(e.start_time).getTime()
    const endMs = e.end_time ? new Date(e.end_time).getTime() : nowMs
    return { id: e.id, categoryId: e.category_id, tags: e.tags ?? [], startMs, endMs, isRunning: e.is_running }
  }).filter(e => Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.endMs > e.startMs)
}

// ─── Result shape ────────────────────────────────────────────────────────────

export type BlockStatus = 'fulfilled' | 'partial' | 'missed'

export interface BlockOutcome {
  block: PlanBlock
  plannedMs: number      // block duration clamped to elapsed window
  actualMs: number       // same-category actual overlapping the block
  coverage: number       // actualMs / plannedMs (0..1+)
  startDriftMin: number | null // nearest same-cat actual start − planned start (min); null if none
  status: BlockStatus
}

export interface CategoryPva {
  categoryId: string
  plannedMs: number   // union of plan intervals within elapsed window
  actualMs: number    // union of actual intervals within window
  matchedMs: number   // time both planned AND tracked as this category
  shortfallMs: number // plannedMs − matchedMs (planned, not honoured)
  unplannedMs: number // actualMs − matchedMs (tracked, not planned)
}

export interface Diagnosis {
  id: string
  severity: 'deficit' | 'drift' | 'info' | 'good'
  title: string
  detail: string
}

export interface PlanVsActual {
  winStart: number
  winEnd: number
  elapsedMs: number
  // wall-clock (union) totals
  trackedMs: number       // union of all actual in window
  untrackedMs: number     // elapsed − tracked
  overlapMs: number       // summed actual − tracked (parallel time)
  // plan side
  plannedElapsedMs: number // union of plan intervals up to now (across categories)
  hasPlan: boolean
  hasActual: boolean
  // adherence
  matchedMs: number        // Σ per-category matched
  plannedByCatMs: number   // Σ per-category planned (denominator for adherence)
  adherencePct: number | null // matchedMs / plannedByCatMs (null if no plan)
  unplannedWallMs: number  // wall-clock time doing something with no same-cat plan
  // breakdowns
  byCategory: CategoryPva[]
  blocks: BlockOutcome[]   // elapsed/in-progress plan blocks, sorted by start
  upcomingCount: number
  firstStartDriftMin: number | null
  diagnoses: Diagnosis[]
}

// ─── Core compute ──────────────────────────────────────────────────────────────

interface ComputeArgs {
  blocks: PlanBlock[]
  entries: ActualEntry[]
  categoryIds: string[]
  winStart: number
  winEnd: number  // = min(periodEnd, now)
  /**
   * First-ever tracked instant (ms). Untracked time is only counted from here
   * forward — time before the user ever tracked anything isn't "untracked", they
   * just weren't using the app yet. Keeps Month/Week untracked sane for new users.
   * Defaults to winStart (no clamp).
   */
  trackingStartMs?: number
  /** id → display name, for fully-formed diagnosis strings. Defaults to the id. */
  nameOf?: (catId: string) => string
}

const FULFILLED = 0.8
const PARTIAL = 0.25
const DRIFT_MATCH_WINDOW = 90 * MIN_MS

export function computePlanVsActual(args: ComputeArgs): PlanVsActual {
  const { winStart, winEnd } = args

  const actualAll = args.entries.map(e => ({ start: e.startMs, end: e.endMs }))
  const actualWin = clampIntervals(actualAll, winStart, winEnd)
  const trackedMs = unionMs(actualWin)

  // Untracked is measured from when the user first started tracking (clamped into
  // the window), so a 2-day-old account doesn't show a near-empty month as ~96%
  // "untracked". Adherence/plan math is unaffected.
  const untrackedWinStart = Math.min(winEnd, Math.max(winStart, args.trackingStartMs ?? winStart))
  const elapsedMs = Math.max(0, winEnd - untrackedWinStart)
  const untrackedMs = Math.max(0, elapsedMs - unionMs(clampIntervals(actualAll, untrackedWinStart, winEnd)))
  const overlapMs = Math.max(0, sumMs(actualWin) - trackedMs)

  // Plan intervals up to now (future portions clipped off).
  const planWin = clampIntervals(args.blocks.map(b => ({ start: b.startMs, end: b.endMs })), winStart, winEnd)
  const plannedElapsedMs = unionMs(planWin)

  const hasPlan = args.blocks.some(b => b.startMs < winEnd && b.endMs > winStart)
  const hasActual = actualWin.length > 0

  // Per-category breakdown.
  const cats = new Set<string>([...args.categoryIds, ...args.blocks.map(b => b.categoryId), ...args.entries.map(e => e.categoryId)])
  const byCategory: CategoryPva[] = []
  let matchedMs = 0, plannedByCatMs = 0
  const unplannedPieces: Interval[] = []

  for (const catId of cats) {
    const planCat = clampIntervals(
      args.blocks.filter(b => b.categoryId === catId).map(b => ({ start: b.startMs, end: b.endMs })),
      winStart, winEnd,
    )
    const actCat = clampIntervals(
      args.entries.filter(e => e.categoryId === catId).map(e => ({ start: e.startMs, end: e.endMs })),
      winStart, winEnd,
    )
    const plannedMs = unionMs(planCat)
    const actualMs = unionMs(actCat)
    if (plannedMs === 0 && actualMs === 0) continue
    const matched = intersectMs(planCat, actCat)
    const unplanned = unionMs(subtractIntervals(actCat, planCat))
    byCategory.push({
      categoryId: catId, plannedMs, actualMs, matchedMs: matched,
      shortfallMs: Math.max(0, plannedMs - matched), unplannedMs: Math.max(0, unplanned),
    })
    matchedMs += matched
    plannedByCatMs += plannedMs
    unplannedPieces.push(...subtractIntervals(actCat, planCat))
  }
  byCategory.sort((a, b) => (b.plannedMs + b.actualMs) - (a.plannedMs + a.actualMs))

  const unplannedWallMs = unionMs(unplannedPieces)
  const adherencePct = plannedByCatMs > 0 ? matchedMs / plannedByCatMs : null

  // Per-block outcomes (only blocks that have started).
  const blocks: BlockOutcome[] = []
  let upcomingCount = 0
  for (const block of [...args.blocks].sort((a, b) => a.startMs - b.startMs)) {
    if (block.startMs >= winEnd) { upcomingCount++; continue }
    const clampedStart = Math.max(block.startMs, winStart)
    const clampedEnd = Math.min(block.endMs, winEnd)
    const plannedMs = clampedEnd - clampedStart
    if (plannedMs <= 0) continue
    const sameCatActual = args.entries
      .filter(e => e.categoryId === block.categoryId)
      .map(e => ({ start: e.startMs, end: e.endMs }))
    const actualMs = intersectMs([{ start: clampedStart, end: clampedEnd }], sameCatActual)
    const coverage = plannedMs > 0 ? actualMs / plannedMs : 0
    // Nearest same-category actual start within ±window of the planned start.
    let startDriftMin: number | null = null
    let bestAbs = Infinity
    for (const e of args.entries.filter(e => e.categoryId === block.categoryId)) {
      const diff = e.startMs - block.startMs
      if (Math.abs(diff) <= DRIFT_MATCH_WINDOW && Math.abs(diff) < bestAbs) {
        bestAbs = Math.abs(diff); startDriftMin = Math.round(diff / MIN_MS)
      }
    }
    const status: BlockStatus = coverage >= FULFILLED ? 'fulfilled'
      : coverage >= PARTIAL ? 'partial'
      : 'missed'
    blocks.push({ block, plannedMs, actualMs, coverage, startDriftMin, status })
  }

  const firstStarted = blocks.find(b => b.startDriftMin !== null)
  const firstStartDriftMin = firstStarted ? firstStarted.startDriftMin : null

  const nameOf = args.nameOf ?? ((id: string) => id)
  const diagnoses = buildDiagnoses({
    elapsedMs, trackedMs, untrackedMs, overlapMs, plannedElapsedMs, matchedMs,
    plannedByCatMs, adherencePct, unplannedWallMs, byCategory, blocks, firstStartDriftMin, hasPlan, nameOf,
  })

  return {
    winStart, winEnd, elapsedMs, trackedMs, untrackedMs, overlapMs,
    plannedElapsedMs, hasPlan, hasActual, matchedMs, plannedByCatMs, adherencePct,
    unplannedWallMs, byCategory, blocks, upcomingCount, firstStartDriftMin, diagnoses,
  }
}

// ─── Diagnosis cards ────────────────────────────────────────────────────────

interface DiagInput {
  elapsedMs: number; trackedMs: number; untrackedMs: number; overlapMs: number
  plannedElapsedMs: number; matchedMs: number; plannedByCatMs: number
  adherencePct: number | null; unplannedWallMs: number
  byCategory: CategoryPva[]; blocks: BlockOutcome[]; firstStartDriftMin: number | null
  hasPlan: boolean; nameOf: (catId: string) => string
}

function fmtShort(ms: number): string {
  const h = Math.floor(ms / 3_600_000), m = Math.round((ms % 3_600_000) / 60_000)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/**
 * Plain-language statements derived strictly from the numbers above — no claim
 * is emitted unless the data supports it. The page renders the top few by
 * severity. Each card carries the figures it is based on.
 */
export function buildDiagnoses(d: DiagInput): Diagnosis[] {
  const out: Diagnosis[] = []
  const HOUR = 3_600_000

  // No plan at all for the period (but activity tracked) — actionable nudge,
  // not a "you deviated" finding.
  if (!d.hasPlan && d.trackedMs >= 30 * MIN_MS) {
    out.push({
      id: 'noplan', severity: 'info',
      title: 'No plan for this period',
      detail: `You tracked ${fmtShort(d.trackedMs)} but planned nothing. Plan even a few blocks to make adherence measurable.`,
    })
  }

  // Biggest shortfalls (planned but not honoured) — the headline deficits. Up to 3.
  const shortfalls = d.byCategory.filter(c => c.plannedMs >= 20 * MIN_MS && c.shortfallMs >= 20 * MIN_MS)
    .sort((a, b) => b.shortfallMs - a.shortfallMs)
  for (const c of shortfalls.slice(0, 3)) {
    const name = d.nameOf(c.categoryId)
    out.push({
      id: 'shortfall_' + c.categoryId, severity: 'deficit',
      title: `${name} deficit`,
      detail: `Planned ${fmtShort(c.plannedMs)} of ${name} so far, tracked ${fmtShort(c.matchedMs)}. ${Math.round((1 - c.matchedMs / c.plannedMs) * 100)}% of the plan went unmet.`,
    })
  }

  // Unplanned actual — only meaningful when there WAS a plan to deviate from.
  if (d.hasPlan && d.plannedElapsedMs >= 30 * MIN_MS && d.trackedMs > 0
      && d.unplannedWallMs / d.trackedMs >= 0.35 && d.unplannedWallMs >= 30 * MIN_MS) {
    out.push({
      id: 'unplanned', severity: 'drift',
      title: 'Mostly off-plan',
      detail: `${Math.round(d.unplannedWallMs / d.trackedMs * 100)}% of what you tracked (${fmtShort(d.unplannedWallMs)}) had no matching plan.`,
    })
  }

  // Start drift.
  if (d.firstStartDriftMin !== null && Math.abs(d.firstStartDriftMin) >= 15) {
    const late = d.firstStartDriftMin > 0
    out.push({
      id: 'startdrift', severity: 'drift',
      title: late ? 'Starting late' : 'Starting early',
      detail: `Your first matched plan block was started ${Math.abs(d.firstStartDriftMin)} min ${late ? 'late' : 'early'}.`,
    })
  }

  // Untracked.
  if (d.elapsedMs > 2 * HOUR && d.untrackedMs / d.elapsedMs >= 0.25 && d.untrackedMs >= HOUR) {
    out.push({
      id: 'untracked', severity: 'info',
      title: 'Untracked time',
      detail: `${fmtShort(d.untrackedMs)} (${Math.round(d.untrackedMs / d.elapsedMs * 100)}%) of the period has no tracked entry.`,
    })
  }

  // Overlap distortion.
  if (d.overlapMs >= 30 * MIN_MS) {
    out.push({
      id: 'overlap', severity: 'info',
      title: 'Parallel tracking',
      detail: `${fmtShort(d.overlapMs)} was tracked under two timers at once — totals here merge it so wall-clock isn't inflated.`,
    })
  }

  // A genuine win, if earned.
  if (d.adherencePct !== null && d.adherencePct >= 0.8 && d.plannedByCatMs >= HOUR) {
    out.push({
      id: 'good', severity: 'good',
      title: 'On plan',
      detail: `You honoured ${Math.round(d.adherencePct * 100)}% of the time you planned so far. Keep it up.`,
    })
  }

  return out
}
