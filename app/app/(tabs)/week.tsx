import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useFocusEffect, useRouter } from 'expo-router'
import { colors, spacing, fonts } from '../../src/theme/tokens'
import { useSettings } from '../../src/contexts/SettingsContext'
import { toLocalDateStr } from '../../src/lib/date'
import { getVisiblePlannedBlocks } from '../../src/lib/planned-blocks'
import { daySegmentPx, addLocalDays } from '../../src/lib/time-range'
import { createTimelineTicks } from '../../src/lib/timeline-granularity'
import { useNow } from '../../src/hooks/useNow'
import { useTimer } from '../../src/hooks/useTimer'
import * as categoriesService from '../../src/services/categories'
import * as calendarBlocksService from '../../src/services/calendar-blocks'
import * as timeEntriesService from '../../src/services/time-entries'
import type { Category, CalendarBlock, TimeEntry } from '../../src/types/database'
import type { WeekStart } from '../../src/contexts/SettingsContext'

const START_HOUR = 0
const END_HOUR = 24
const HOURS = END_HOUR - START_HOUR
const BASE_RAIL_HEIGHT = 1440
const MIN_ZOOM = 0.35
const MAX_ZOOM = 2

function formatRemaining(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0 && m > 0) return `${h}h ${m}m left`
  if (h > 0) return `${h}h left`
  return `${m}m left`
}

function getWeekDates(referenceDate: Date, weekStartsOn: WeekStart): Date[] {
  const startDay = weekStartsOn === 'Sunday' ? 0 : 1
  const day = referenceDate.getDay()
  const start = new Date(referenceDate)
  start.setDate(referenceDate.getDate() - ((day - startDay + 7) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Two ranges share a column-split only if they overlap by more than this. Ignores
// minute-rounding drift (a new entry at HH:MM:00 vs the previous stop at HH:MM:43)
// so sequential tasks render single-column; real parallel tasks (minutes) split.
const LANE_OVERLAP_TOL_MS = 60_000
function lanesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > LANE_OVERLAP_TOL_MS
}

function computeBlockLanes(
  blocks: CalendarBlock[],
  entries: TimeEntry[],
  fallbackEnd: string,
): Map<string, 'full' | 'left' | 'right'> {
  const lanes = new Map<string, 'full' | 'left' | 'right'>()
  for (const block of blocks) {
    const bs = new Date(block.start_time).getTime()
    const be = new Date(block.end_time).getTime()
    const overlappingBlocks = blocks
      .filter(other => {
        const os = new Date(other.start_time).getTime()
        const oe = new Date(other.end_time).getTime()
        return lanesOverlap(bs, be, os, oe)
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime() || a.id.localeCompare(b.id))
    if (overlappingBlocks.length > 1) {
      const idx = overlappingBlocks.findIndex(b => b.id === block.id)
      lanes.set(block.id, idx === 0 ? 'left' : 'right')
      continue
    }
    const overlapsEntry = entries.some(e => {
      const es = new Date(e.start_time).getTime()
      const ee = new Date(e.end_time ?? fallbackEnd).getTime()
      return lanesOverlap(bs, be, es, ee)
    })
    lanes.set(block.id, overlapsEntry ? 'left' : 'full')
  }
  return lanes
}

function computeEntryLanes(
  entries: TimeEntry[],
  blocks: CalendarBlock[],
  fallbackEnd: string,
): Map<string, 'full' | 'left' | 'right'> {
  const lanes = new Map<string, 'full' | 'left' | 'right'>()
  for (const entry of entries) {
    const es = new Date(entry.start_time).getTime()
    const ee = new Date(entry.end_time ?? fallbackEnd).getTime()
    const overlappingEntries = entries
      .filter(other => {
        const os = new Date(other.start_time).getTime()
        const oe = new Date(other.end_time ?? fallbackEnd).getTime()
        return lanesOverlap(es, ee, os, oe)
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime() || a.id.localeCompare(b.id))
    if (overlappingEntries.length > 1) {
      lanes.set(entry.id, overlappingEntries.findIndex(o => o.id === entry.id) === 0 ? 'left' : 'right')
      continue
    }
    const overlapsBlock = blocks.some(b => {
      const bs = new Date(b.start_time).getTime()
      const be = new Date(b.end_time).getTime()
      return lanesOverlap(es, ee, bs, be)
    })
    lanes.set(entry.id, overlapsBlock ? 'right' : 'full')
  }
  return lanes
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export default function WeekScreen() {
  const { colors: tc, weekStartsOn } = useSettings()
  const router = useRouter()
  const timer = useTimer()
  const now = useNow()
  const scrollRef = useRef<ScrollView>(null)
  // Days from today for the CENTER column. 0 = today centered. The 3 visible
  // columns are [center-1, center, center+1] and step continuously by 1 day.
  const [centerOffset, setCenterOffset] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [weekBlocks, setWeekBlocks] = useState<CalendarBlock[]>([])
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [zoom, setZoom] = useState(0.85)
  const scrollYRef = useRef(0)
  const zoomRef = useRef(0.5)
  zoomRef.current = zoom
  const viewportHRef = useRef(0)
  const pinchBaseZoomRef = useRef(0.5)
  const pinchFocalOnRailRef = useRef(0)
  const pinchFocalYRef = useRef(0)
  const isPinchingRef = useRef(false)
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingZoomRef = useRef(0.5)
  const pendingScrollRef = useRef(0)
  const pendingScrollAfterZoomRef = useRef<number | null>(null)

  const pinchGesture = useMemo(() => {
    return Gesture.Pinch()
      .runOnJS(true)
      .onStart((e) => {
        isPinchingRef.current = true
        pinchBaseZoomRef.current = zoomRef.current
        pinchFocalYRef.current = e.focalY
        pinchFocalOnRailRef.current = scrollYRef.current + e.focalY
      })
      .onUpdate((e) => {
        const liveZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchBaseZoomRef.current * e.scale))
        const s = liveZoom / pinchBaseZoomRef.current
        const maxScroll = Math.max(0, BASE_RAIL_HEIGHT * liveZoom + 14 - viewportHRef.current)
        const newScroll = Math.max(0, Math.min(pinchFocalOnRailRef.current * s - pinchFocalYRef.current, maxScroll))
        pendingZoomRef.current = liveZoom
        pendingScrollRef.current = newScroll
        if (frameTimerRef.current === null) {
          frameTimerRef.current = setTimeout(() => {
            frameTimerRef.current = null
            const z = pendingZoomRef.current
            const sc = pendingScrollRef.current
            pendingScrollAfterZoomRef.current = sc
            scrollYRef.current = sc
            setZoom(z)
          }, 16)
        }
      })
      .onEnd((e) => {
        if (frameTimerRef.current !== null) {
          clearTimeout(frameTimerRef.current)
          frameTimerRef.current = null
        }
        const finalZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchBaseZoomRef.current * e.scale))
        const s = finalZoom / pinchBaseZoomRef.current
        const rawScroll = pinchFocalOnRailRef.current * s - pinchFocalYRef.current
        const maxScroll = Math.max(0, BASE_RAIL_HEIGHT * finalZoom + 14 - viewportHRef.current)
        const newScroll = Math.max(0, Math.min(rawScroll, maxScroll))
        scrollYRef.current = newScroll
        scrollRef.current?.scrollTo({ y: newScroll, animated: false })
        isPinchingRef.current = false
        setZoom(finalZoom)
      })
  }, [])

  useLayoutEffect(() => {
    if (pendingScrollAfterZoomRef.current !== null) {
      const sc = pendingScrollAfterZoomRef.current
      pendingScrollAfterZoomRef.current = null
      scrollRef.current?.scrollTo({ y: sc, animated: false })
    }
  }, [zoom])

  const today = now
  const centerDate = new Date(today)
  centerDate.setDate(today.getDate() + centerOffset)
  const visibleDates = [-1, 0, 1].map((d) => {
    const x = new Date(centerDate)
    x.setDate(centerDate.getDate() + d)
    return x
  })
  const weekDates = getWeekDates(centerDate, weekStartsOn) // header range + week number

  const startDate = toLocalDateStr(visibleDates[0])
  const endDate = toLocalDateStr(visibleDates[2])
  const todayStr = toLocalDateStr(today)
  const weekNum = getWeekNumber(centerDate)

  const visibleWeekBlocks = useMemo(() => getVisiblePlannedBlocks(weekBlocks, now), [weekBlocks, now])

  const loadData = useCallback(async () => {
    try {
      const [cats, blocks, entries] = await Promise.all([
        categoriesService.getCategories(),
        calendarBlocksService.getBlocksForDateRange(addLocalDays(startDate, -1), endDate),
        timeEntriesService.getEntriesForDateRange(startDate, endDate),
      ])
      setCategories(cats)
      setWeekBlocks(blocks)
      setWeekEntries(entries)
    } catch {}
  }, [startDate, endDate])

  useFocusEffect(useCallback(() => { loadData() }, [loadData]))

  useFocusEffect(useCallback(() => {
    const id = setTimeout(() => {
      const now = new Date()
      const railH = BASE_RAIL_HEIGHT * zoomRef.current
      const pxPerH = railH / HOURS
      const nowH = now.getHours() + now.getMinutes() / 60
      const nowPx = nowH * pxPerH
      const y = Math.max(0, nowPx - viewportHRef.current / 2)
      scrollRef.current?.scrollTo({ y, animated: false })
      scrollYRef.current = y
    }, 50)
    return () => clearTimeout(id)
  }, []))

  const railHeight = BASE_RAIL_HEIGHT * zoom
  const pxPerHour = railHeight / HOURS
  const timelineTicks = useMemo(() => createTimelineTicks(START_HOUR, END_HOUR, zoom), [zoom])

  function hourToPx(time: string): number {
    const d = new Date(time)
    const hours = d.getHours() + d.getMinutes() / 60
    return Math.max(0, (hours - START_HOUR) * pxPerHour)
  }

  const leftNavDate = new Date(visibleDates[0])
  leftNavDate.setDate(leftNavDate.getDate() - 1)
  const rightNavDate = new Date(visibleDates[2])
  rightNavDate.setDate(rightNavDate.getDate() + 1)

  function navigateDay(delta: number) {
    setCenterOffset((o) => o + delta)
  }

  const swipeGesture = useMemo(() => {
    return Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-36, 36])
      .failOffsetY([-24, 24])
      .onEnd((e) => {
        if (isPinchingRef.current) return
        const distance = e.translationX
        const velocity = e.velocityX
        const isSwipe = Math.abs(distance) > 70 || Math.abs(velocity) > 700
        if (!isSwipe) return
        navigateDay(distance < 0 ? 1 : -1)
      })
  }, [])

  return (
    <GestureDetector gesture={swipeGesture}>
    <View style={[s.safe, { backgroundColor: tc.bg }]}>
      {/* Week header */}
      <View style={s.header}>
        <Text style={[s.headerTitle, { color: tc.text1 }]}>Week {weekNum}</Text>
        <Text style={[s.headerSub, { color: tc.text3 }]}>
          {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
      </View>

      {/* 5-column day navigator */}
      <View style={[s.dayNav, { borderBottomColor: tc.border }]}>
        <Pressable style={s.navEdge} onPress={() => navigateDay(-1)} hitSlop={8}>
          <Text style={[s.navEdgeChevron, { color: tc.text4 }]}>‹</Text>
          <Text style={[s.navEdgeDow, { color: tc.text4 }]}>{DOW_SHORT[leftNavDate.getDay()]}</Text>
          <Text style={[s.navEdgeNum, { color: tc.text4 }]}>{leftNavDate.getDate()}</Text>
        </Pressable>
        {visibleDates.map((date, i) => {
          const dateStr = toLocalDateStr(date)
          const isToday = dateStr === todayStr
          return (
            <View key={i} style={[s.colHeader, isToday && [s.colHeaderToday, { borderColor: tc.border2 }]]}>
              <Text style={[s.colDow, { color: tc.text3 }, isToday && { color: tc.text1 }]}>
                {DOW_SHORT[date.getDay()]}
              </Text>
              <Text style={[s.colNum, { color: tc.text2 }, isToday && { color: tc.text1 }]}>
                {date.getDate()}
              </Text>
            </View>
          )
        })}
        <Pressable style={s.navEdgeRight} onPress={() => navigateDay(1)} hitSlop={8}>
          <Text style={[s.navEdgeChevron, { color: tc.text4 }]}>›</Text>
          <Text style={[s.navEdgeDow, { color: tc.text4 }]}>{DOW_SHORT[rightNavDate.getDay()]}</Text>
          <Text style={[s.navEdgeNum, { color: tc.text4 }]}>{rightNavDate.getDate()}</Text>
        </Pressable>
      </View>

      {/* Timeline grid */}
      <GestureDetector gesture={pinchGesture}>
      <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={[s.scroll, { backgroundColor: tc.bg }]}
        bounces={false}
        overScrollMode="never"
        onScroll={(e) => { if (!isPinchingRef.current) scrollYRef.current = e.nativeEvent.contentOffset.y }}
        scrollEventThrottle={16}
        onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height }}
      >
        <View style={{ height: railHeight + 14 }}>
        <View style={s.grid}>
          {/* Hour labels */}
          <View style={[s.hourCol, { height: railHeight }]}>
            {timelineTicks.map(tick => {
              if (!tick.showLabel) return null
              return (
                <Text key={tick.minutes} style={[s.hourTick, { top: tick.topPct * railHeight - 5, color: tc.text2 }]}>
                  {tick.label}
                </Text>
              )
            })}
          </View>

          {/* 3 day columns */}
          {visibleDates.map((date, i) => {
            const dateStr = toLocalDateStr(date)
            const isToday = dateStr === todayStr
            const dayEntries = weekEntries.filter(e => toLocalDateStr(new Date(e.start_time)) === dateStr)
            const runningForDay = timer.running.filter(
              r => toLocalDateStr(new Date(r.start_time)) === dateStr && !dayEntries.some(e => e.id === r.id)
            )
            const allDayEntries = [...dayEntries, ...runningForDay]

            return (
              <Pressable
                key={i}
                style={[s.dayCol, { height: railHeight }, isToday && [s.todayCol, { borderColor: tc.border2 }]]}
                onPress={() => router.push({ pathname: '/(tabs)/day', params: { date: dateStr } })}
              >
                {/* Time grid lines */}
                {timelineTicks.map(tick => (
                  <View
                    key={tick.minutes}
                    style={[
                      s.gridLine,
                      {
                        top: tick.topPct * railHeight,
                        borderTopColor: tc.text1,
                        opacity: tick.isMajor ? 0.2 : 0.1,
                      },
                    ]}
                  />
                ))}

                {/* Planned blocks — full width alone, split left/right when parallel or alongside an entry */}
                {(() => {
                  const completedEntries = allDayEntries.filter(e => !e.is_running)
                  const dayBlocks = visibleWeekBlocks.filter(b => daySegmentPx(b.start_time, b.end_time, dateStr, pxPerHour) !== null)
                  const blockLanes = computeBlockLanes(dayBlocks, completedEntries, now.toISOString())
                  return visibleWeekBlocks.map(block => {
                    const seg = daySegmentPx(block.start_time, block.end_time, dateStr, pxPerHour)
                    if (!seg) return null
                    const cat = categories.find(c => c.id === block.category_id)
                    const catColor = cat?.color ?? tc.text3
                    const top = seg.top
                    const height = Math.max(seg.height, 8)
                    const lane = blockLanes.get(block.id) ?? 'full'
                    const origStartTime = weekBlocks.find(b => b.id === block.id)?.start_time ?? block.start_time
                    const isInProgress = origStartTime !== block.start_time
                    const remainingMs = isInProgress ? new Date(block.end_time).getTime() - now.getTime() : null
                    return (
                      <View
                        key={`${block.id}:${dateStr}`}
                        style={[s.block, {
                          top,
                          height,
                          backgroundColor: 'transparent',
                          borderWidth: 1.5,
                          borderColor: catColor,
                          ...(lane === 'left' ? { right: '50%' } : lane === 'right' ? { left: '50%' } : {}),
                        }]}
                      >
                        <Text style={[s.blockTitle, { color: catColor }]} numberOfLines={1}>
                          {block.title}
                        </Text>
                        {height > 32 && (block.tags.length > 0 || isInProgress) && (
                          <Text style={[s.blockSub, { color: catColor + 'AA' }]} numberOfLines={1}>
                            {isInProgress && remainingMs !== null
                              ? formatRemaining(remainingMs) + (block.tags.length > 0 ? ' · ' + block.tags.join(' · ') : '')
                              : block.tags.join(' · ')}
                          </Text>
                        )}
                      </View>
                    )
                  })
                })()}

                {/* Actual entries (non-running) — overlapping entries split left/right; entries beside a block go right */}
                {(() => {
                  // Entries INTERSECTING this day (incl. cross-midnight ones that
                  // started the previous day), clamped to the column via daySegmentPx
                  // — mirrors block rendering. Fixes long/overnight entries that were
                  // bucketed only to their start day and got a negative (8px) height.
                  const nowIso = now.toISOString()
                  const completedEntries = weekEntries.filter(e =>
                    !e.is_running &&
                    daySegmentPx(e.start_time, e.end_time ?? nowIso, dateStr, pxPerHour) !== null
                  )
                  const dayBlocks = visibleWeekBlocks.filter(b => daySegmentPx(b.start_time, b.end_time, dateStr, pxPerHour) !== null)
                  const lanes = computeEntryLanes(completedEntries, dayBlocks, nowIso)
                  return completedEntries.map(entry => {
                    const seg = daySegmentPx(entry.start_time, entry.end_time ?? nowIso, dateStr, pxPerHour)
                    if (!seg) return null
                    const cat = categories.find(c => c.id === entry.category_id)
                    const catColor = cat?.color ?? tc.text3
                    const top = seg.top
                    const height = Math.max(seg.height, 8)
                    const lane = lanes.get(entry.id) ?? 'full'
                    return (
                      <View
                        key={`${entry.id}:${dateStr}`}
                        style={[s.block, {
                          top,
                          height,
                          backgroundColor: catColor,
                          ...(lane === 'left' ? { right: '50%' } : lane === 'right' ? { left: '50%' } : {}),
                        }]}
                      >
                        <Text style={[s.blockTitle, { color: tc.bg }]} numberOfLines={1}>
                          {entry.title}
                        </Text>
                        {height > 32 && entry.tags.length > 0 && (
                          <Text style={[s.blockSub, { color: tc.bg + '88' }]} numberOfLines={1}>
                            {entry.tags.join(' · ')}
                          </Text>
                        )}
                      </View>
                    )
                  })
                })()}

                {/* Running entries — split A│B if two overlap in this column */}
                {(() => {
                  const runningInCol = allDayEntries
                    .filter(e => e.is_running)
                    .slice()
                    .sort((x, y) => new Date(x.start_time).getTime() - new Date(y.start_time).getTime())
                    .slice(0, 2)
                  if (runningInCol.length === 0) return null

                  const nowPx = hourToPx(now.toISOString())
                  const colorOf = (e: typeof runningInCol[number]) =>
                    categories.find(c => c.id === e.category_id)?.color ?? tc.text3

                  if (runningInCol.length === 1) {
                    const e = runningInCol[0]
                    const top = hourToPx(e.start_time)
                    const height = Math.max(nowPx - top, 8)
                    return (
                      <View key={e.id} style={[s.block, { top, height, backgroundColor: colorOf(e), borderLeftWidth: 2, borderLeftColor: colorOf(e) }]}>
                        <Text style={[s.blockTitle, { color: tc.bg }]} numberOfLines={1}>{e.title}</Text>
                      </View>
                    )
                  }

                  // Each parallel timer in its own half-column, starting at its
                  // OWN start_time so distinct starts are visible (BUG #3).
                  const [a, b] = runningInCol
                  const topA = hourToPx(a.start_time)
                  const topB = hourToPx(b.start_time)
                  const heightA = Math.max(nowPx - topA, 8)
                  const heightB = Math.max(nowPx - topB, 8)
                  return (
                    <>
                      <View key={a.id} style={[s.block, { top: topA, height: heightA, right: '50.5%', backgroundColor: colorOf(a) }]}>
                        <Text style={[s.blockTitle, { color: tc.bg }]} numberOfLines={1}>{a.title}</Text>
                      </View>
                      <View key={b.id} style={[s.block, { top: topB, height: heightB, left: '50.5%', backgroundColor: colorOf(b) }]}>
                        <Text style={[s.blockTitle, { color: tc.bg }]} numberOfLines={1}>{b.title}</Text>
                      </View>
                    </>
                  )
                })()}

                {/* Now line */}
                {isToday && (() => {
                  const nowPx = hourToPx(now.toISOString())
                  return nowPx > 0 && nowPx < railHeight ? (
                    <View style={[s.nowLine, { top: nowPx, backgroundColor: tc.text1 }]} />
                  ) : null
                })()}
              </Pressable>
            )
          })}
        </View>
        </View>
      </ScrollView>
      </View>
      </GestureDetector>
    </View>
    </GestureDetector>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },

  header: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 6,
    paddingLeft: 42,
    paddingRight: 8,
  },
  headerTitle: {
    color: colors.text1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fonts.displaySemiBold,
    letterSpacing: -0.15,
  },
  headerSub: {
    color: colors.text3,
    fontSize: 11.5,
    marginTop: 1,
    fontFamily: fonts.ui,
    fontVariant: ['tabular-nums'],
  },

  // 5-column day navigator
  dayNav: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 6,
    borderBottomWidth: 1,
  },
  navEdge: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 1,
  },
  navEdgeChevron: {
    fontSize: 11,
    fontFamily: fonts.display,
  },
  navEdgeDow: {
    fontSize: 7.5,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  navEdgeNum: {
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
  },
  navEdgeRight: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },

  colHeader: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 8,
  },
  colHeaderToday: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.border2,
  },
  colDow: {
    color: colors.text3,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  colNum: {
    color: colors.text2,
    fontSize: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.2,
    marginTop: 2,
    fontFamily: fonts.ui,
  },

  // Grid
  grid: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 6,
  },
  hourCol: { width: 28, position: 'relative' },
  hourTick: {
    position: 'absolute',
    left: 0,
    color: colors.text2,
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
    letterSpacing: 0.4,
  },
  dayCol: {
    flex: 1,
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
  },
  todayCol: {
    backgroundColor: 'rgba(255,255,255,0.015)',
    borderWidth: 1,
    borderColor: colors.border2,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  block: {
    position: 'absolute',
    left: 3,
    right: 3,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 13,
    fontFamily: fonts.ui,
  },
  blockSub: {
    fontSize: 10,
    color: colors.text3,
    marginTop: 1,
    fontFamily: fonts.ui,
  },
  nowLine: {
    position: 'absolute',
    left: -1,
    right: -1,
    height: 1.5,
    backgroundColor: colors.text1,
    zIndex: 10,
  },
})
