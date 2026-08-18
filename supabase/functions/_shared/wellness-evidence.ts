// Deterministic sleep-debt/wake-bedtime and workout-rotation computation.
// Shared by plan-chat (feeds the planning-chat evidence snapshot) and brain
// (feeds proactive gym-gap/sleep-debt/nap concern detection) so the two
// surfaces can never silently disagree on the same numbers. These formulas
// went through two rounds of accuracy audits against raw source data — see
// PLANNING_MODE_SPEC.md §4c. Do not re-duplicate this logic in a third place.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface OfficeModeToday {
  mode: 'office' | 'wfh' | 'holiday' | null
  holidayName: string | null
}

/** Latest office_schedule_rules row on/before `dateStr` for that weekday, overridden by a holiday. */
export async function computeOfficeModeToday(
  supabase: SupabaseClient,
  userId: string,
  dateStr: string,
  weekday: number,
): Promise<OfficeModeToday> {
  const [{ data: holiday }, { data: rule }] = await Promise.all([
    supabase.from('holidays').select('name').eq('user_id', userId).eq('date', dateStr).maybeSingle(),
    supabase
      .from('office_schedule_rules')
      .select('mode')
      .eq('user_id', userId)
      .eq('weekday', weekday)
      .lte('effective_from', dateStr)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (holiday) return { mode: 'holiday', holidayName: holiday.name as string }
  return { mode: (rule?.mode as OfficeModeToday['mode']) ?? null, holidayName: null }
}

export const WORKOUT_TYPES = ['push', 'pull', 'legs', 'upper', 'lower', 'full-body', 'boxing'] as const
export type WorkoutType = (typeof WORKOUT_TYPES)[number]

// Generic PPL/exercise-physiology recovery windows — NOT personal-data-derived.
// LIFE Data neither confirms nor contradicts these (spec §4c item 7).
export const RECOVERY_DAYS: Record<string, number> = { legs: 3, lower: 3 }
export const DEFAULT_RECOVERY_DAYS = 2

function isoToLocal(iso: string, timeZone: string): string {
  const dt = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return fmt.format(dt).replace(',', '')
}

function medianMinutes(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function minutesToClock(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export interface SleepEvidence {
  nightsLogged: number
  avgH: number | null
  targetH: number | null
  debtH: number | null // positive = short of target, summed over the lookback window
  recWakeClock: string | null
  recBedClock: string | null
  wakeByDate: Array<{ date: string; wakeMin: number }> // per-night wake time, most recent last
}

/** `catName` maps a category_id to its display name (caller already has the list loaded). */
export async function computeSleepEvidence(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  catName: (id: string | null) => string | null,
  lookbackDays = 7,
): Promise<SleepEvidence> {
  const nowMs = Date.now()
  const sinceIso = new Date(nowMs - lookbackDays * 86_400_000).toISOString()
  const { data: entries } = await supabase
    .from('time_entries')
    .select('category_id, title, start_time, end_time')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('start_time', sinceIso)

  const sleepByNight = new Map<string, number>()
  const wakeByDate: Array<{ date: string; wakeMin: number }> = []
  for (const e of entries ?? []) {
    const startMs = new Date(e.start_time as string).getTime()
    const endMs = e.end_time ? new Date(e.end_time as string).getTime() : nowMs
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    const name = catName(e.category_id as string | null) ?? 'Other'
    const isSleep = name.toLowerCase().includes('sleep') || (e.title as string).toLowerCase().includes('sleep')
    if (!isSleep) continue
    const durMs = Math.min(endMs, nowMs) - startMs
    const endLocal = isoToLocal(new Date(Math.min(endMs, nowMs)).toISOString(), tz)
    const endLocalDate = endLocal.slice(0, 10)
    sleepByNight.set(endLocalDate, (sleepByNight.get(endLocalDate) ?? 0) + durMs)
    const [hh, mm] = endLocal.slice(11).split(':').map(Number)
    wakeByDate.push({ date: endLocalDate, wakeMin: hh * 60 + mm })
  }
  wakeByDate.sort((a, b) => a.date.localeCompare(b.date))

  const nights = [...sleepByNight.values()]
  if (!nights.length) {
    return { nightsLogged: 0, avgH: null, targetH: null, debtH: null, recWakeClock: null, recBedClock: null, wakeByDate: [] }
  }
  const avgH = nights.reduce((a, b) => a + b, 0) / nights.length / 3_600_000
  // Own rolling average, clamped to the NSF adult band — not a generic fixed number.
  const targetH = Math.min(9, Math.max(7, avgH))
  const debtH = nights.reduce((sum, ms) => sum + (targetH - ms / 3_600_000), 0)
  const medWake = medianMinutes(wakeByDate.map((w) => w.wakeMin))
  return {
    nightsLogged: nights.length,
    avgH,
    targetH,
    debtH,
    recWakeClock: minutesToClock(medWake),
    recBedClock: minutesToClock(medWake - targetH * 60),
    wakeByDate,
  }
}

// Historical duration grounding for propose_plan's block-time guesses
// (Amarsh: "look at historic data for lunch/walk/commute/ready time to give
// realistic guesses" instead of generic estimates). Title-substring matching,
// same convention as the sleep detection above.
export interface DurationStat {
  label: string
  medianMin: number
  sampleCount: number
}

const DURATION_KEYWORDS: Array<{ label: string; keywords: string[] }> = [
  { label: 'Lunch', keywords: ['lunch'] },
  { label: 'Commute', keywords: ['commute'] },
  { label: 'Getting ready', keywords: ['getting ready', 'ready for'] },
  { label: 'Walk', keywords: ['walk'] },
]

export async function computeDurationEvidence(
  supabase: SupabaseClient,
  userId: string,
  lookbackDays = 60,
): Promise<DurationStat[]> {
  const sinceIso = new Date(Date.now() - lookbackDays * 86_400_000).toISOString()
  const { data: entries } = await supabase
    .from('time_entries')
    .select('title, start_time, end_time')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .not('end_time', 'is', null)
    .gte('start_time', sinceIso)

  const byLabel = new Map<string, number[]>()
  for (const e of entries ?? []) {
    const title = ((e.title as string) ?? '').toLowerCase()
    const startMs = new Date(e.start_time as string).getTime()
    const endMs = new Date(e.end_time as string).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    const durMin = (endMs - startMs) / 60_000
    // Guard against multi-hour outliers (e.g. a forgotten-running entry
    // backfilled with a huge span) skewing the median for what's normally a
    // short routine.
    if (durMin > 180) continue
    for (const { label, keywords } of DURATION_KEYWORDS) {
      if (keywords.some((k) => title.includes(k))) {
        const arr = byLabel.get(label) ?? []
        arr.push(durMin)
        byLabel.set(label, arr)
      }
    }
  }

  // Same 3-sample floor as pulse-insights' attendance check — below that,
  // a "typical" duration is noise, not signal.
  const stats: DurationStat[] = []
  for (const { label } of DURATION_KEYWORDS) {
    const values = byLabel.get(label) ?? []
    if (values.length < 3) continue
    stats.push({ label, medianMin: medianMinutes(values), sampleCount: values.length })
  }
  return stats
}

export interface WorkoutTypeStat {
  type: string
  days: number
  eligible: boolean
}

export interface WorkoutEvidence {
  daysSinceAny: number | null
  byType: WorkoutTypeStat[]
  mostOverdueEligible: WorkoutTypeStat | null
}

/**
 * No time floor on the query: a gap can run past any fixed window (months —
 * confirmed on the real account, a 42+ day gap), and the exact gap length is
 * the important signal, not just "long ago." Ordered + limited instead.
 */
export async function computeWorkoutEvidence(supabase: SupabaseClient, userId: string): Promise<WorkoutEvidence> {
  const nowMs = Date.now()
  const { data: gymEntries } = await supabase
    .from('time_entries')
    .select('tags, start_time')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('title', 'Gym')
    .order('start_time', { ascending: false })
    .limit(60)
  if (!gymEntries || gymEntries.length === 0) {
    return { daysSinceAny: null, byType: [], mostOverdueEligible: null }
  }
  const lastAnyMs = Math.max(...gymEntries.map((g) => new Date(g.start_time as string).getTime()))
  const daysSinceAny = Math.floor((nowMs - lastAnyMs) / 86_400_000)

  const lastByType = new Map<string, number>()
  for (const g of gymEntries) {
    const startMs = new Date(g.start_time as string).getTime()
    for (const t of (g.tags as string[] | null) ?? []) {
      if (!WORKOUT_TYPES.includes(t as WorkoutType)) continue
      if (!lastByType.has(t) || startMs > lastByType.get(t)!) lastByType.set(t, startMs)
    }
  }
  const byType: WorkoutTypeStat[] = [...lastByType.entries()]
    .map(([type, ms]) => {
      const days = Math.floor((nowMs - ms) / 86_400_000)
      const threshold = RECOVERY_DAYS[type] ?? DEFAULT_RECOVERY_DAYS
      return { type, days, eligible: days >= threshold }
    })
    .sort((a, b) => b.days - a.days)
  const eligible = byType.filter((t) => t.eligible)
  return { daysSinceAny, byType, mostOverdueEligible: eligible[0] ?? null }
}

/** Typical post-lunch circadian dip, 13:00-16:00 local — see PLANNING_MODE_SPEC.md §6a. */
export function isNapWindow(tz: string): boolean {
  const local = isoToLocal(new Date().toISOString(), tz)
  const [hh, mm] = local.slice(11).split(':').map(Number)
  const nowLocalMins = hh * 60 + mm
  return nowLocalMins >= 13 * 60 && nowLocalMins <= 16 * 60
}
