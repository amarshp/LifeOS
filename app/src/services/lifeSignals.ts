// Phase 4 (PLANNING_MODE_SPEC.md §13): data for the calm "Pulse" page.
// Client-side reads only — same RLS-scoped pattern as insights.ts/categories.ts,
// no new edge function needed. Deliberately separate from wellness-evidence.ts
// (that's Deno-only edge-function code, a different runtime/module system —
// this only duplicates the small slice actually needed for trends/correlation).
import { supabase } from '../lib/supabase'

export interface WeekBucket {
  weekStart: string // yyyy-mm-dd, Monday
  count: number
}

function mondayOf(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7 // 0 = Monday
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - day)
  return monday.toISOString().slice(0, 10)
}

/** Gym sessions per week, oldest first — the trend card's data. Includes
 * zero-count weeks (a gap must render as a gap, not silently vanish from the
 * series and read as continuous with whatever week comes next — Codex catch). */
export async function getGymFrequencyTrend(days: number): Promise<WeekBucket[]> {
  const now = new Date()
  const since = new Date(now.getTime() - days * 86_400_000)
  const { data, error } = await supabase
    .from('time_entries')
    .select('start_time')
    .eq('title', 'Gym')
    .is('deleted_at', null)
    .gte('start_time', since.toISOString())
    .order('start_time', { ascending: true })
  if (error) throw error

  const buckets = new Map<string, number>()
  for (const row of data ?? []) {
    const key = mondayOf(new Date(row.start_time as string))
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  // Walk every week from the oldest bucket to the current one, filling zeros.
  const out: WeekBucket[] = []
  const cursor = new Date(mondayOf(since) + 'T00:00:00Z')
  const last = new Date(mondayOf(now) + 'T00:00:00Z')
  while (cursor.getTime() <= last.getTime()) {
    const key = cursor.toISOString().slice(0, 10)
    out.push({ weekStart: key, count: buckets.get(key) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 7)
  }
  return out
}

// Matches brain/index.ts's category-name heuristic ("sleep" substring) so
// client and server agree on what counts as a sleep entry.
async function getSleepCategoryIds(): Promise<string[]> {
  const { data, error } = await supabase.from('categories').select('id, name').is('deleted_at', null)
  if (error) throw error
  return (data ?? []).filter((c) => (c.name as string).toLowerCase().includes('sleep')).map((c) => c.id as string)
}

/** Days since the last Sleep entry ended — null if none logged at all. */
export async function getDaysSinceLastSleep(): Promise<number | null> {
  const sleepCatIds = await getSleepCategoryIds()
  if (!sleepCatIds.length) return null
  const { data, error } = await supabase
    .from('time_entries')
    .select('end_time')
    .in('category_id', sleepCatIds)
    .is('deleted_at', null)
    .not('end_time', 'is', null)
    .order('end_time', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = data?.[0]
  if (!row?.end_time) return null
  return Math.floor((Date.now() - new Date(row.end_time as string).getTime()) / 86_400_000)
}

export interface NudgeOutcome {
  id: string
  kind: string
  title: string
  resolution: string
  updated_at: string
}

/** Resolved concerns that were actually pushed at least once — the "did it
 * work" card's data. A concern that cleared without ever notifying isn't a
 * nudge outcome worth surfacing here (nothing to have "worked"). */
export async function getRecentNudgeOutcomes(days: number): Promise<NudgeOutcome[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('concerns')
    .select('id, kind, title, resolution, updated_at, notified_count')
    .eq('status', 'resolved')
    .gt('notified_count', 0)
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(5)
  if (error) throw error
  return (data ?? [])
    .filter((r) => r.resolution)
    .map((r) => ({ id: r.id as string, kind: r.kind as string, title: r.title as string, resolution: r.resolution as string, updated_at: r.updated_at as string }))
}

// ─── Confidence-gated correlation (§13a.3) ────────────────────────────────────
// Exist.io's pattern: gate on sample size, phrase non-causally, lag by one day
// (WHOOP's finding — same-day pairing is the wrong comparison). Applied to one
// pair for now (nightly sleep hours vs. next-day gym), extensible later.

const MIN_PAIRED_DAYS = 14
// |r| below this is indistinguishable from noise at these sample sizes —
// render nothing rather than dress up a near-zero correlation as a pattern.
const MIN_ABS_R = 0.3

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom === 0 ? null : num / denom
}

export interface CorrelationResult {
  n: number
  r: number
  confidenceStars: 1 | 2 | 3 | 4 | 5
  label: string
}

/** Nightly sleep hours (day N) vs. whether a Gym session happened on day N+1.
 * Returns null if fewer than MIN_PAIRED_DAYS paired days exist — the page
 * renders nothing in that case, never a placeholder. */
export async function getSleepGymCorrelation(lookbackDays = 90): Promise<CorrelationResult | null> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString()
  const sleepCatIds = await getSleepCategoryIds()
  if (!sleepCatIds.length) return null
  const [{ data: sleepRows, error: e1 }, { data: gymRows, error: e2 }] = await Promise.all([
    supabase.from('time_entries')
      .select('start_time, end_time')
      .in('category_id', sleepCatIds).is('deleted_at', null).not('end_time', 'is', null).gte('start_time', since),
    supabase.from('time_entries')
      .select('start_time').eq('title', 'Gym').is('deleted_at', null).gte('start_time', since),
  ])
  if (e1) throw e1
  if (e2) throw e2

  const sleepByNight = new Map<string, number>() // end-local-date -> hours
  for (const r of sleepRows ?? []) {
    const startMs = new Date(r.start_time as string).getTime()
    const endMs = new Date(r.end_time as string).getTime()
    if (!(endMs > startMs)) continue
    const dateKey = new Date(endMs).toISOString().slice(0, 10)
    sleepByNight.set(dateKey, (sleepByNight.get(dateKey) ?? 0) + (endMs - startMs) / 3_600_000)
  }
  const gymDays = new Set((gymRows ?? []).map((r) => new Date(r.start_time as string).toISOString().slice(0, 10)))

  const xs: number[] = [], ys: number[] = []
  for (const [dateKey, hours] of sleepByNight) {
    const nextDay = new Date(new Date(dateKey + 'T00:00:00Z').getTime() + 86_400_000).toISOString().slice(0, 10)
    xs.push(hours)
    ys.push(gymDays.has(nextDay) ? 1 : 0)
  }
  if (xs.length < MIN_PAIRED_DAYS) return null
  const r = pearson(xs, ys)
  if (r === null || Math.abs(r) < MIN_ABS_R) return null
  const stars = xs.length >= 60 ? 5 : xs.length >= 45 ? 4 : xs.length >= 30 ? 3 : xs.length >= 21 ? 2 : 1
  return {
    n: xs.length,
    r,
    confidenceStars: stars as CorrelationResult['confidenceStars'],
    label: `Sleep and next-day gym attendance tend to ${r > 0 ? 'go together' : 'move apart'}`,
  }
}
