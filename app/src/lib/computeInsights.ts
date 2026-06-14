import { toLocalDateStr } from './date'
import type { Category, CalendarBlock } from '../types/database'
import type { InsightEntry } from '../services/insights'

export type Period = 'day' | 'week' | 'month'

export interface CategoryStats {
  allTimeMs: number
  periodMs: number
  activeDays: number
  lastTracked: string | null // YYYY-MM-DD
}

export interface TagTime {
  tag: string
  ms: number
}

export interface InsightsComputed {
  period: Period
  periodLabel: string
  // Period-aware overview
  byCategory: Record<string, number>
  prevByCategory: Record<string, number>
  periodTotalMs: number
  prevTotalMs: number
  essentialMs: number
  discretionaryMs: number
  tagsByCategory: Record<string, TagTime[]>
  deepWorkCount: number
  switchRate: number
  // All-time / consistency (not period-bound)
  allTimeMs: number
  allTimeDays: number
  totalEntries: number
  trackingSince: Date | null
  currentStreak: number
  bestStreak: number
  heatmapStartDate: Date
  dailyMs: number[]
  dayOfWeekAvgMs: number[]
  avgStartHour: number | null
  peakHour: number | null
  avgSessionMs: number
  longestSession: { ms: number; date: string; categoryId: string } | null
  sessionBuckets: [number, number, number, number]
  categoryStats: Record<string, CategoryStats>
  mostMsInDay: { date: string; ms: number } | null
}

export interface HeatCell {
  dayKey: string
  ms: number
}

export interface Quarter {
  label: string
  weeks: Array<Array<HeatCell | null>>
}

export interface PeriodWindows {
  curStart: number
  now: number
  prevStart: number
  prevEnd: number
  elapsedMs: number
}

export interface ChartBucket {
  label: string
  ms: number
}

export interface CategorySeries {
  buckets: ChartBucket[]
  totalMs: number
  avgMsPerDay: number
}

const DAY_MS = 86_400_000

export function getWeekStart(date: Date, weekStartsOn: 'Monday' | 'Sunday'): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = weekStartsOn === 'Monday'
    ? (d.getDay() + 6) % 7
    : d.getDay()
  d.setDate(d.getDate() - dayOfWeek)
  return d
}

/**
 * Current period window plus the *comparable* slice of the previous period —
 * the previous period truncated to the same elapsed time, so a month-to-date
 * compares against the same number of days last month rather than a full month.
 */
export function getPeriodWindows(period: Period, now: Date, weekStartsOn: 'Monday' | 'Sunday'): PeriodWindows {
  const nowMs = now.getTime()
  let curStartDate: Date
  let prevStartDate: Date
  if (period === 'day') {
    curStartDate = new Date(now); curStartDate.setHours(0, 0, 0, 0)
    prevStartDate = new Date(curStartDate); prevStartDate.setDate(prevStartDate.getDate() - 1)
  } else if (period === 'week') {
    curStartDate = getWeekStart(now, weekStartsOn)
    prevStartDate = new Date(curStartDate); prevStartDate.setDate(prevStartDate.getDate() - 7)
  } else {
    curStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
    prevStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  }
  const curStart = curStartDate.getTime()
  const elapsedMs = nowMs - curStart
  const prevStart = prevStartDate.getTime()
  return { curStart, now: nowMs, prevStart, prevEnd: prevStart + elapsedMs, elapsedMs }
}

export function periodLabel(period: Period): string {
  return period === 'day' ? 'Today' : period === 'week' ? 'This week' : 'This month'
}

function overlapMs(entryStart: number, entryEnd: number, winStart: number, winEnd: number): number {
  const s = Math.max(entryStart, winStart)
  const e = Math.min(entryEnd, winEnd)
  return e > s ? e - s : 0
}

export function computeCurrentStreak(daysSet: Set<string>, now: Date): number {
  let streak = 0
  const d = new Date(now)
  d.setHours(12, 0, 0, 0)
  if (!daysSet.has(toLocalDateStr(d))) d.setDate(d.getDate() - 1)
  while (daysSet.has(toLocalDateStr(d))) {
    streak++
    d.setDate(d.getDate() - 1)
  }
  return streak
}

export function computeBestStreak(sortedDays: string[]): number {
  if (sortedDays.length === 0) return 0
  let best = 1, current = 1
  for (let i = 1; i < sortedDays.length; i++) {
    const prev = new Date(sortedDays[i - 1] + 'T12:00:00')
    const curr = new Date(sortedDays[i] + 'T12:00:00')
    const diff = Math.round((curr.getTime() - prev.getTime()) / DAY_MS)
    if (diff === 1) { current++; if (current > best) best = current }
    else current = 1
  }
  return best
}

export function buildHeatmapQuarters(startDate: Date, dailyMs: number[]): Quarter[] {
  const quarters: Quarter[] = []
  let currentQ: Quarter | null = null
  let currentWeek: Array<HeatCell | null> = []

  for (let i = 0; i < 365; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)

    const qNum = Math.floor(date.getMonth() / 3) + 1
    const qLabel = `Q${qNum} '${String(date.getFullYear()).slice(2)}`

    if (!currentQ || currentQ.label !== qLabel) {
      if (currentQ && currentWeek.length > 0) {
        while (currentWeek.length < 7) currentWeek.push(null)
        currentQ.weeks.push(currentWeek)
        currentWeek = []
      }
      currentQ = { label: qLabel, weeks: [] }
      quarters.push(currentQ)
      const dow = (date.getDay() + 6) % 7
      currentWeek = Array<null>(dow).fill(null)
    }

    currentWeek.push({ dayKey: toLocalDateStr(date), ms: dailyMs[i] ?? 0 })

    if ((date.getDay() + 6) % 7 === 6) {
      currentQ.weeks.push(currentWeek)
      currentWeek = []
    }
  }

  if (currentQ && currentWeek.length > 0) {
    while (currentWeek.length < 7) currentWeek.push(null)
    currentQ.weeks.push(currentWeek)
  }

  return quarters
}

/**
 * Per-bucket time for one category over the selected period, optionally filtered
 * to a single tag. Day → 24 hourly bars, Week → 7 daily bars, Month → ~5 weekly
 * bars. Each entry's duration is split across the buckets it overlaps.
 */
export function buildCategorySeries(
  entries: InsightEntry[],
  opts: { categoryId: string; tag: string | null; period: Period; now: Date; weekStartsOn: 'Monday' | 'Sunday' },
): CategorySeries {
  const { categoryId, tag, period, now, weekStartsOn } = opts
  const win = getPeriodWindows(period, now, weekStartsOn)
  const nowMs = now.getTime()

  const ranges: Array<{ label: string; start: number; end: number }> = []
  if (period === 'day') {
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    for (let h = 0; h < 24; h++) {
      const s = dayStart.getTime() + h * 3_600_000
      const label = h % 6 === 0 ? (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`) : ''
      ranges.push({ label, start: s, end: s + 3_600_000 })
    }
  } else if (period === 'week') {
    const wkStart = getWeekStart(now, weekStartsOn)
    const dow = weekStartsOn === 'Monday' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    for (let d = 0; d < 7; d++) {
      const s = wkStart.getTime() + d * DAY_MS
      ranges.push({ label: dow[d], start: s, end: s + DAY_MS })
    }
  } else {
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const mEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    let s = mStart.getTime()
    while (s < mEnd.getTime()) {
      const e = Math.min(s + 7 * DAY_MS, mEnd.getTime())
      const sd = new Date(s).getDate()
      const ed = new Date(e - 1).getDate()
      ranges.push({ label: `${sd}–${ed}`, start: s, end: e })
      s = e
    }
  }

  const buckets: ChartBucket[] = ranges.map(() => ({ label: '', ms: 0 }))
  for (const e of entries) {
    if (e.category_id !== categoryId) continue
    if (tag && !(e.tags ?? []).includes(tag)) continue
    const es = new Date(e.start_time).getTime()
    const ee = e.end_time ? new Date(e.end_time).getTime() : nowMs
    if (ee <= es) continue
    for (let i = 0; i < ranges.length; i++) {
      buckets[i].ms += overlapMs(es, ee, ranges[i].start, ranges[i].end)
    }
  }
  ranges.forEach((r, i) => { buckets[i].label = r.label })

  const totalMs = buckets.reduce((a, b) => a + b.ms, 0)
  const daysElapsed = Math.max(1, Math.ceil(win.elapsedMs / DAY_MS))
  return { buckets, totalMs, avgMsPerDay: totalMs / daysElapsed }
}

export function computeInsights(
  entries: InsightEntry[],
  categories: Category[],
  blocks: CalendarBlock[],
  weekStartsOn: 'Monday' | 'Sunday',
  now: Date,
  period: Period,
): InsightsComputed {
  const nowMs = now.getTime()
  const win = getPeriodWindows(period, now, weekStartsOn)
  const kindOf = new Map(categories.map(c => [c.id, c.kind ?? 'discretionary']))

  function endMsOf(e: InsightEntry): number {
    return e.end_time ? new Date(e.end_time).getTime() : nowMs
  }
  function durMs(e: InsightEntry): number {
    const ms = endMsOf(e) - new Date(e.start_time).getTime()
    return ms > 0 ? ms : 0
  }

  const heatmapStart = new Date(now)
  heatmapStart.setDate(heatmapStart.getDate() - 364)
  heatmapStart.setHours(0, 0, 0, 0)
  const hmStartMs = heatmapStart.getTime()

  // Per-category all-time accumulators
  const catDaySet: Record<string, Set<string>> = {}
  const catAllMs: Record<string, number> = {}
  const catLastTs: Record<string, string> = {}
  for (const cat of categories) { catDaySet[cat.id] = new Set(); catAllMs[cat.id] = 0 }

  let allTimeMs = 0
  const daysWithEntry = new Set<string>()
  const allDailyTotals = new Map<string, number>()
  const hourlyMs = new Array(24).fill(0) as number[]
  const startHourPerDay = new Map<string, number>()
  const dailyMsMap = new Map<string, number>()

  let avgSessionSum = 0, avgSessionCount = 0
  let longestSession: InsightsComputed['longestSession'] = null
  const sessionBuckets: [number, number, number, number] = [0, 0, 0, 0]

  // Period-aware accumulators (overlap-based)
  const byCategory: Record<string, number> = {}
  const prevByCategory: Record<string, number> = {}
  const tagsByCatMap: Record<string, Map<string, number>> = {}
  const periodEntries: InsightEntry[] = []

  for (const e of entries) {
    const startMs = new Date(e.start_time).getTime()
    const endMs = endMsOf(e)
    const ms = durMs(e)
    if (ms <= 0) continue

    const dayKey = toLocalDateStr(new Date(e.start_time))
    allTimeMs += ms
    daysWithEntry.add(dayKey)
    allDailyTotals.set(dayKey, (allDailyTotals.get(dayKey) ?? 0) + ms)

    const hour = new Date(e.start_time).getHours()
    hourlyMs[hour] += ms
    const startFrac = hour + new Date(e.start_time).getMinutes() / 60
    const prevStartFrac = startHourPerDay.get(dayKey)
    if (prevStartFrac === undefined || startFrac < prevStartFrac) startHourPerDay.set(dayKey, startFrac)

    if (startMs >= hmStartMs) dailyMsMap.set(dayKey, (dailyMsMap.get(dayKey) ?? 0) + ms)

    if (catAllMs[e.category_id] !== undefined) {
      catAllMs[e.category_id] += ms
      catDaySet[e.category_id].add(dayKey)
      const prevLt = catLastTs[e.category_id]
      if (!prevLt || e.start_time > prevLt) catLastTs[e.category_id] = e.start_time
    }

    if (!e.is_running && e.end_time) {
      avgSessionSum += ms; avgSessionCount++
      if (!longestSession || ms > longestSession.ms)
        longestSession = { ms, date: e.start_time, categoryId: e.category_id }
      const b = ms < 30 * 60_000 ? 0 : ms < 60 * 60_000 ? 1 : ms < 120 * 60_000 ? 2 : 3
      sessionBuckets[b]++
    }

    // Period overlap
    const curOverlap = overlapMs(startMs, endMs, win.curStart, win.now)
    if (curOverlap > 0) {
      byCategory[e.category_id] = (byCategory[e.category_id] ?? 0) + curOverlap
      if (!tagsByCatMap[e.category_id]) tagsByCatMap[e.category_id] = new Map()
      for (const tag of e.tags ?? []) {
        const m = tagsByCatMap[e.category_id]
        m.set(tag, (m.get(tag) ?? 0) + curOverlap)
      }
      if (startMs >= win.curStart && startMs < win.now) periodEntries.push(e)
    }
    const prevOverlap = overlapMs(startMs, endMs, win.prevStart, win.prevEnd)
    if (prevOverlap > 0) prevByCategory[e.category_id] = (prevByCategory[e.category_id] ?? 0) + prevOverlap
  }

  // Day-of-week averages (all-time)
  const dowTotals = new Array(7).fill(0) as number[]
  const dowCounts = new Array(7).fill(0) as number[]
  for (const [dayKey, ms] of allDailyTotals) {
    const d = new Date(dayKey + 'T12:00:00')
    const dow = (d.getDay() + 6) % 7
    dowTotals[dow] += ms; dowCounts[dow]++
  }
  const dayOfWeekAvgMs = dowTotals.map((t, i) => dowCounts[i] > 0 ? Math.round(t / dowCounts[i]) : 0)

  const dailyMs: number[] = []
  for (let i = 0; i < 365; i++) {
    const d = new Date(heatmapStart); d.setDate(d.getDate() + i)
    dailyMs.push(dailyMsMap.get(toLocalDateStr(d)) ?? 0)
  }

  const startHours = Array.from(startHourPerDay.values())
  const avgStartHour = startHours.length > 0 ? startHours.reduce((a, b) => a + b, 0) / startHours.length : null
  const maxHourly = Math.max(...hourlyMs)
  const peakHour = maxHourly > 0 ? hourlyMs.indexOf(maxHourly) : null

  const sortedDays = Array.from(daysWithEntry).sort()
  const currentStreak = computeCurrentStreak(daysWithEntry, now)
  const bestStreak = computeBestStreak(sortedDays)

  // Context switches & deep work (period)
  const byDay = new Map<string, InsightEntry[]>()
  for (const e of periodEntries) {
    const dk = toLocalDateStr(new Date(e.start_time))
    if (!byDay.has(dk)) byDay.set(dk, [])
    byDay.get(dk)!.push(e)
  }
  let totalSwitches = 0, switchDays = 0
  for (const dayEnts of byDay.values()) {
    switchDays++
    const sorted = dayEnts.slice().sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    let prev = sorted[0]?.category_id
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].category_id !== prev) { totalSwitches++; prev = sorted[i].category_id }
    }
  }
  const deepWorkCount = periodEntries.filter(e => durMs(e) >= 90 * 60_000).length

  // Essential vs discretionary split (period)
  let essentialMs = 0, discretionaryMs = 0
  for (const [catId, ms] of Object.entries(byCategory)) {
    if (kindOf.get(catId) === 'essential') essentialMs += ms
    else discretionaryMs += ms
  }
  const periodTotalMs = essentialMs + discretionaryMs
  const prevTotalMs = Object.values(prevByCategory).reduce((a, b) => a + b, 0)

  const tagsByCategory: Record<string, TagTime[]> = {}
  for (const [catId, m] of Object.entries(tagsByCatMap)) {
    tagsByCategory[catId] = Array.from(m.entries())
      .map(([tag, ms]) => ({ tag, ms }))
      .sort((a, b) => b.ms - a.ms)
  }

  const categoryStats: Record<string, CategoryStats> = {}
  for (const cat of categories) {
    categoryStats[cat.id] = {
      allTimeMs: catAllMs[cat.id] ?? 0,
      periodMs: byCategory[cat.id] ?? 0,
      activeDays: (catDaySet[cat.id] ?? new Set()).size,
      lastTracked: catLastTs[cat.id] ? toLocalDateStr(new Date(catLastTs[cat.id])) : null,
    }
  }

  let mostMsInDay: { date: string; ms: number } | null = null
  for (const [date, ms] of allDailyTotals) {
    if (!mostMsInDay || ms > mostMsInDay.ms) mostMsInDay = { date, ms }
  }

  return {
    period,
    periodLabel: periodLabel(period),
    byCategory,
    prevByCategory,
    periodTotalMs,
    prevTotalMs,
    essentialMs,
    discretionaryMs,
    tagsByCategory,
    deepWorkCount,
    switchRate: switchDays > 0 ? totalSwitches / switchDays : 0,
    allTimeMs,
    allTimeDays: Math.floor(allTimeMs / (24 * 3_600_000)),
    totalEntries: entries.length,
    trackingSince: entries.length > 0 ? new Date(entries[0].start_time) : null,
    currentStreak,
    bestStreak,
    heatmapStartDate: heatmapStart,
    dailyMs,
    dayOfWeekAvgMs,
    avgStartHour,
    peakHour,
    avgSessionMs: avgSessionCount > 0 ? avgSessionSum / avgSessionCount : 0,
    longestSession,
    sessionBuckets,
    categoryStats,
    mostMsInDay,
  }
}
