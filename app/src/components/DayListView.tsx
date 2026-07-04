import { useMemo } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import type { Category, TimeEntry } from '../types/database'
import { fonts } from '../theme/tokens'
import type { ColorPalette } from '../theme/tokens'
import { mergeIntervals, clampIntervals, type Interval } from '../lib/planVsActual'

/** Local midnight of a "YYYY-MM-DD" date. */
function dayStartLocal(date: string): Date {
  const [y, m, d] = date.split('-').map(n => parseInt(n, 10))
  return new Date(y, m - 1, d, 0, 0, 0, 0)
}

// Toggl-style list rendering of one day's ACTUAL entries: fixed-height rows so
// a 3-minute entry is as visible as a 3-hour one. Gaps between entries render
// as their own tappable rows (up to now — future time is never a gap).

const GAP_MIN_MS = 60_000 // ignore sub-minute rounding gaps

interface DayListViewProps {
  date: string // YYYY-MM-DD (local)
  entries: TimeEntry[] // completed entries overlapping the window
  running: TimeEntry[]
  categories: Category[]
  now: Date
  colors: ColorPalette
  onEntryPress: (entry: TimeEntry) => void
  onGapPress: (startIso: string, endIso: string) => void
}

interface EntryRow {
  kind: 'entry'
  entry: TimeEntry
  startMs: number
  endMs: number // clamped to now for running
  isRunning: boolean
}

interface GapRow {
  kind: 'gap'
  startMs: number
  endMs: number
}

type Row = EntryRow | GapRow

function fmtClock(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}${d.getHours() < 12 ? 'a' : 'p'}`
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return '<1m'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function DayListView({ date, entries, running, categories, now, colors: tc, onEntryPress, onGapPress }: DayListViewProps) {
  const rows = useMemo<Row[]>(() => {
    const dayStart = dayStartLocal(date).getTime()
    const dayEnd = dayStart + 24 * 3600_000
    const nowMs = now.getTime()

    const seen = new Set<string>()
    const entryRows: EntryRow[] = []
    for (const e of [...entries, ...running]) {
      if (seen.has(e.id) || e.deleted_at) continue
      seen.add(e.id)
      const startMs = new Date(e.start_time).getTime()
      const endMs = e.end_time ? new Date(e.end_time).getTime() : nowMs
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue
      if (endMs < startMs) continue // corrupted entry (end before start) — don't render nonsense
      if (endMs <= dayStart || startMs >= dayEnd) continue // no overlap with this day
      entryRows.push({ kind: 'entry', entry: e, startMs, endMs, isRunning: !e.end_time })
    }
    entryRows.sort((a, b) => a.startMs - b.startMs)

    // Gaps between recorded coverage only — never before the first entry,
    // never in the future. Today additionally gets a trailing gap up to now.
    const covered: Interval[] = mergeIntervals(
      clampIntervals(entryRows.map(r => ({ start: r.startMs, end: r.endMs })), dayStart, dayEnd),
    )
    const gapRows: GapRow[] = []
    for (let i = 1; i < covered.length; i++) {
      const gStart = covered[i - 1].end
      const gEnd = Math.min(covered[i].start, nowMs)
      if (gEnd - gStart >= GAP_MIN_MS) gapRows.push({ kind: 'gap', startMs: gStart, endMs: gEnd })
    }
    if (covered.length > 0) {
      const lastEnd = covered[covered.length - 1].end
      const tailEnd = Math.min(dayEnd, nowMs)
      if (tailEnd - lastEnd >= GAP_MIN_MS) gapRows.push({ kind: 'gap', startMs: lastEnd, endMs: tailEnd })
    }

    return [...entryRows, ...gapRows].sort((a, b) => a.startMs - b.startMs)
  }, [date, entries, running, now])

  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: tc.text4 }]}>Nothing tracked this day</Text>
      </View>
    )
  }

  const dayStartMs = dayStartLocal(date).getTime()
  const dayEndMs = dayStartMs + 24 * 3600_000

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {rows.map((row, i) => {
        if (row.kind === 'gap') {
          return (
            <Pressable
              key={`gap-${row.startMs}`}
              style={[styles.gapRow, { borderColor: tc.border2 }]}
              onPress={() => onGapPress(new Date(row.startMs).toISOString(), new Date(row.endMs).toISOString())}
            >
              <Text style={[styles.gapText, { color: tc.text4 }]}>
                {fmtDuration(row.endMs - row.startMs)} untracked
              </Text>
              <Text style={[styles.gapTimes, { color: tc.text4 }]}>
                {fmtClock(row.startMs)} – {fmtClock(row.endMs)}
              </Text>
            </Pressable>
          )
        }
        const cat = categories.find(c => c.id === row.entry.category_id)
        // Markers for entries spilling past this day's bounds (cross-midnight).
        const startsBefore = row.startMs < dayStartMs
        const endsAfter = !row.isRunning && row.endMs > dayEndMs
        return (
          <Pressable
            key={row.entry.id}
            style={[styles.row, { borderBottomColor: tc.border }]}
            onPress={() => onEntryPress(row.entry)}
          >
            <View style={[styles.dot, { backgroundColor: cat?.color ?? tc.text3 }]} />
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: tc.text1 }]} numberOfLines={1}>
                {row.entry.title}
              </Text>
              <Text style={[styles.rowSub, { color: tc.text3 }]} numberOfLines={1}>
                {cat?.name ? `${cat.name} · ` : ''}
                {startsBefore ? '‹ ' : ''}{fmtClock(row.startMs)} – {row.isRunning ? 'now' : fmtClock(row.endMs)}{endsAfter ? ' ›' : ''}
              </Text>
            </View>
            <Text style={[styles.rowDuration, { color: row.isRunning ? tc.text1 : tc.text2 }]}>
              {fmtDuration(row.endMs - row.startMs)}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 120 },
  empty: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 13.5, fontFamily: fonts.ui },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fonts.displaySemiBold,
    letterSpacing: -0.2,
  },
  rowSub: { fontSize: 12.5, fontFamily: fonts.ui },
  rowDuration: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
  },
  gapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
  },
  gapText: { fontSize: 12.5, fontFamily: fonts.ui },
  gapTimes: { fontSize: 12, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] },
})
