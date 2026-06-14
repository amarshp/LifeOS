import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mergeIntervals, unionMs, sumMs, intersectMs, subtractIntervals, gaps, clampIntervals,
  computePlanVsActual, type PlanBlock, type ActualEntry,
} from '../planVsActual.ts'

const H = 3_600_000
const iv = (s: number, e: number) => ({ start: s * H, end: e * H })

// ─── Interval primitives ──────────────────────────────────────────────────────

test('mergeIntervals merges overlapping and touching', () => {
  assert.deepEqual(mergeIntervals([iv(0, 2), iv(1, 3), iv(5, 6)]), [iv(0, 3), iv(5, 6)])
  assert.deepEqual(mergeIntervals([iv(2, 4), iv(0, 2)]), [iv(0, 4)]) // touching
})

test('unionMs ignores parallel overlap, sumMs counts it', () => {
  const parallel = [iv(0, 2), iv(1, 3)] // 1h overlap
  assert.equal(unionMs(parallel), 3 * H)
  assert.equal(sumMs(parallel), 4 * H)
})

test('intersectMs returns time present in both sets', () => {
  assert.equal(intersectMs([iv(0, 4)], [iv(2, 6)]), 2 * H)
  assert.equal(intersectMs([iv(0, 1)], [iv(3, 4)]), 0)
})

test('subtractIntervals removes b from a', () => {
  assert.deepEqual(subtractIntervals([iv(0, 4)], [iv(1, 2)]), [iv(0, 1), iv(2, 4)])
  assert.deepEqual(subtractIntervals([iv(0, 4)], [iv(0, 4)]), [])
})

test('gaps returns uncovered window', () => {
  assert.deepEqual(gaps([iv(1, 2), iv(3, 4)], 0, 5 * H), [iv(0, 1), iv(2, 3), iv(4, 5)])
})

test('clampIntervals clips to window', () => {
  assert.deepEqual(clampIntervals([iv(-1, 2), iv(4, 9)], 0, 5 * H), [iv(0, 2), iv(4, 5)])
})

// ─── Scenario (hand-verified) ───────────────────────────────────────────────
// Window 0–10h. Plans: Sleep 0-4, Study 4-6 (×2 parallel), Reading 6-8,
// Watching 8-12 (runs past window). Actuals: Study 0-3 & 5-7, Reading 6.5-7.5,
// Watching 6-6.5 (parallel with the reading/study block).

function scenario() {
  const blocks: PlanBlock[] = [
    { id: 'b1', categoryId: 'S', title: 'Sleep', tags: [], startMs: 0, endMs: 4 * H },
    { id: 'b2', categoryId: 'T', title: 'Study A', tags: [], startMs: 4 * H, endMs: 6 * H },
    { id: 'b3', categoryId: 'T', title: 'Study B', tags: [], startMs: 4 * H, endMs: 6 * H },
    { id: 'b4', categoryId: 'R', title: 'Reading', tags: [], startMs: 6 * H, endMs: 8 * H },
    { id: 'b5', categoryId: 'W', title: 'Watching', tags: [], startMs: 8 * H, endMs: 12 * H },
  ]
  const entries: ActualEntry[] = [
    { id: 'e1', categoryId: 'T', tags: [], startMs: 0, endMs: 3 * H, isRunning: false },
    { id: 'e2', categoryId: 'T', tags: [], startMs: 5 * H, endMs: 7 * H, isRunning: false },
    { id: 'e3', categoryId: 'R', tags: [], startMs: 6.5 * H, endMs: 7.5 * H, isRunning: false },
    { id: 'e4', categoryId: 'W', tags: [], startMs: 6 * H, endMs: 6.5 * H, isRunning: false },
  ]
  return computePlanVsActual({ blocks, entries, categoryIds: ['S', 'T', 'R', 'W'], winStart: 0, winEnd: 10 * H })
}

test('scenario: wall-clock totals use union not sum', () => {
  const r = scenario()
  assert.equal(r.trackedMs, 5.5 * H)   // 0-3 + 5-7.5
  assert.equal(r.untrackedMs, 4.5 * H) // 10 − 5.5
  assert.equal(r.overlapMs, 1 * H)     // sum 6.5 − union 5.5
  assert.equal(r.plannedElapsedMs, 10 * H)
})

test('scenario: adherence and unplanned wall-clock', () => {
  const r = scenario()
  assert.equal(r.matchedMs, 2 * H)        // Study 5-6 + Reading 6.5-7.5
  assert.equal(r.plannedByCatMs, 10 * H)  // 4+2+2+2
  assert.equal(r.adherencePct, 0.2)
  assert.equal(r.unplannedWallMs, 4 * H)  // Study 0-3 + Study 6-7 (W 6-6.5 inside that union)
})

test('scenario: per-category breakdown', () => {
  const r = scenario()
  const byId = Object.fromEntries(r.byCategory.map(c => [c.categoryId, c]))
  assert.equal(byId.S.plannedMs, 4 * H); assert.equal(byId.S.actualMs, 0); assert.equal(byId.S.shortfallMs, 4 * H)
  assert.equal(byId.T.plannedMs, 2 * H); assert.equal(byId.T.matchedMs, 1 * H); assert.equal(byId.T.unplannedMs, 4 * H)
  assert.equal(byId.R.matchedMs, 1 * H)
  assert.equal(byId.W.plannedMs, 2 * H); assert.equal(byId.W.matchedMs, 0)
})

test('scenario: block outcomes and start drift', () => {
  const r = scenario()
  const byId = Object.fromEntries(r.blocks.map(b => [b.block.id, b]))
  assert.equal(byId.b1.status, 'missed')      // Sleep, no actual
  assert.equal(byId.b2.status, 'partial')      // Study, coverage 0.5
  assert.equal(byId.b2.coverage, 0.5)
  assert.equal(byId.b4.status, 'partial')      // Reading
  assert.equal(byId.b5.status, 'missed')       // Watching window has no same-cat actual
  assert.equal(byId.b2.startDriftMin, 60)      // nearest Study actual starts +1h
  assert.equal(r.firstStartDriftMin, 60)
  assert.equal(r.upcomingCount, 0)
})

test('no-plan day: everything tracked is unplanned, adherence null', () => {
  const entries: ActualEntry[] = [
    { id: 'e1', categoryId: 'T', tags: [], startMs: 0, endMs: 2 * H, isRunning: false },
  ]
  const r = computePlanVsActual({ blocks: [], entries, categoryIds: ['T'], winStart: 0, winEnd: 4 * H })
  assert.equal(r.adherencePct, null)
  assert.equal(r.hasPlan, false)
  assert.equal(r.unplannedWallMs, 2 * H)
  assert.equal(r.untrackedMs, 2 * H)
})

test('untracked is measured from trackingStart, not the raw window', () => {
  const entries: ActualEntry[] = [
    { id: 'e1', categoryId: 'T', tags: [], startMs: 7 * H, endMs: 9 * H, isRunning: false },
  ]
  // Without clamp: elapsed 10h, untracked 8h. With trackingStart 6h: elapsed 4h, untracked 2h.
  const clamped = computePlanVsActual({ blocks: [], entries, categoryIds: ['T'], winStart: 0, winEnd: 10 * H, trackingStartMs: 6 * H })
  assert.equal(clamped.elapsedMs, 4 * H)
  assert.equal(clamped.untrackedMs, 2 * H)
  const raw = computePlanVsActual({ blocks: [], entries, categoryIds: ['T'], winStart: 0, winEnd: 10 * H })
  assert.equal(raw.untrackedMs, 8 * H)
})

test('future-only plan: blocks are upcoming, none missed yet', () => {
  const blocks: PlanBlock[] = [
    { id: 'b1', categoryId: 'S', title: 'Sleep', tags: [], startMs: 5 * H, endMs: 8 * H },
  ]
  const r = computePlanVsActual({ blocks, entries: [], categoryIds: ['S'], winStart: 0, winEnd: 4 * H })
  assert.equal(r.upcomingCount, 1)
  assert.equal(r.blocks.length, 0) // nothing elapsed → not judged
})
