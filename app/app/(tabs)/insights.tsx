import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator,
  Pressable, Modal,
} from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSettings } from '../../src/contexts/SettingsContext'
import { fonts } from '../../src/theme/tokens'
import { todayStr } from '../../src/lib/date'
import { addLocalDays } from '../../src/lib/time-range'
import * as insightsService from '../../src/services/insights'
import * as categoriesService from '../../src/services/categories'
import * as calendarBlocksService from '../../src/services/calendar-blocks'
import {
  computeInsights, buildHeatmapQuarters, buildCategorySeries, getPeriodWindows,
  type InsightsComputed, type Quarter, type Period, type CategorySeries,
} from '../../src/lib/computeInsights'
import {
  computePlanVsActual, toPlanBlocks, toActualEntries,
  type PlanVsActual, type Diagnosis, type CategoryPva,
} from '../../src/lib/planVsActual'
import type { Category, CalendarBlock } from '../../src/types/database'
import type { InsightEntry } from '../../src/services/insights'

// ─── Format helpers ──────────────────────────────────────────────────────────

function fmtH(ms: number): string {
  if (ms <= 0) return '0m'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function daysSince(dateStr: string): number {
  const target = new Date(dateStr + 'T12:00:00')
  const today = new Date(); today.setHours(12, 0, 0, 0)
  return Math.floor((today.getTime() - target.getTime()) / 86_400_000)
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function heatColor(ms: number, textColor: string): string {
  const opacity = Math.min(0.12 + (ms / 3_600_000 / 4) * 0.88, 1)
  const [r, g, b] = hexToRgb(textColor)
  return `rgba(${r},${g},${b},${opacity.toFixed(2)})`
}

const POSITIVE = '#6B9E6B'
const NEGATIVE = '#B86B6B'
const WARN = '#C9A05C'
const CELL = 9, GAP = 1, CELL_TOTAL = CELL + GAP

type TC = ReturnType<typeof useSettings>['colors']

// ─── Info copy ────────────────────────────────────────────────────────────────

const INFO: Record<string, { title: string; body: string }> = {
  overview: {
    title: 'Overview',
    body: 'The four numbers that matter at a glance for the selected period.\n\n• Untracked — time with no tracked entry, counted only from when you first started tracking (so a brand-new account doesn’t show weeks of "untracked" before you began). Parallel/overlapping entries are merged into a union of intervals, so this never goes negative even when two timers ran at once.\n• Plan adherence — of the time you planned (only counting blocks whose time has already passed), the share you actually spent on the planned category.\n• Unplanned — wall-clock time you tracked that had no matching planned block in the same category.\n• Overlap — time two timers ran at once. Every total on this page merges overlap, so summed task hours can exceed wall-clock; this is the gap.',
  },
  plan: {
    title: 'Plan vs actual',
    body: 'Per category, how much you PLANNED (blocks whose time has elapsed) against what you actually tracked. The matched portion is time that was both planned and done in that category. A shortfall means you planned it but did something else; unplanned means you did it without planning.\n\nThere is no hard link between a plan and a timer, so a plan and an actual are treated as the same intent when they share a category and overlap in time.',
  },
  drift: {
    title: 'Plan drift',
    body: 'Each planned block whose time has passed (or is in progress), and how it actually went:\n• Done — you tracked the same category for most of the block.\n• Partial — you tracked some of it.\n• Missed — little or no matching time.\nStart drift is how late (+) or early (−) the nearest matching entry began versus the plan.',
  },
  breakdown: {
    title: 'Where the time went',
    body: 'Tracked time in the period, split into Essential (the unavoidable — sleep, food, commute) and Discretionary (what you choose). Tap a category row to highlight it in the ring, or tap a ring segment to find its row. Tag times under a category can exceed the category total — an entry with two tags counts toward each.',
  },
  trends: {
    title: 'Trend',
    body: 'Per-bucket time for one category over the period: hourly for Day, daily for Week, weekly for Month. Filter by a tag to narrow to one sub-activity.',
  },
  calibration: {
    title: 'Planning calibration',
    body: 'Across recent days, how realistic your plans are: for each category, the time you planned versus the time you actually delivered. A low ratio means you consistently over-plan that category. Needs a few days of both planning and tracking before it can say anything honest.',
  },
  consistency: {
    title: 'Consistency',
    body: 'Current and best run of consecutive days with any tracking. The grid shows the last 365 days, most recent quarter first; darker = more hours that day.',
  },
  diagnostics: {
    title: 'Diagnostics & definitions',
    body: 'Data-quality notes and how each metric is computed, so the numbers above are never a black box.',
  },
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function SectionHeader({ title, infoKey, tc, onInfo }: { title: string; infoKey?: string; tc: TC; onInfo: (k: string) => void }) {
  return (
    <View style={s.sectionHeaderRow}>
      <Text style={[s.sectionHeader, { color: tc.text2 }]}>{title}</Text>
      {infoKey && (
        <Pressable onPress={() => onInfo(infoKey)} hitSlop={10} style={[s.infoBtn, { borderColor: tc.border2 }]}>
          <Text style={[s.infoBtnText, { color: tc.text3 }]}>i</Text>
        </Pressable>
      )}
    </View>
  )
}

function Divider({ color }: { color: string }) { return <View style={[s.divider, { backgroundColor: color }]} /> }

function SegmentedControl({ period, onChange, tc }: { period: Period; onChange: (p: Period) => void; tc: TC }) {
  const opts: Array<{ key: Period; label: string }> = [
    { key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' },
  ]
  return (
    <View style={[s.segment, { backgroundColor: tc.surface1, borderColor: tc.border }]}>
      {opts.map(o => {
        const active = period === o.key
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[s.segmentBtn, active && { backgroundColor: tc.text1 }]}>
            <Text style={[s.segmentText, { color: active ? tc.bg : tc.text3 }]}>{o.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const DIAG_COLOR: Record<Diagnosis['severity'], string> = {
  deficit: NEGATIVE, drift: WARN, info: '#7B93B8', good: POSITIVE,
}

function DiagnosisCard({ d, tc }: { d: Diagnosis; tc: TC }) {
  const accent = DIAG_COLOR[d.severity]
  return (
    <View style={[s.diagCard, { backgroundColor: tc.surface1, borderColor: tc.border }]}>
      <View style={[s.diagBar, { backgroundColor: accent }]} />
      <View style={s.diagBody}>
        <Text style={[s.diagTitle, { color: tc.text1 }]}>{d.title}</Text>
        <Text style={[s.diagDetail, { color: tc.text2 }]}>{d.detail}</Text>
      </View>
    </View>
  )
}

function StatCell({ value, label, sub, accent, tc }: { value: string; label: string; sub?: string; accent?: string; tc: TC }) {
  return (
    <View style={[s.statCell, { backgroundColor: tc.surface1, borderColor: tc.border }]}>
      <Text style={[s.statValue, { color: accent ?? tc.text1 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[s.statLabel, { color: tc.text3 }]}>{label}</Text>
      {sub ? <Text style={[s.statSub, { color: tc.text4 }]} numberOfLines={1}>{sub}</Text> : null}
    </View>
  )
}

/** Tap-to-open option picker (used for the trend category + tag filters). */
function Dropdown<T extends string | null>({ label, value, display, options, onChange, tc }: {
  label: string; value: T; display: string; options: Array<{ key: T; label: string; color?: string }>; onChange: (v: T) => void; tc: TC
}) {
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.key === value)
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[s.ddBtn, { borderColor: tc.border2, backgroundColor: tc.surface1 }]}>
        <Text style={[s.ddLabel, { color: tc.text4 }]}>{label}</Text>
        <View style={s.ddValueRow}>
          {current?.color && <View style={[s.ddDot, { backgroundColor: current.color }]} />}
          <Text style={[s.ddValue, { color: tc.text1 }]} numberOfLines={1}>{display}</Text>
          <Text style={[s.ddCaret, { color: tc.text4 }]}>▾</Text>
        </View>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.ddBackdrop} onPress={() => setOpen(false)}>
          <View style={[s.ddSheet, { backgroundColor: tc.surface2, borderColor: tc.border }]}>
            <Text style={[s.ddSheetTitle, { color: tc.text3 }]}>{label}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {options.map(o => {
                const active = o.key === value
                return (
                  <Pressable key={String(o.key)} onPress={() => { onChange(o.key); setOpen(false) }}
                    style={[s.ddOpt, active && { backgroundColor: tc.surface3 }]}>
                    {o.color && <View style={[s.ddDot, { backgroundColor: o.color }]} />}
                    <Text style={[s.ddOptText, { color: active ? tc.text1 : tc.text2 }]}>{o.label}</Text>
                    {active && <Text style={[s.ddCheck, { color: tc.text1 }]}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

function DonutChart({ categories, byCategory, total, focusId, onFocus, trackColor, tc }: {
  categories: Category[]; byCategory: Record<string, number>; total: number
  focusId: string | null; onFocus: (id: string | null) => void; trackColor: string; tc: TC
}) {
  const size = 168, sw = 26, r = (size - sw) / 2, cx = size / 2, cy = size / 2
  const circ = 2 * Math.PI * r
  // Segments carry their angular span so a tap can be mapped back to a category.
  const segs: Array<{ id: string; color: string; rotation: number; dash: number; startFrac: number; endFrac: number }> = []
  let cum = 0
  for (const cat of categories) {
    const ms = byCategory[cat.id] ?? 0
    if (ms === 0 || total === 0) continue
    const fraction = ms / total
    if (fraction < 0.005) continue
    segs.push({ id: cat.id, color: cat.color, rotation: -90 + cum * 360, dash: fraction * circ, startFrac: cum, endFrac: cum + fraction })
    cum += fraction
  }
  const focusCat = focusId ? categories.find(c => c.id === focusId) : null
  const focusMs = focusId ? (byCategory[focusId] ?? 0) : 0

  // Map a tap (relative to the donut box) to the segment under it. The ring runs
  // clockwise from 12 o'clock, so we normalise the angle to that frame.
  const handleTap = (x: number, y: number) => {
    const dx = x - cx, dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < r - sw / 2 || dist > r + sw / 2) { onFocus(null); return } // center hole / outside ring
    const ang = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360
    const frac = ang / 360
    const hit = segs.find(seg => frac >= seg.startFrac && frac < seg.endFrac)
    onFocus(hit ? (hit.id === focusId ? null : hit.id) : null)
  }

  return (
    <Pressable style={{ alignSelf: 'center', width: size, height: size, marginTop: 8 }}
      onPress={(e) => handleTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
        {segs.map(seg => {
          const dim = focusId !== null && focusId !== seg.id
          return (
            <Circle key={seg.id} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
              strokeWidth={focusId === seg.id ? sw : sw - 3}
              opacity={dim ? 0.18 : 1}
              strokeDasharray={`${seg.dash} ${circ}`} strokeLinecap="butt"
              transform={`rotate(${seg.rotation}, ${cx}, ${cy})`} />
          )
        })}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }]}>
        {focusCat ? (
          <>
            <Text style={[s.donutCenter, { color: tc.text1 }]}>{fmtH(focusMs)}</Text>
            <Text style={[s.donutUnit, { color: focusCat.color }]} numberOfLines={1}>{focusCat.name}</Text>
          </>
        ) : (
          <>
            <Text style={[s.donutCenter, { color: tc.text1 }]}>{(total / 3_600_000).toFixed(1)}h</Text>
            <Text style={[s.donutUnit, { color: tc.text4 }]}>tracked</Text>
          </>
        )}
      </View>
    </Pressable>
  )
}

function CategoryRow({ cat, ms, total, tags, focused, dimmed, onPress, tc }: {
  cat: Category; ms: number; total: number; tags: Array<{ tag: string; ms: number }>
  focused: boolean; dimmed: boolean; onPress: () => void; tc: TC
}) {
  const pct = total > 0 ? Math.round(ms / total * 100) : 0
  return (
    <Pressable onPress={onPress} style={[s.catRow, focused && { backgroundColor: tc.surface1, borderRadius: 10 }, { opacity: dimmed ? 0.4 : 1 }]}>
      <View style={s.catRowMain}>
        <View style={[s.dot, { backgroundColor: cat.color }]} />
        <Text style={[s.catRowName, { color: tc.text1 }]} numberOfLines={1}>{cat.name}</Text>
        <Text style={[s.catRowPct, { color: tc.text4 }]}>{pct}%</Text>
        <Text style={[s.catRowTime, { color: tc.text2 }]}>{fmtH(ms)}</Text>
      </View>
      {tags.length > 0 && (
        <Text style={[s.catRowTags, { color: tc.text4 }]} numberOfLines={2}>
          {tags.slice(0, 6).map(t => `${t.tag} ${fmtH(t.ms)}`).join('   ·   ')}
        </Text>
      )}
    </Pressable>
  )
}

/** Planned vs actual for one category: two stacked bars on a shared scale. */
function PvaCategoryRow({ name, color, c, scaleMax, tc }: { name: string; color: string; c: CategoryPva; scaleMax: number; tc: TC }) {
  const plannedW = scaleMax > 0 ? (c.plannedMs / scaleMax) * 100 : 0
  const matchedOfPlan = c.plannedMs > 0 ? (c.matchedMs / scaleMax) * 100 : 0
  const actualW = scaleMax > 0 ? (c.actualMs / scaleMax) * 100 : 0
  const matchedOfActual = scaleMax > 0 ? (c.matchedMs / scaleMax) * 100 : 0
  return (
    <View style={s.pvaRow}>
      <View style={s.pvaHead}>
        <View style={[s.dot, { backgroundColor: color }]} />
        <Text style={[s.pvaName, { color: tc.text1 }]} numberOfLines={1}>{name}</Text>
        <Text style={[s.pvaNums, { color: tc.text3 }]}>
          plan {fmtH(c.plannedMs)} · did {fmtH(c.actualMs)}
        </Text>
      </View>
      {/* Planned bar: matched (solid color) + shortfall (faded) */}
      <View style={s.pvaTrack}>
        <Text style={[s.pvaTag, { color: tc.text4 }]}>PLAN</Text>
        <View style={[s.pvaBarBg, { backgroundColor: tc.surface1 }]}>
          {c.plannedMs > 0 && <>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${matchedOfPlan}%`, backgroundColor: color, borderRadius: 4 }} />
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${plannedW}%`, borderRadius: 4, borderWidth: 1, borderColor: color, opacity: 0.55 }} />
          </>}
        </View>
      </View>
      {/* Actual bar: matched (solid) + unplanned (striped/faded) */}
      <View style={s.pvaTrack}>
        <Text style={[s.pvaTag, { color: tc.text4 }]}>DID</Text>
        <View style={[s.pvaBarBg, { backgroundColor: tc.surface1 }]}>
          {c.actualMs > 0 && <>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${actualW}%`, backgroundColor: tc.text4, borderRadius: 4, opacity: 0.5 }} />
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${matchedOfActual}%`, backgroundColor: color, borderRadius: 4 }} />
          </>}
        </View>
      </View>
    </View>
  )
}

function VerticalBarChart({ series, color, trackColor, tc }: { series: CategorySeries; color: string; trackColor: string; tc: TC }) {
  const max = Math.max(...series.buckets.map(b => b.ms), 1)
  return (
    <View style={s.chartWrap}>
      <View style={s.chartBars}>
        {series.buckets.map((b, i) => {
          const h = b.ms > 0 ? Math.max((b.ms / max) * 96, 3) : 0
          return (
            <View key={i} style={s.chartCol}>
              <View style={s.chartBarArea}>
                <View style={[s.chartBar, { height: h, backgroundColor: b.ms > 0 ? color : trackColor }]} />
              </View>
              <Text style={[s.chartLabel, { color: tc.text4 }]} numberOfLines={1}>{b.label}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function HeatmapGrid({ quarters, tc }: { quarters: Quarter[]; tc: TC }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      <View style={{ marginTop: 22, marginRight: 5 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
          <View key={i} style={{ height: CELL_TOTAL, justifyContent: 'center' }}>
            <Text style={[s.heatDayLabel, { color: tc.text4 }]}>{l}</Text>
          </View>
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {quarters.map((q, qi) => (
            <View key={qi} style={{ marginRight: qi < quarters.length - 1 ? 14 : 0 }}>
              <Text style={[s.quarterLabel, { color: tc.text4 }]}>{q.label}</Text>
              <View style={{ flexDirection: 'row' }}>
                {q.weeks.map((week, wi) => (
                  <View key={wi} style={{ marginRight: GAP }}>
                    {week.map((cell, di) => (
                      <View key={di} style={[s.heatCell, {
                        backgroundColor: cell === null ? 'transparent' : cell.ms > 0 ? heatColor(cell.ms, tc.text1) : tc.surface1,
                      }]} />
                    ))}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}

// ─── Calibration (multi-day reducer) ───────────────────────────────────────────

interface CalRow { categoryId: string; plannedMs: number; matchedMs: number; days: number; ratio: number }

function buildCalibration(
  blocks: CalendarBlock[], entries: InsightEntry[], nowMs: number, lookbackDays: number,
): { rows: CalRow[]; daysWithPlan: number } {
  const planBlocks = toPlanBlocks(blocks)
  const actuals = toActualEntries(entries, nowMs)
  const agg = new Map<string, { planned: number; matched: number; days: Set<string> }>()
  let daysWithPlan = 0
  const today = todayStr()
  for (let i = 0; i < lookbackDays; i++) {
    const dayStr = addLocalDays(today, -i)
    const [y, mo, d] = dayStr.split('-').map(Number)
    const dayStart = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
    const winEnd = Math.min(dayStart + 86_400_000, nowMs)
    if (winEnd <= dayStart) continue
    const r = computePlanVsActual({ blocks: planBlocks, entries: actuals, categoryIds: [], winStart: dayStart, winEnd })
    if (!r.hasPlan) continue
    daysWithPlan++
    for (const c of r.byCategory) {
      if (c.plannedMs <= 0) continue
      const a = agg.get(c.categoryId) ?? { planned: 0, matched: 0, days: new Set<string>() }
      a.planned += c.plannedMs; a.matched += c.matchedMs; a.days.add(dayStr)
      agg.set(c.categoryId, a)
    }
  }
  const rows: CalRow[] = Array.from(agg.entries()).map(([categoryId, a]) => ({
    categoryId, plannedMs: a.planned, matchedMs: a.matched, days: a.days.size,
    ratio: a.planned > 0 ? a.matched / a.planned : 0,
  })).sort((x, y) => x.ratio - y.ratio)
  return { rows, daysWithPlan }
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const CALIBRATION_MIN_DAYS = 3
const CALIBRATION_LOOKBACK = 14

export default function InsightsScreen() {
  const { weekStartsOn, colors: tc } = useSettings()
  const [entries, setEntries] = useState<InsightEntry[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [blocks, setBlocks] = useState<CalendarBlock[]>([])
  const [nowTs, setNowTs] = useState(() => Date.now())
  const [period, setPeriod] = useState<Period>('week')
  const [focusCatId, setFocusCatId] = useState<string | null>(null)
  const [chartCatId, setChartCatId] = useState<string | null>(null)
  const [chartTag, setChartTag] = useState<string | null>(null)
  const [info, setInfo] = useState<{ title: string; body: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const today = todayStr()
      const rangeStart = addLocalDays(today, -95)
      const rangeEnd = addLocalDays(today, 1)
      const [ents, cats, blks] = await Promise.all([
        insightsService.getAllEntries(),
        categoriesService.getCategories(),
        calendarBlocksService.getBlocksInRange(rangeStart, rangeEnd),
      ])
      setEntries(ents)
      setCategories(cats)
      setBlocks(blks)
      setNowTs(Date.now())
    } catch { /* keep previous data */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { setLoading(true); void loadData() }, [loadData])
  const onRefresh = useCallback(() => { setRefreshing(true); void loadData() }, [loadData])

  const data: InsightsComputed | null = useMemo(() => {
    if (categories.length === 0 && entries.length === 0) return null
    return computeInsights(entries, categories, [], weekStartsOn, new Date(nowTs), period)
  }, [entries, categories, weekStartsOn, nowTs, period])

  const pva: PlanVsActual | null = useMemo(() => {
    if (!data) return null
    const win = getPeriodWindows(period, new Date(nowTs), weekStartsOn)
    const nameOf = (id: string) => categories.find(c => c.id === id)?.name ?? 'Untitled'
    const trackingStartMs = entries.length > 0 ? new Date(entries[0].start_time).getTime() : undefined
    return computePlanVsActual({
      blocks: toPlanBlocks(blocks),
      entries: toActualEntries(entries, nowTs),
      categoryIds: categories.map(c => c.id),
      winStart: win.curStart, winEnd: win.now, trackingStartMs, nameOf,
    })
  }, [data, blocks, entries, categories, period, nowTs, weekStartsOn])

  const calibration = useMemo(() => {
    if (categories.length === 0) return null
    return buildCalibration(blocks, entries, nowTs, CALIBRATION_LOOKBACK)
  }, [blocks, entries, categories, nowTs])

  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  const activeCats = useMemo(
    () => categories.filter(c => (data?.categoryStats[c.id]?.allTimeMs ?? 0) > 0),
    [categories, data],
  )

  // Default the trend chart to the top discretionary category for the period.
  useEffect(() => {
    if (!data || activeCats.length === 0) return
    if (chartCatId && activeCats.some(c => c.id === chartCatId)) return
    const ranked = [...activeCats].sort((a, b) => (data.byCategory[b.id] ?? 0) - (data.byCategory[a.id] ?? 0))
    const top = ranked.find(c => (c.kind ?? 'discretionary') !== 'essential') ?? ranked[0]
    setChartCatId(top?.id ?? null)
    setChartTag(null)
  }, [data, activeCats, chartCatId])

  const chartCat = categories.find(c => c.id === chartCatId) ?? null
  const series: CategorySeries | null = useMemo(() => {
    if (!chartCatId) return null
    return buildCategorySeries(entries, { categoryId: chartCatId, tag: chartTag, period, now: new Date(nowTs), weekStartsOn })
  }, [entries, chartCatId, chartTag, period, nowTs, weekStartsOn])

  const chartTags = chartCatId ? (data?.tagsByCategory[chartCatId] ?? []) : []

  if (loading) {
    return <View style={[s.safe, { backgroundColor: tc.bg, alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={tc.text3} /></View>
  }
  if (!data || !pva) return <View style={[s.safe, { backgroundColor: tc.bg }]} />

  const periodWord = period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'

  // Overview cells.
  const adherenceStr = pva.adherencePct === null ? '—' : `${Math.round(pva.adherencePct * 100)}%`
  const adherenceAccent = pva.adherencePct === null ? undefined
    : pva.adherencePct >= 0.8 ? POSITIVE : pva.adherencePct >= 0.5 ? WARN : NEGATIVE
  const untrackedPct = pva.elapsedMs > 0 ? Math.round(pva.untrackedMs / pva.elapsedMs * 100) : 0
  const unplannedPct = pva.trackedMs > 0 ? Math.round(pva.unplannedWallMs / pva.trackedMs * 100) : 0

  // Where-the-time-went (period breakdown).
  const splitTotal = data.periodTotalMs
  const discCats = activeCats.filter(c => (c.kind ?? 'discretionary') !== 'essential' && (data.byCategory[c.id] ?? 0) > 0)
    .sort((a, b) => (data.byCategory[b.id] ?? 0) - (data.byCategory[a.id] ?? 0))
  const essCats = activeCats.filter(c => (c.kind ?? 'discretionary') === 'essential' && (data.byCategory[c.id] ?? 0) > 0)
    .sort((a, b) => (data.byCategory[b.id] ?? 0) - (data.byCategory[a.id] ?? 0))
  const discPct = splitTotal > 0 ? Math.round(data.discretionaryMs / splitTotal * 100) : 0
  const essPct = splitTotal > 0 ? 100 - discPct : 0

  // Plan vs actual: only categories with planned-elapsed time can be *compared*.
  // Categories you tracked but never planned are summarised in one line below.
  const pvaRows = pva.byCategory.filter(c => c.plannedMs > 0)
  const pvaUnplanned = pva.byCategory.filter(c => c.plannedMs === 0 && c.actualMs > 0)
    .sort((a, b) => b.actualMs - a.actualMs)
  const pvaScaleMax = Math.max(1, ...pvaRows.map(c => Math.max(c.plannedMs, c.actualMs)))
  const elapsedBlocks = pva.blocks

  // Consistency heatmap — most recent quarter first.
  const quarters = buildHeatmapQuarters(data.heatmapStartDate, data.dailyMs).reverse()

  const renderRow = (cat: Category) => (
    <CategoryRow key={cat.id} cat={cat} ms={data.byCategory[cat.id] ?? 0} total={splitTotal}
      tags={data.tagsByCategory[cat.id] ?? []}
      focused={focusCatId === cat.id} dimmed={focusCatId !== null && focusCatId !== cat.id}
      onPress={() => setFocusCatId(focusCatId === cat.id ? null : cat.id)} tc={tc} />
  )

  return (
    <View style={[s.safe, { backgroundColor: tc.bg }]}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tc.text3} />}>

        <Text style={[s.title, { color: tc.text1 }]}>Insights</Text>
        <SegmentedControl period={period} onChange={setPeriod} tc={tc} />

        {/* ── Diagnosis cards (the payoff) ── */}
        {pva.diagnoses.length > 0 && (
          <View style={s.diagWrap}>
            {pva.diagnoses.slice(0, 5).map(d => <DiagnosisCard key={d.id} d={d} tc={tc} />)}
          </View>
        )}

        {/* ── Overview ── */}
        <SectionHeader title={`Overview · ${periodWord}`} infoKey="overview" tc={tc} onInfo={k => setInfo(INFO[k])} />
        <View style={s.statGrid}>
          <StatCell value={fmtH(pva.untrackedMs)} label="Untracked"
            sub={pva.untrackedMs < 60_000 ? (pva.trackedMs > 0 ? 'all accounted for' : '—') : `${untrackedPct}% of elapsed`} tc={tc} />
          <StatCell value={adherenceStr} label="Plan adherence" accent={adherenceAccent}
            sub={pva.adherencePct === null ? 'no plan elapsed' : `${fmtH(pva.matchedMs)} of ${fmtH(pva.plannedByCatMs)} planned`} tc={tc} />
          <StatCell value={fmtH(pva.unplannedWallMs)} label="Unplanned" sub={pva.trackedMs > 0 ? `${unplannedPct}% of tracked` : '—'} tc={tc} />
          <StatCell value={fmtH(pva.overlapMs)} label="Parallel overlap" sub={pva.overlapMs > 0 ? 'merged from totals' : 'none'} tc={tc} />
        </View>

        <Divider color={tc.border} />

        {/* ── Plan vs actual ── */}
        <SectionHeader title="Plan vs actual" infoKey="plan" tc={tc} onInfo={k => setInfo(INFO[k])} />
        {pvaRows.length > 0 ? (
          <View style={{ gap: 4 }}>
            {pvaRows.map(c => (
              <PvaCategoryRow key={c.categoryId} name={catById.get(c.categoryId)?.name ?? '—'}
                color={catById.get(c.categoryId)?.color ?? tc.text3} c={c} scaleMax={pvaScaleMax} tc={tc} />
            ))}
          </View>
        ) : (
          <Text style={[s.emptyHint, { color: tc.text4 }]}>
            No planned blocks have elapsed {periodWord}. Plan some blocks to see how plan and actual compare.
          </Text>
        )}
        {pvaUnplanned.length > 0 && (
          <Text style={[s.pvaUnplannedLine, { color: tc.text4 }]}>
            Also tracked, unplanned: {pvaUnplanned.slice(0, 5).map(c => `${catById.get(c.categoryId)?.name ?? '—'} ${fmtH(c.actualMs)}`).join(' · ')}
          </Text>
        )}

        {/* Drift table */}
        {elapsedBlocks.length > 0 && (
          <>
            <View style={s.driftHeaderRow}>
              <Text style={[s.driftHeaderText, { color: tc.text3 }]}>PLAN DRIFT</Text>
              <Pressable onPress={() => setInfo(INFO.drift)} hitSlop={10} style={[s.infoBtn, { borderColor: tc.border2 }]}>
                <Text style={[s.infoBtnText, { color: tc.text3 }]}>i</Text>
              </Pressable>
            </View>
            {elapsedBlocks.map(b => {
              const cat = catById.get(b.block.categoryId)
              const statusColor = b.status === 'fulfilled' ? POSITIVE : b.status === 'partial' ? WARN : NEGATIVE
              const statusLabel = b.status === 'fulfilled' ? 'Done' : b.status === 'partial' ? 'Partial' : 'Missed'
              return (
                <View key={b.block.id} style={s.driftRow}>
                  <View style={[s.driftDot, { backgroundColor: cat?.color ?? tc.text4 }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.driftTitle, { color: tc.text1 }]} numberOfLines={1}>{b.block.title}</Text>
                    <Text style={[s.driftMeta, { color: tc.text4 }]}>
                      {fmtClock(new Date(b.block.startMs).toISOString())} · plan {fmtH(b.plannedMs)} · did {fmtH(b.actualMs)}
                      {b.startDriftMin !== null && Math.abs(b.startDriftMin) >= 5 ? `  ·  ${b.startDriftMin > 0 ? '+' : ''}${b.startDriftMin}m start` : ''}
                    </Text>
                  </View>
                  <Text style={[s.driftStatus, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              )
            })}
            {pva.upcomingCount > 0 && (
              <Text style={[s.driftUpcoming, { color: tc.text4 }]}>{pva.upcomingCount} planned block{pva.upcomingCount > 1 ? 's' : ''} still upcoming {periodWord}.</Text>
            )}
          </>
        )}

        <Divider color={tc.border} />

        {/* ── Where the time went ── */}
        <SectionHeader title="Where the time went" infoKey="breakdown" tc={tc} onInfo={k => setInfo(INFO[k])} />
        {splitTotal > 0 ? (
          <>
            <View style={[s.splitBar, { backgroundColor: tc.surface1 }]}>
              <View style={{ width: `${discPct}%`, backgroundColor: tc.text1 }} />
              <View style={{ width: `${essPct}%`, backgroundColor: tc.text4 }} />
            </View>
            <View style={s.splitLegend}>
              <Text style={[s.splitLegendText, { color: tc.text2 }]}>● Discretionary {discPct}% · {fmtH(data.discretionaryMs)}</Text>
              <Text style={[s.splitLegendText, { color: tc.text4 }]}>● Essential {essPct}% · {fmtH(data.essentialMs)}</Text>
            </View>

            <DonutChart categories={categories} byCategory={data.byCategory} total={splitTotal}
              focusId={focusCatId} onFocus={setFocusCatId} trackColor={tc.surface1} tc={tc} />
            {focusCatId && <Text style={[s.donutHint, { color: tc.text4 }]}>Tap the ring or a row again to clear.</Text>}

            {discCats.length > 0 && <Text style={[s.groupLabel, { color: tc.text3 }]}>Discretionary</Text>}
            {discCats.map(renderRow)}
            {essCats.length > 0 && <Text style={[s.groupLabel, { color: tc.text3 }]}>Essential</Text>}
            {essCats.map(renderRow)}
          </>
        ) : (
          <Text style={[s.emptyHint, { color: tc.text4 }]}>Nothing tracked {periodWord} yet.</Text>
        )}

        <Divider color={tc.border} />

        {/* ── Trend ── */}
        <SectionHeader title="Trend" infoKey="trends" tc={tc} onInfo={k => setInfo(INFO[k])} />
        <View style={s.trendFilters}>
          <Dropdown label="CATEGORY" value={chartCatId} display={chartCat?.name ?? 'Select'}
            options={activeCats.map(c => ({ key: c.id, label: c.name, color: c.color }))}
            onChange={(id) => { setChartCatId(id); setChartTag(null) }} tc={tc} />
          <Dropdown label="TAG" value={chartTag} display={chartTag ?? 'All tags'}
            options={[{ key: null, label: 'All tags' } as { key: string | null; label: string }, ...chartTags.map(t => ({ key: t.tag, label: t.tag }))]}
            onChange={setChartTag} tc={tc} />
        </View>
        {series && chartCat && (
          series.totalMs > 0 ? (
            <>
              <View style={s.chartTotalRow}>
                <Text style={[s.chartTotal, { color: tc.text1 }]}>{fmtH(series.totalMs)}</Text>
                {period !== 'day' && <Text style={[s.chartAvg, { color: tc.text4 }]}>{fmtH(Math.round(series.avgMsPerDay))}/day avg</Text>}
              </View>
              <VerticalBarChart series={series} color={chartCat.color} trackColor={tc.surface1} tc={tc} />
            </>
          ) : (
            <Text style={[s.emptyHint, { color: tc.text4 }]}>No {chartCat.name}{chartTag ? ` · ${chartTag}` : ''} tracked {periodWord}.</Text>
          )
        )}

        <Divider color={tc.border} />

        {/* ── Calibration ── */}
        <SectionHeader title="Planning calibration" infoKey="calibration" tc={tc} onInfo={k => setInfo(INFO[k])} />
        {calibration && calibration.daysWithPlan >= CALIBRATION_MIN_DAYS ? (
          <>
            <Text style={[s.calIntro, { color: tc.text4 }]}>Last {CALIBRATION_LOOKBACK} days · {calibration.daysWithPlan} with a plan</Text>
            {calibration.rows.map(r => {
              const cat = catById.get(r.categoryId)
              const pct = Math.round(r.ratio * 100)
              const col = r.ratio >= 0.8 ? POSITIVE : r.ratio >= 0.5 ? WARN : NEGATIVE
              return (
                <View key={r.categoryId} style={s.calRow}>
                  <View style={[s.dot, { backgroundColor: cat?.color ?? tc.text4 }]} />
                  <Text style={[s.calName, { color: tc.text1 }]} numberOfLines={1}>{cat?.name ?? '—'}</Text>
                  <View style={[s.calBarBg, { backgroundColor: tc.surface1 }]}>
                    <View style={{ width: `${Math.min(100, pct)}%`, height: '100%', backgroundColor: col, borderRadius: 3 }} />
                  </View>
                  <Text style={[s.calPct, { color: col }]}>{pct}%</Text>
                </View>
              )
            })}
            <Text style={[s.calFoot, { color: tc.text4 }]}>You deliver this share of what you plan, per category. Low = consistently over-planned.</Text>
          </>
        ) : (
          <Text style={[s.emptyHint, { color: tc.text4 }]}>
            Needs at least {CALIBRATION_MIN_DAYS} days with both a plan and tracking{calibration ? ` (have ${calibration.daysWithPlan})` : ''}. Keep planning your days and this will show whether you over- or under-plan each category.
          </Text>
        )}

        <Divider color={tc.border} />

        {/* ── Consistency ── */}
        <SectionHeader title="Consistency" infoKey="consistency" tc={tc} onInfo={k => setInfo(INFO[k])} />
        <View style={s.twoCol}>
          <View style={s.microStat}>
            <Text style={[s.microValue, { color: tc.text1 }]}>{data.currentStreak} days</Text>
            <Text style={[s.microLabel, { color: tc.text3 }]}>CURRENT STREAK</Text>
          </View>
          <View style={s.microStat}>
            <Text style={[s.microValue, { color: tc.text1 }]}>{data.bestStreak} days</Text>
            <Text style={[s.microLabel, { color: tc.text3 }]}>BEST STREAK</Text>
          </View>
        </View>
        <View style={{ marginTop: 20 }}><HeatmapGrid quarters={quarters} tc={tc} /></View>

        <Divider color={tc.border} />

        {/* ── Diagnostics & definitions ── */}
        <SectionHeader title="Diagnostics" infoKey="diagnostics" tc={tc} onInfo={k => setInfo(INFO[k])} />
        <View style={{ gap: 10 }}>
          <DiagLine label="Tracked (wall-clock union)" value={fmtH(pva.trackedMs)} tc={tc} />
          <DiagLine label="Summed timer durations" value={fmtH(pva.trackedMs + pva.overlapMs)} tc={tc} />
          <DiagLine label="Parallel overlap" value={fmtH(pva.overlapMs)} tc={tc} />
          <DiagLine label="Planned (elapsed)" value={fmtH(pva.plannedElapsedMs)} tc={tc} />
          <DiagLine label="Blocks judged / upcoming" value={`${elapsedBlocks.length} / ${pva.upcomingCount}`} tc={tc} />
        </View>
        <Text style={[s.diagNote, { color: tc.text4 }]}>
          Plans and timers aren’t hard-linked, so a plan and an entry count as the same intent when they share a category and overlap in time. Adherence and drift only judge planned time that has already elapsed.
        </Text>

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* Info popover */}
      <Modal visible={info !== null} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <Pressable style={s.infoBackdrop} onPress={() => setInfo(null)}>
          <Pressable style={[s.infoCard, { backgroundColor: tc.surface2, borderColor: tc.border }]} onPress={() => {}}>
            <Text style={[s.infoTitle, { color: tc.text1 }]}>{info?.title}</Text>
            <Text style={[s.infoBody, { color: tc.text2 }]}>{info?.body}</Text>
            <Pressable onPress={() => setInfo(null)} style={[s.infoClose, { backgroundColor: tc.text1 }]}>
              <Text style={[s.infoCloseText, { color: tc.bg }]}>Got it</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function DiagLine({ label, value, tc }: { label: string; value: string; tc: TC }) {
  return (
    <View style={s.diagLine}>
      <Text style={[s.diagLineLabel, { color: tc.text3 }]}>{label}</Text>
      <Text style={[s.diagLineValue, { color: tc.text1 }]}>{value}</Text>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 48 },

  title: { fontSize: 32, fontFamily: fonts.displayBold, letterSpacing: -0.8, marginBottom: 16 },

  segment: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 24 },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentText: { fontSize: 14, fontFamily: fonts.ui, fontWeight: '600', letterSpacing: 0.2 },

  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sectionHeader: { fontSize: 17, fontFamily: fonts.displaySemiBold, letterSpacing: -0.2 },
  infoBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  infoBtnText: { fontSize: 12, fontFamily: fonts.displayItalic, fontWeight: '600', lineHeight: 15 },

  divider: { height: 1, marginVertical: 26 },
  emptyHint: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 20, textAlign: 'left' },

  // Diagnosis cards
  diagWrap: { gap: 10, marginBottom: 26 },
  diagCard: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  diagBar: { width: 4 },
  diagBody: { flex: 1, paddingVertical: 13, paddingHorizontal: 15, gap: 4 },
  diagTitle: { fontSize: 15.5, fontFamily: fonts.displaySemiBold, letterSpacing: -0.2 },
  diagDetail: { fontSize: 13.5, fontFamily: fonts.ui, lineHeight: 19 },

  // Overview stat grid
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCell: { width: '47.5%', flexGrow: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 16, paddingHorizontal: 16, gap: 5 },
  statValue: { fontSize: 27, fontFamily: fonts.displayBold, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 13.5, fontFamily: fonts.ui, fontWeight: '600' },
  statSub: { fontSize: 11.5, fontFamily: fonts.ui },

  // Plan vs actual
  pvaRow: { paddingVertical: 8, gap: 6 },
  pvaHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pvaName: { flex: 1, fontSize: 14.5, fontFamily: fonts.ui, fontWeight: '600' },
  pvaNums: { fontSize: 12, fontFamily: fonts.ui },
  pvaTrack: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pvaTag: { width: 30, fontSize: 9.5, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 0.5 },
  pvaBarBg: { flex: 1, height: 14, borderRadius: 4 },
  pvaUnplannedLine: { fontSize: 12.5, fontFamily: fonts.ui, lineHeight: 18, marginTop: 12 },

  driftHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  driftHeaderText: { fontSize: 11.5, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 0.6 },
  driftRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 },
  driftDot: { width: 9, height: 9, borderRadius: 4.5 },
  driftTitle: { fontSize: 14, fontFamily: fonts.ui, fontWeight: '500' },
  driftMeta: { fontSize: 11.5, fontFamily: fonts.ui, marginTop: 2 },
  driftStatus: { fontSize: 12.5, fontFamily: fonts.ui, fontWeight: '700' },
  driftUpcoming: { fontSize: 12.5, fontFamily: fonts.ui, marginTop: 10, fontStyle: 'italic' },

  // Where the time went
  splitBar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden' },
  splitLegend: { marginTop: 9, gap: 4 },
  splitLegendText: { fontSize: 13, fontFamily: fonts.ui },
  donutCenter: { fontSize: 24, fontFamily: fonts.displayBold, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  donutUnit: { fontSize: 13, fontFamily: fonts.ui, marginTop: 2, fontWeight: '600', maxWidth: 110, textAlign: 'center' },
  donutHint: { fontSize: 11.5, fontFamily: fonts.ui, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
  groupLabel: { fontSize: 12.5, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 0.4, marginTop: 18, marginBottom: 6, textTransform: 'uppercase' },
  catRow: { paddingVertical: 9, paddingHorizontal: 6, gap: 4 },
  catRowMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catRowName: { flex: 1, fontSize: 15, fontFamily: fonts.ui, fontWeight: '500' },
  catRowPct: { fontSize: 13, fontFamily: fonts.ui, width: 40, textAlign: 'right' },
  catRowTime: { fontSize: 14.5, fontFamily: fonts.mono, width: 70, textAlign: 'right', fontVariant: ['tabular-nums'] },
  catRowTags: { fontSize: 12, fontFamily: fonts.ui, marginLeft: 19, lineHeight: 17 },
  dot: { width: 10, height: 10, borderRadius: 5 },

  // Trend
  trendFilters: { flexDirection: 'row', gap: 10 },
  ddBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12, gap: 3 },
  ddLabel: { fontSize: 9.5, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 0.6 },
  ddValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ddDot: { width: 9, height: 9, borderRadius: 4.5 },
  ddValue: { flex: 1, fontSize: 14.5, fontFamily: fonts.ui, fontWeight: '600' },
  ddCaret: { fontSize: 11 },
  ddBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  ddSheet: { width: '100%', maxWidth: 360, borderRadius: 16, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 8 },
  ddSheetTitle: { fontSize: 10.5, fontFamily: fonts.ui, fontWeight: '700', letterSpacing: 0.8, paddingHorizontal: 12, paddingVertical: 8 },
  ddOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 9 },
  ddOptText: { flex: 1, fontSize: 15, fontFamily: fonts.ui },
  ddCheck: { fontSize: 14, fontWeight: '700' },

  chartTotalRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 18 },
  chartTotal: { fontSize: 22, fontFamily: fonts.displayBold, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  chartAvg: { fontSize: 13, fontFamily: fonts.ui },
  chartWrap: { marginTop: 14 },
  chartBars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3 },
  chartCol: { flex: 1, alignItems: 'center', gap: 6 },
  chartBarArea: { height: 96, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  chartBar: { width: '78%', minWidth: 4, borderRadius: 3 },
  chartLabel: { fontSize: 10, fontFamily: fonts.ui },

  // Calibration
  calIntro: { fontSize: 12, fontFamily: fonts.ui, marginBottom: 12 },
  calRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  calName: { width: 84, fontSize: 14, fontFamily: fonts.ui, fontWeight: '500' },
  calBarBg: { flex: 1, height: 8, borderRadius: 4 },
  calPct: { width: 42, fontSize: 13, fontFamily: fonts.mono, textAlign: 'right', fontVariant: ['tabular-nums'] },
  calFoot: { fontSize: 12, fontFamily: fonts.ui, marginTop: 12, lineHeight: 17 },

  // Consistency
  twoCol: { flexDirection: 'row', gap: 0 },
  microStat: { flex: 1, gap: 4 },
  microValue: { fontSize: 22, fontFamily: fonts.displayBold, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  microLabel: { fontSize: 11.5, fontFamily: fonts.ui, fontWeight: '600', letterSpacing: 0.3 },
  heatDayLabel: { fontSize: 9, fontFamily: fonts.ui, width: 10, textAlign: 'center' },
  quarterLabel: { fontSize: 11, fontFamily: fonts.ui, fontWeight: '600', marginBottom: 4, height: 22 },
  heatCell: { width: CELL, height: CELL, borderRadius: 2, marginBottom: GAP },

  // Diagnostics
  diagLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  diagLineLabel: { fontSize: 13.5, fontFamily: fonts.ui },
  diagLineValue: { fontSize: 14, fontFamily: fonts.mono, fontVariant: ['tabular-nums'] },
  diagNote: { fontSize: 12, fontFamily: fonts.ui, lineHeight: 18, marginTop: 16 },

  // Info modal
  infoBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  infoCard: { borderRadius: 18, borderWidth: 1, padding: 22, maxWidth: 400, gap: 12 },
  infoTitle: { fontSize: 19, fontFamily: fonts.displaySemiBold, letterSpacing: -0.3 },
  infoBody: { fontSize: 14, fontFamily: fonts.ui, lineHeight: 21 },
  infoClose: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, marginTop: 4 },
  infoCloseText: { fontSize: 13.5, fontFamily: fonts.ui, fontWeight: '600' },
})
