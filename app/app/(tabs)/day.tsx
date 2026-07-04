import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  Platform,
  Keyboard,
  KeyboardAvoidingView,
  Animated,
  type DimensionValue,
} from 'react-native'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Svg, { Path, Rect } from 'react-native-svg'
import { DayListView } from '../../src/components/DayListView'
import { colors, spacing, fonts, radii } from '../../src/theme/tokens'
import { toLocalDateStr } from '../../src/lib/date'
import { getVisiblePlannedBlocks } from '../../src/lib/planned-blocks'
import { resolveLocalRange } from '../../src/lib/time-range'
import { createTimelineTicks } from '../../src/lib/timeline-granularity'
import { emitTimerChange, subscribeTimerChange } from '../../src/lib/timer-events'
import { useTimer, formatElapsed } from '../../src/hooks/useTimer'
import { useNow } from '../../src/hooks/useNow'
import { useSettings } from '../../src/contexts/SettingsContext'
import * as Haptics from 'expo-haptics'
import { FABs } from '../../src/components/FABs'
import { CategoryChip } from '../../src/components/CategoryChip'
import { TimePicker } from '../../src/components/TimePicker'
import { UndoToast } from '../../src/components/UndoToast'
import * as categoriesService from '../../src/services/categories'
import * as calendarBlocksService from '../../src/services/calendar-blocks'
import * as timeEntriesService from '../../src/services/time-entries'
import * as tagsService from '../../src/services/tags'
import * as todosService from '../../src/services/todos'
import type { Category, CalendarBlock, TimeEntry, Tag, Todo } from '../../src/types/database'
import type { TagUsage } from '../../src/services/tags'

const START_HOUR = 0
const END_HOUR = 24
const BASE_RAIL_HEIGHT = 1440

function formatHour12(h: number): string {
  const h12 = h % 12 || 12
  return `${h12}${h < 12 ? 'a' : 'p'}`
}
const MIN_ZOOM = 0.3
const MAX_ZOOM = 8
// Discrete pinch levels. Pinch snaps to the nearest; setZoom fires only on a
// level change → ~2-4 relayouts per gesture instead of ~60. Crisp, no stretch.
const ZOOM_LEVELS = [0.4, 0.6, 0.85, 1, 1.35, 1.8, 2.4, 3, 4, 5.5, 8]
function snapZoom(z: number): number {
  let best = ZOOM_LEVELS[0]
  for (const lvl of ZOOM_LEVELS) {
    if (Math.abs(lvl - z) < Math.abs(best - z)) best = lvl
  }
  return best
}
const INITIAL_WINDOW_DAYS = 2
const EXTEND_WINDOW_DAYS = 3
const MIN_EDGE_LOAD_PX = 220

type TimelineLane = {
  colLeft: DimensionValue
  colRight: DimensionValue
}

type PastEntryRange = {
  startTime: string
  endTime: string
}

type ScrollTarget = {
  date: string
  minute: number
  center: boolean
}

type TagSuggestion = {
  name: string
  count: number
}

const FULL_LANE: TimelineLane = { colLeft: 0, colRight: 0 }
const LEFT_HALF_LANE: TimelineLane = { colLeft: 0, colRight: '50%' }
const RIGHT_HALF_LANE: TimelineLane = { colLeft: '50%', colRight: 0 }

function parseLocalDate(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

function addDays(date: string, delta: number): string {
  const { y, m, d } = parseLocalDate(date)
  const next = new Date(y, m - 1, d)
  next.setDate(next.getDate() + delta)
  return toLocalDateStr(next)
}

function dateOffset(fromDate: string, toDate: string): number {
  const a = parseLocalDate(fromDate)
  const b = parseLocalDate(toDate)
  const aUtc = Date.UTC(a.y, a.m - 1, a.d)
  const bUtc = Date.UTC(b.y, b.m - 1, b.d)
  return Math.round((bUtc - aUtc) / 86_400_000)
}

function listDates(startDate: string, endDate: string): string[] {
  const count = Math.max(0, dateOffset(startDate, endDate))
  return Array.from({ length: count + 1 }, (_, i) => addDays(startDate, i))
}

function hourToPxWithHeight(time: string, railHeight: number, startHour = START_HOUR, endHour = END_HOUR): number {
  const d = new Date(time)
  const hours = d.getHours() + d.getMinutes() / 60
  return (hours - startHour) * (railHeight / (endHour - startHour))
}

// Overlap test. `tolMs` ignores tiny overlaps: the split-into-columns lanes use
// a 1-min tolerance so sequential tasks with minute-rounding drift (e.g. a new
// entry started at HH:MM:00 while the previous stopped at HH:MM:43) don't render
// as two parallel columns. Real parallel tasks overlap by minutes and still split.
function timeRangeOverlaps(aStart: number, aEnd: number, bStart: number, bEnd: number, tolMs = 0): boolean {
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > tolMs
}

// Below this, an overlap is treated as accidental drift, not real parallelism.
const LANE_OVERLAP_TOL_MS = 60_000

function dateAtLocalMinutes(date: string, minutes: number): Date {
  const [y, mo, d] = date.split('-').map(Number)
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)))
  return new Date(y, mo - 1, d, Math.floor(clamped / 60), clamped % 60, 0, 0)
}

function dateAtTimelineMinutes(startDate: string, totalMinutes: number): Date {
  const day = Math.floor(totalMinutes / 1440)
  const minute = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  return dateAtLocalMinutes(addDays(startDate, day), minute)
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const rawTag of tags) {
    const tag = rawTag.trim()
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

function getTagSuggestions(params: {
  categoryId: string | null
  savedTags: Tag[]
  tagUsage: TagUsage[]
  selectedTags: string[]
  query: string
}): TagSuggestion[] {
  if (!params.categoryId) return []
  const selected = new Set(params.selectedTags.map(tag => tag.toLowerCase()))
  const query = params.query.trim().toLowerCase()
  const counts = new Map<string, TagSuggestion>()

  const add = (name: string, count: number) => {
    const tag = name.trim()
    if (!tag) return
    const key = tag.toLowerCase()
    if (selected.has(key)) return
    if (query && !key.includes(query)) return
    const existing = counts.get(key)
    if (existing) {
      existing.count += count
    } else {
      counts.set(key, { name: tag, count })
    }
  }

  for (const tag of params.savedTags) {
    if (tag.category_id === params.categoryId) add(tag.name, 1)
  }
  for (const usage of params.tagUsage) {
    if (usage.category_id !== params.categoryId) continue
    add(usage.name, usage.count * 10)
  }

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 4)
}

interface DraggableItemProps {
  id: string
  startTime: string
  endTime: string
  title: string
  bgColor: string
  titleColor: string
  subColor: string
  subText: string
  tagsText?: string
  plannedColor?: string
  isDragging: boolean
  dragOffset: number
  hourToPx: (time: string) => number
  onTap: (id: string) => void
  onDragStart: (id: string) => void
  onDragUpdate: (translationY: number) => void
  onDragEnd: (id: string, translationY: number) => void
  colLeft?: DimensionValue
  colRight?: DimensionValue
}

const DraggableItem = memo(function DraggableItem({
  id, startTime, endTime, title,
  bgColor, titleColor, subColor, subText, tagsText,
  plannedColor,
  isDragging, dragOffset,
  hourToPx,
  onTap, onDragStart, onDragUpdate, onDragEnd,
  colLeft = 0, colRight = 0,
}: DraggableItemProps) {
  const onTapRef = useRef(onTap)
  const onDragStartRef = useRef(onDragStart)
  const onDragUpdateRef = useRef(onDragUpdate)
  const onDragEndRef = useRef(onDragEnd)
  onTapRef.current = onTap
  onDragStartRef.current = onDragStart
  onDragUpdateRef.current = onDragUpdate
  onDragEndRef.current = onDragEnd

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activateAfterLongPress(400)
      .runOnJS(true)
      .onStart(() => onDragStartRef.current(id))
      .onUpdate((e) => onDragUpdateRef.current(e.translationY))
      .onEnd((e) => onDragEndRef.current(id, e.translationY))

    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => onTapRef.current(id))

    return Gesture.Race(pan, tap)
  }, [id])

  const baseTop = hourToPx(startTime)
  const height = hourToPx(endTime) - baseTop
  if (height <= 0) return null
  const top = isDragging ? baseTop + dragOffset : baseTop

  // Height-aware content: a short block clips 3 lines so text "vanishes".
  // Show only what fits — title, then sub, then tags — and tighten when small
  // so the title stays readable down to ~16px.
  const drawnHeight = Math.max(height, 16)
  const showSub = drawnHeight >= 34
  const showTags = drawnHeight >= 50 && !!tagsText
  const tight = drawnHeight < 30

  return (
    <GestureDetector gesture={gesture}>
      <View style={[styles.block, {
        top,
        height: drawnHeight,
        left: colLeft,
        right: colRight,
        paddingVertical: tight ? 1 : 4,
        justifyContent: tight ? 'center' : 'flex-start',
        backgroundColor: plannedColor ? 'transparent' : bgColor,
        borderWidth: plannedColor ? 1.5 : 0,
        borderColor: plannedColor ?? undefined,
        zIndex: isDragging ? 100 : 1,
        transform: isDragging ? [{ scale: 1.03 }] : [],
        shadowColor: isDragging ? '#000' : 'transparent',
        shadowOffset: { width: 0, height: isDragging ? 8 : 0 },
        shadowOpacity: isDragging ? 0.4 : 0,
        shadowRadius: isDragging ? 12 : 0,
        elevation: isDragging ? 12 : 0,
      }]}>
        <Text
          style={[styles.blockTitle, { color: plannedColor ?? titleColor }, tight && { fontSize: 10, lineHeight: 12 }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {showSub ? (
          <Text style={[styles.blockSub, { color: plannedColor ? plannedColor + 'AA' : subColor }]} numberOfLines={1}>
            {subText}
          </Text>
        ) : null}
        {showTags ? (
          <Text style={[styles.blockSub, { color: plannedColor ? plannedColor + 'AA' : subColor }]} numberOfLines={1}>
            {tagsText}
          </Text>
        ) : null}
      </View>
    </GestureDetector>
  )
})

function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return dateOffset(startDate, date) >= 0 && dateOffset(date, endDate) >= 0
}

export default function DayScreen() {
  const params = useLocalSearchParams<{ sheet?: string; date?: string; editEntry?: string; focusTs?: string }>()
  const timer = useTimer()
  const { colors: tc, snapDragTo, hideSleep, sleepStart, sleepEnd, reduceMotion } = useSettings()
  // Declared before the pinch gesture below, which reads visibleHours.
  const effectiveStart = hideSleep ? sleepEnd : START_HOUR
  const effectiveEnd = hideSleep ? sleepStart : END_HOUR
  const visibleHours = effectiveEnd - effectiveStart
  const now = useNow()
  const scrollRef = useRef<ScrollView>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [blocks, setBlocks] = useState<CalendarBlock[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [savedTags, setSavedTags] = useState<Tag[]>([])
  const [tagUsage, setTagUsage] = useState<TagUsage[]>([])
  const [lastStoppedEntry, setLastStoppedEntry] = useState<TimeEntry | null>(null)
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [windowStartDate, setWindowStartDate] = useState(() => addDays(toLocalDateStr(new Date()), -INITIAL_WINDOW_DAYS))
  const [windowEndDate, setWindowEndDate] = useState(() => addDays(toLocalDateStr(new Date()), INITIAL_WINDOW_DAYS))
  const [showEntrySheet, setShowEntrySheet] = useState(false)
  const [entrySheetRange, setEntrySheetRange] = useState<PastEntryRange | null>(null)
  const [entrySheetDate, setEntrySheetDate] = useState(() => toLocalDateStr(new Date()))
  const [entrySheetInitialMode, setEntrySheetInitialMode] = useState<'timer' | 'past' | 'plan'>('timer')
  const [editingBlock, setEditingBlock] = useState<CalendarBlock | null>(null)
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  // Timeline (proportional) ↔ List (fixed-height Toggl-style rows). Sticky.
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline')
  const [undo, setUndo] = useState<{ kind: 'entry' | 'block'; id: string; label: string } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState(0)
  // Bumped on scroll-band change / layout / programmatic scroll to re-render the
  // visible tick slice (ticks are virtualized to the viewport ± one screen).
  const [, setTickRenderTick] = useState(0)
  const scrollBandRef = useRef(-1)
  const scrollYRef = useRef(0)
  const railWidthRef = useRef(0)
  const zoomRef = useRef(1)
  zoomRef.current = zoom
  const viewportHRef = useRef(0)
  const pinchBaseZoomRef = useRef(1)
  const pinchFocalOnRailRef = useRef(0)
  const pinchFocalYRef = useRef(0)
  const isPinchingRef = useRef(false)
  const pendingScrollAfterZoomRef = useRef<number | null>(null)
  const pendingPrependPxRef = useRef(0)
  const pendingScrollTargetRef = useRef<ScrollTarget | null>(null)
  const programmaticDateScrollRef = useRef<{ date: string; until: number } | null>(null)
  const initialScrollRequestedRef = useRef(false)
  const extendingTopRef = useRef(false)
  const extendingBottomRef = useRef(false)
  const handledEditFocusRef = useRef<string | null>(null)

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
        // Quantize to discrete levels: relayout only when the level changes, so
        // a pinch fires ~2-4 commits instead of ~60. No stretch, always crisp.
        const liveZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchBaseZoomRef.current * e.scale))
        const snapped = snapZoom(liveZoom)
        if (snapped === zoomRef.current) return
        const s = snapped / pinchBaseZoomRef.current
        const dayCount = Math.max(1, dateOffset(windowStartDate, windowEndDate) + 1)
        const maxScroll = Math.max(0, BASE_RAIL_HEIGHT * visibleHours / 24 * snapped * dayCount + 14 - viewportHRef.current)
        const newScroll = Math.max(0, Math.min(pinchFocalOnRailRef.current * s - pinchFocalYRef.current, maxScroll))
        pendingScrollAfterZoomRef.current = newScroll
        scrollYRef.current = newScroll
        setZoom(snapped)
      })
      .onEnd((e) => {
        const finalZoom = snapZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchBaseZoomRef.current * e.scale)))
        const s = finalZoom / pinchBaseZoomRef.current
        const dayCount = Math.max(1, dateOffset(windowStartDate, windowEndDate) + 1)
        const maxScroll = Math.max(0, BASE_RAIL_HEIGHT * visibleHours / 24 * finalZoom * dayCount + 14 - viewportHRef.current)
        const newScroll = Math.max(0, Math.min(pinchFocalOnRailRef.current * s - pinchFocalYRef.current, maxScroll))
        scrollYRef.current = newScroll
        isPinchingRef.current = false
        if (finalZoom !== zoomRef.current) {
          pendingScrollAfterZoomRef.current = newScroll
          setZoom(finalZoom)
        } else {
          scrollRef.current?.scrollTo({ y: newScroll, animated: false })
        }
      })
  }, [windowStartDate, windowEndDate, visibleHours])

  useLayoutEffect(() => {
    if (pendingScrollAfterZoomRef.current !== null) {
      const sc = pendingScrollAfterZoomRef.current
      pendingScrollAfterZoomRef.current = null
      scrollRef.current?.scrollTo({ y: sc, animated: false })
    }
  }, [zoom])

  useEffect(() => {
    extendingBottomRef.current = false
  }, [windowEndDate])

  useEffect(() => {
    if (params.date) {
      const [y, m, d] = params.date.split('-').map(Number)
      setSelectedDate(new Date(y, m - 1, d))
      setWindowStartDate(addDays(params.date, -INITIAL_WINDOW_DAYS))
      setWindowEndDate(addDays(params.date, INITIAL_WINDOW_DAYS))
      pendingScrollTargetRef.current = {
        date: params.date,
        minute: params.date === toLocalDateStr(new Date()) ? new Date().getHours() * 60 + new Date().getMinutes() : effectiveStart * 60,
        center: true,
      }
    }
  // effectiveStart intentionally omitted — only re-scroll when navigating to a new date
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.date])
  // Scale railHeight so px-per-hour stays constant regardless of visible window
  const railHeight = BASE_RAIL_HEIGHT * zoom * visibleHours / 24
  const pxPerHour = railHeight / visibleHours
  const windowDates = useMemo(() => listDates(windowStartDate, windowEndDate), [windowStartDate, windowEndDate])
  const timelineHeight = windowDates.length * railHeight
  const hourToPx = useCallback((time: string) => {
    const itemDate = toLocalDateStr(new Date(time))
    return dateOffset(windowStartDate, itemDate) * railHeight + hourToPxWithHeight(time, railHeight, effectiveStart, effectiveEnd)
  }, [windowStartDate, railHeight, effectiveStart, effectiveEnd])
  const timelineTicks = useMemo(() => createTimelineTicks(effectiveStart, effectiveEnd, zoom), [effectiveStart, effectiveEnd, zoom])

  // Tick virtualization: only render grid lines / labels within the viewport ±
  // one screen. Re-evaluated each render; setTickRenderTick forces a render when
  // the user scrolls a band, so the slice stays current without per-frame state.
  const vhForCull = viewportHRef.current || 800
  const cullTop = scrollYRef.current - vhForCull
  const cullBottom = scrollYRef.current + vhForCull * 2
  const isDayVisible = (dayIndex: number): boolean => {
    const dayTop = dayIndex * railHeight
    return dayTop < cullBottom && dayTop + railHeight > cullTop
  }
  const isTickVisible = (dayIndex: number, topPct: number): boolean => {
    const top = dayIndex * railHeight + topPct * railHeight
    return top >= cullTop && top <= cullBottom
  }

  const getCenteredMinute = useCallback(() => {
    const centerY = scrollYRef.current + Math.max(0, viewportHRef.current / 2)
    const minutesFromEffectiveStart = (centerY / pxPerHour) * 60
    const absoluteMinute = effectiveStart * 60 + minutesFromEffectiveStart
    return ((absoluteMinute % 1440) + 1440) % 1440
  }, [pxPerHour, effectiveStart])

  const scrollToTarget = useCallback((target: ScrollTarget, animated = false) => {
    if (!isDateInRange(target.date, windowStartDate, windowEndDate)) return false
    const maxScroll = Math.max(0, timelineHeight + 14 - viewportHRef.current)
    const baseY = dateOffset(windowStartDate, target.date) * railHeight + (target.minute / 60 - effectiveStart) * pxPerHour
    const y = Math.max(0, Math.min(baseY - (target.center ? viewportHRef.current / 2 : 0), maxScroll))
    scrollRef.current?.scrollTo({ y, animated })
    scrollYRef.current = y
    setTickRenderTick(t => t + 1)
    return true
  }, [pxPerHour, railHeight, timelineHeight, windowEndDate, windowStartDate, effectiveStart])

  const dateStr = toLocalDateStr(selectedDate)
  const isToday = dateStr === toLocalDateStr(now)
  const visibleBlocks = useMemo(() => getVisiblePlannedBlocks(blocks, now), [blocks, now])
  const entrySheetViewDate = entrySheetRange ? toLocalDateStr(new Date(entrySheetRange.startTime)) : entrySheetDate
  const entrySheetBlocks = useMemo(
    () => blocks.filter(block => block.date === entrySheetViewDate),
    [blocks, entrySheetViewDate]
  )

  useLayoutEffect(() => {
    if (pendingPrependPxRef.current <= 0) return
    const nextY = scrollYRef.current + pendingPrependPxRef.current
    pendingPrependPxRef.current = 0
    extendingTopRef.current = false
    scrollYRef.current = nextY
    scrollRef.current?.scrollTo({ y: nextY, animated: false })
    setTickRenderTick(t => t + 1)
  }, [windowStartDate, railHeight])

  const loadData = useCallback(async () => {
    try {
      const dates = listDates(windowStartDate, windowEndDate)
      // Also fetch the day before the window so a block that starts there and
      // spills past midnight still renders on the window's first day.
      const blockDates = [addDays(windowStartDate, -1), ...dates]
      const [cats, savedTagRows, tagUsageRows, blockDays, ents, lastStopped] = await Promise.all([
        categoriesService.getCategories(),
        tagsService.getAllTags(),
        tagsService.getTagUsage(),
        Promise.all(blockDates.map(date => calendarBlocksService.getEffectiveBlocksForDate(date))),
        timeEntriesService.getEntriesForDateRange(windowStartDate, windowEndDate),
        timeEntriesService.getLastStoppedEntry(),
      ])
      setCategories(cats)
      setSavedTags(savedTagRows)
      setTagUsage(tagUsageRows)
      setBlocks(blockDays.flat())
      // Lower bound is one day before the window so a cross-midnight entry that
      // starts the prior evening and spills past midnight still renders.
      setEntries(ents.filter(entry => isDateInRange(toLocalDateStr(new Date(entry.start_time)), addDays(windowStartDate, -1), windowEndDate)))
      setLastStoppedEntry(lastStopped)
    } catch {}
  }, [windowStartDate, windowEndDate])

  useFocusEffect(useCallback(() => { loadData(); timer.refresh() }, [loadData, timer.refresh]))

  useEffect(() => {
    if (params.sheet === 'entry') {
      setEntrySheetRange(null)
      setEntrySheetDate(dateStr)
      setEntrySheetInitialMode('timer')
      setShowEntrySheet(true)
    }
    if (params.sheet === 'plan') {
      setEntrySheetRange(null)
      setEntrySheetDate(dateStr)
      setEntrySheetInitialMode('plan')
      setShowEntrySheet(true)
    }
  }, [params.sheet, params.focusTs])

  useEffect(() => {
    if (initialScrollRequestedRef.current || params.editEntry) return
    initialScrollRequestedRef.current = true
    pendingScrollTargetRef.current = {
      date: dateStr,
      minute: isToday ? now.getHours() * 60 + now.getMinutes() : 7 * 60,
      center: true,
    }
  }, [dateStr, isToday, now, params.editEntry])

  useEffect(() => {
    const target = pendingScrollTargetRef.current
    if (!target || !isDateInRange(target.date, windowStartDate, windowEndDate)) return
    const id = setTimeout(() => {
      if (scrollToTarget(target)) {
        pendingScrollTargetRef.current = null
      }
    }, 50)
    return () => clearTimeout(id)
  }, [scrollToTarget, windowEndDate, windowStartDate])

  function pxToSnappedDate(px: number): Date {
    const maxPx = Math.max(0, timelineHeight - 1)
    const clampedPx = Math.max(0, Math.min(maxPx, px))
    const rawMinutes = (clampedPx / pxPerHour) * 60
    const snappedMinutes = Math.round(rawMinutes / snapDragTo) * snapDragTo
    return dateAtTimelineMinutes(windowStartDate, snappedMinutes)
  }

  function pxToDate(px: number): { date: string; dateTime: Date } {
    const maxPx = Math.max(0, timelineHeight - 1)
    const clampedPx = Math.max(0, Math.min(maxPx, px))
    const rawMinutes = (clampedPx / pxPerHour) * 60
    const dateTime = dateAtTimelineMinutes(windowStartDate, rawMinutes)
    return { date: toLocalDateStr(dateTime), dateTime }
  }

  const handleDragEndRef = useRef<(block: CalendarBlock, offsetPx: number) => void>(() => {})

  handleDragEndRef.current = async (block: CalendarBlock, offsetPx: number) => {
    const originalTop = hourToPx(block.start_time)
    const originalBottom = hourToPx(block.end_time)
    const duration = originalBottom - originalTop
    const startDate = pxToSnappedDate(originalTop + offsetPx)
    const endDate = pxToSnappedDate(originalTop + offsetPx + duration)
    const updates = {
      date: toLocalDateStr(startDate),
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    }
    let previousBlocks: CalendarBlock[] | null = null
    setBlocks(prev => {
      previousBlocks = prev
      return prev.map(b => b.id === block.id ? { ...b, ...updates } : b)
    })
    setDraggingId(null)
    setDragOffset(0)
    try {
      await calendarBlocksService.updateBlock(block.id, updates)
      loadData()
    } catch {
      if (previousBlocks) setBlocks(previousBlocks)
    }
  }

  const handleEntryDragEndRef = useRef<(entry: TimeEntry, offsetPx: number) => void>(() => {})

  handleEntryDragEndRef.current = async (entry: TimeEntry, offsetPx: number) => {
    const originalTop = hourToPx(entry.start_time)
    const endTime = entry.end_time ?? now.toISOString()
    const originalBottom = hourToPx(endTime)
    const duration = originalBottom - originalTop
    const startDate = pxToSnappedDate(originalTop + offsetPx)
    const endDate = pxToSnappedDate(originalTop + offsetPx + duration)
    const updates = {
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
    }
    let previousEntries: TimeEntry[] | null = null
    setEntries(prev => {
      previousEntries = prev
      return prev.map(e => e.id === entry.id ? { ...e, ...updates } : e)
    })
    setDraggingId(null)
    setDragOffset(0)
    try {
      await timeEntriesService.updateEntry(entry.id, updates)
      loadData()
    } catch {
      if (previousEntries) setEntries(previousEntries)
    }
  }

  const handleBlockTap = useCallback((blockId: string) => {
    const block = visibleBlocks.find(b => `${b.id}:${b.date}` === blockId)
    if (block) setEditingBlock(block)
  }, [visibleBlocks])

  const handleEntryTap = useCallback((entryId: string) => {
    const entry = entries.find(e => e.id === entryId)
    if (entry) setEditingEntry(entry)
  }, [entries])

  const handleDragStart = useCallback((itemId: string) => {
    setDraggingId(itemId)
    setDragOffset(0)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }, [])

  const handleDragUpdate = useCallback((translationY: number) => {
    setDragOffset(translationY)
  }, [])

  const handleBlockDragFinish = useCallback((blockId: string, translationY: number) => {
    const block = visibleBlocks.find(b => `${b.id}:${b.date}` === blockId)
    if (block) {
      handleDragEndRef.current(block, translationY)
    } else {
      setDraggingId(null)
      setDragOffset(0)
    }
  }, [visibleBlocks])

  const handleEntryDragFinish = useCallback((entryId: string, translationY: number) => {
    const entry = entries.find(e => e.id === entryId)
    if (entry) {
      handleEntryDragEndRef.current(entry, translationY)
    } else {
      setDraggingId(null)
      setDragOffset(0)
    }
  }, [entries])

  const currentEntry = timer.running[0]
  const currentCategory = categories.find(c => c.id === currentEntry?.category_id)

  const todayStr = toLocalDateStr(now)
  const nowPx = isDateInRange(todayStr, windowStartDate, windowEndDate) ? hourToPx(now.toISOString()) : -1
  const actualEntries = useMemo(() => entries.filter(e => !e.is_running), [entries])

  const getBlockLane = useCallback((block: CalendarBlock): TimelineLane => {
    const blockStart = new Date(block.start_time).getTime()
    const blockEnd = new Date(block.end_time).getTime()

    // Check for overlapping sibling blocks first — split them left/right by start_time order.
    const overlappingBlocks = visibleBlocks
      .filter(other => {
        const os = new Date(other.start_time).getTime()
        const oe = new Date(other.end_time).getTime()
        return timeRangeOverlaps(blockStart, blockEnd, os, oe, LANE_OVERLAP_TOL_MS)
      })
      .sort((a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        || a.id.localeCompare(b.id)
      )

    if (overlappingBlocks.length > 1) {
      const idx = overlappingBlocks.findIndex(b => b.id === block.id && b.date === block.date)
      return idx === 0 ? LEFT_HALF_LANE : RIGHT_HALF_LANE
    }

    // Solo block — push to left only if a completed entry shares the slot.
    const overlapsEntry = actualEntries.some(e => {
      const es = new Date(e.start_time).getTime()
      const ee = new Date(e.end_time ?? now.toISOString()).getTime()
      return timeRangeOverlaps(blockStart, blockEnd, es, ee, LANE_OVERLAP_TOL_MS)
    })
    return overlapsEntry ? LEFT_HALF_LANE : FULL_LANE
  }, [actualEntries, visibleBlocks, now])

  const getActualEntryLane = useCallback((entry: TimeEntry): TimelineLane => {
    const fallbackEnd = now.toISOString()
    const entryStart = new Date(entry.start_time).getTime()
    const entryEnd = new Date(entry.end_time ?? fallbackEnd).getTime()
    const overlappingActuals = actualEntries
      .filter(other => {
        const otherStart = new Date(other.start_time).getTime()
        const otherEnd = new Date(other.end_time ?? fallbackEnd).getTime()
        return timeRangeOverlaps(entryStart, entryEnd, otherStart, otherEnd, LANE_OVERLAP_TOL_MS)
      })
      .sort((a, b) => (
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
        || a.id.localeCompare(b.id)
      ))

    // Two or more actual entries overlapping each other — split them left/right,
    // independent of any planned blocks in the same slot.
    if (overlappingActuals.length > 1) {
      return overlappingActuals.findIndex(o => o.id === entry.id) === 0 ? LEFT_HALF_LANE : RIGHT_HALF_LANE
    }

    // Solo actual entry — go right if a planned block or running timer occupies the left lane.
    const overlapsBlock = visibleBlocks.some(b => {
      const bs = new Date(b.start_time).getTime()
      const be = new Date(b.end_time).getTime()
      return timeRangeOverlaps(entryStart, entryEnd, bs, be, LANE_OVERLAP_TOL_MS)
    })
    if (overlapsBlock) return RIGHT_HALF_LANE

    const overlapsRunning = timer.running.some(r => {
      const rs = new Date(r.start_time).getTime()
      return timeRangeOverlaps(entryStart, entryEnd, rs, now.getTime(), LANE_OVERLAP_TOL_MS)
    })
    return overlapsRunning ? RIGHT_HALF_LANE : FULL_LANE
  }, [actualEntries, visibleBlocks, timer.running, now])

  // Precompute lanes once per data change (NOT per zoom frame). The overlap
  // calc is O(n^2) and zoom-independent, so caching it keeps pinch-zoom smooth.
  const blockLanes = useMemo(() => {
    const m = new Map<string, TimelineLane>()
    for (const b of visibleBlocks) m.set(`${b.id}:${b.date}`, getBlockLane(b))
    return m
  }, [visibleBlocks, getBlockLane])

  const entryLanes = useMemo(() => {
    const m = new Map<string, TimelineLane>()
    for (const e of actualEntries) m.set(e.id, getActualEntryLane(e))
    return m
  }, [actualEntries, getActualEntryLane])

  const openNewTimerSheet = useCallback(() => {
    setEntrySheetRange(null)
    setEntrySheetDate(dateStr)
    setEntrySheetInitialMode('timer')
    setShowEntrySheet(true)
  }, [dateStr])

  useEffect(() => {
    AsyncStorage.getItem('@lifeos_day_view').then(v => {
      if (v === 'list' || v === 'timeline') setViewMode(v)
    }).catch(() => {})
  }, [])

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const next = prev === 'timeline' ? 'list' : 'timeline'
      AsyncStorage.setItem('@lifeos_day_view', next).catch(() => {})
      return next
    })
  }, [])

  const openGapFill = useCallback((startIso: string, endIso: string) => {
    setEntrySheetRange({ startTime: startIso, endTime: endIso })
    setEntrySheetDate(toLocalDateStr(new Date(startIso)))
    setEntrySheetInitialMode('past')
    setShowEntrySheet(true)
  }, [])

  const closeEntrySheet = useCallback(() => {
    setShowEntrySheet(false)
    setEntrySheetRange(null)
  }, [])

  const handleRailLongPress = useCallback((x: number, y: number) => {
    if (draggingId !== null || isPinchingRef.current) return

    const { date: pressedDate, dateTime: pressed } = pxToDate(y)
    const dayStart = dateAtLocalMinutes(pressedDate, 0)
    if (dayStart.getTime() > now.getTime()) return

    const pressedMs = pressed.getTime()
    const nowMs = now.getTime()

    const completedRanges = actualEntries
      .filter(entry => entry.end_time)
      .map(entry => ({
        entry,
        start: new Date(entry.start_time),
        end: new Date(entry.end_time as string),
      }))
      .filter(range => Number.isFinite(range.start.getTime()) && Number.isFinite(range.end.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    const isInsideCompleted = completedRanges.some(range =>
      range.start.getTime() <= pressedMs && pressedMs < range.end.getTime()
    )
    if (isInsideCompleted) return

    const isInsideRunning = timer.running.some(entry => {
      if (!isDateInRange(toLocalDateStr(new Date(entry.start_time)), windowStartDate, windowEndDate)) return false
      const startMs = new Date(entry.start_time).getTime()
      const endMs = nowMs
      return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= pressedMs && pressedMs < endMs
    })
    if (isInsideRunning) return

    const runningRanges = timer.running
      .filter(entry => isDateInRange(toLocalDateStr(new Date(entry.start_time)), windowStartDate, windowEndDate))
      .map(entry => ({
        start: new Date(entry.start_time),
        end: now,
      }))
      .filter(range => Number.isFinite(range.start.getTime()) && Number.isFinite(range.end.getTime()))

    const plannedLaneWidth = railWidthRef.current * 0.44
    const isInsidePlannedLane = railWidthRef.current > 0 && x <= plannedLaneWidth
    const isInsidePlanned = isInsidePlannedLane && visibleBlocks.some(block => {
      const startMs = new Date(block.start_time).getTime()
      const endMs = new Date(block.end_time).getTime()
      return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= pressedMs && pressedMs < endMs
    })
    if (isInsidePlanned) return

    const boundaryRanges = [...completedRanges, ...runningRanges]
      .sort((a, b) => a.start.getTime() - b.start.getTime())

    const above = [...boundaryRanges].reverse().find(range => range.end.getTime() <= pressedMs)
    const below = boundaryRanges.find(range => range.start.getTime() >= pressedMs)

    let start = pressed
    let end = new Date(pressed.getTime() + 60 * 60 * 1000)

    if (above && below) {
      start = above.end
      end = below.start
    } else if (below) {
      start = pressed
      end = below.start
    } else if (above) {
      start = above.end
      end = new Date(above.end.getTime() + 60 * 60 * 1000)
    }

    const maxEnd = pressedDate === todayStr ? now : dateAtLocalMinutes(pressedDate, 23 * 60 + 59)
    if (start.getTime() >= maxEnd.getTime()) return
    if (end.getTime() > maxEnd.getTime()) end = maxEnd
    if (end <= start) return

    setEntrySheetRange({ startTime: start.toISOString(), endTime: end.toISOString() })
    setEntrySheetDate(toLocalDateStr(start))
    setEntrySheetInitialMode('past')
    setShowEntrySheet(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  }, [actualEntries, draggingId, now, timer.running, todayStr, visibleBlocks, windowEndDate, windowStartDate])

  const railLongPressGesture = useMemo(() =>
    Gesture.LongPress()
      .runOnJS(true)
      .minDuration(500)
      .maxDistance(10)
      .onStart((event) => handleRailLongPress(event.x, event.y))
  , [handleRailLongPress])

  useEffect(() => {
    if (!params.editEntry) return
    const focusKey = `${params.editEntry}:${params.focusTs ?? ''}`
    if (handledEditFocusRef.current === focusKey) return
    const entry = timer.running.find(e => e.id === params.editEntry) ?? entries.find(e => e.id === params.editEntry)
    if (!entry) return

    const focusEntry = () => {
      const top = hourToPx(entry.start_time)
      const lead = viewportHRef.current > 0 ? Math.min(180, viewportHRef.current * 0.32) : 120
      const y = Math.max(0, top - lead)
      scrollRef.current?.scrollTo({ y, animated: false })
      scrollYRef.current = y
      setEditingEntry(entry)
    }

    handledEditFocusRef.current = focusKey
    focusEntry()
    const id = setTimeout(focusEntry, 60)
    return () => clearTimeout(id)
  }, [params.editEntry, params.focusTs, timer.running, entries, railHeight])

  useEffect(() => {
    return subscribeTimerChange(() => {
      loadData().catch(() => {})
    })
  }, [loadData])

  const changeDate = useCallback((delta: number) => {
    const nextDateStr = addDays(dateStr, delta)
    const { y, m, d } = parseLocalDate(nextDateStr)
    const target = {
      date: nextDateStr,
      minute: getCenteredMinute(),
      center: true,
    }
    programmaticDateScrollRef.current = { date: nextDateStr, until: Date.now() + 900 }
    setSelectedDate(new Date(y, m - 1, d))
    if (!isDateInRange(nextDateStr, windowStartDate, windowEndDate)) {
      setWindowStartDate(addDays(nextDateStr, -INITIAL_WINDOW_DAYS))
      setWindowEndDate(addDays(nextDateStr, INITIAL_WINDOW_DAYS))
      pendingScrollTargetRef.current = target
      return
    }

    if (!scrollToTarget(target, true)) {
      pendingScrollTargetRef.current = target
    }
  }, [dateStr, getCenteredMinute, scrollToTarget, windowEndDate, windowStartDate])

  const prevDate = new Date(selectedDate)
  prevDate.setDate(selectedDate.getDate() - 1)
  const nextDate = new Date(selectedDate)
  nextDate.setDate(selectedDate.getDate() + 1)

  const swipeGesture = useMemo(() => {
    return Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-28, 28])
      .failOffsetY([-70, 70])
      .onEnd((e) => {
        if (draggingId !== null || isPinchingRef.current) return
        const absX = Math.abs(e.translationX)
        const absY = Math.abs(e.translationY)
        const absVelocityX = Math.abs(e.velocityX)
        const absVelocityY = Math.abs(e.velocityY)
        const isMostlyHorizontal = absX > absY * 1.2 || absVelocityX > absVelocityY * 1.35
        const hasSwipeIntent = absX > 52 || absVelocityX > 520
        const isSwipe = isMostlyHorizontal && hasSwipeIntent
        if (!isSwipe) return
        changeDate(e.translationX < 0 ? 1 : -1)
      })
  }, [changeDate, draggingId])

  const handleTimelineScroll = useCallback((y: number) => {
    if (isPinchingRef.current) return
    scrollYRef.current = y
    // Re-render the visible tick slice once per ~half-screen of scroll (the
    // buffer is ±1 full screen, so the rendered ticks always cover the viewport).
    const bandPx = Math.max(120, (viewportHRef.current || 800) * 0.4)
    const band = Math.round(y / bandPx)
    if (band !== scrollBandRef.current) {
      scrollBandRef.current = band
      setTickRenderTick(t => t + 1)
    }
    const edgeLoadPx = Math.max(
      MIN_EDGE_LOAD_PX,
      Math.min(railHeight * 0.25, viewportHRef.current * 0.5)
    )

    if (y < edgeLoadPx && !extendingTopRef.current) {
      extendingTopRef.current = true
      pendingPrependPxRef.current += EXTEND_WINDOW_DAYS * railHeight
      setWindowStartDate(prev => addDays(prev, -EXTEND_WINDOW_DAYS))
    }

    if (y + viewportHRef.current > timelineHeight - edgeLoadPx && !extendingBottomRef.current) {
      extendingBottomRef.current = true
      setWindowEndDate(prev => addDays(prev, EXTEND_WINDOW_DAYS))
    }

    const centerY = y + Math.max(0, viewportHRef.current / 2)
    const { date } = pxToDate(centerY)
    const programmaticDateScroll = programmaticDateScrollRef.current
    if (programmaticDateScroll) {
      if (Date.now() < programmaticDateScroll.until) {
        return
      }
      programmaticDateScrollRef.current = null
    }
    if (date !== dateStr) {
      const { y: year, m, d } = parseLocalDate(date)
      setSelectedDate(new Date(year, m - 1, d))
    }
  }, [dateStr, railHeight, timelineHeight])

  function formatTime(time: string): string {
    const d = new Date(time)
    const h = d.getHours()
    const m = d.getMinutes()
    const ampm = h >= 12 ? 'pm' : 'am'
    const hour = h % 12 || 12
    return m > 0 ? `${hour}:${String(m).padStart(2, '0')} ${ampm}` : `${hour} ${ampm}`
  }

  function formatRemaining(ms: number): string {
    const totalMin = Math.max(0, Math.round(ms / 60000))
    const h = Math.floor(totalMin / 60)
    const m = totalMin % 60
    if (h > 0 && m > 0) return `${h}h ${m}m left`
    if (h > 0) return `${h}h left`
    return `${m}m left`
  }

  return (
    <View style={[styles.safe, { backgroundColor: tc.bg }]}>
    <GestureDetector gesture={swipeGesture}>
    <View style={{ flex: 1 }}>
      {/* Date nav */}
      <View style={styles.dateNav}>
        <Pressable onPress={() => changeDate(-1)} style={styles.navEdge} hitSlop={12}>
          <Text style={[styles.navEdgeChevron, { color: tc.text4 }]}>‹</Text>
          <Text style={[styles.navEdgeDow, { color: tc.text4 }]}>
            {prevDate.toLocaleDateString('en-US', { weekday: 'short' })}
          </Text>
          <Text style={[styles.navEdgeNum, { color: tc.text4 }]}>{prevDate.getDate()}</Text>
        </Pressable>
        <View style={styles.dateCenter}>
          <Text style={[styles.dateSub, { color: tc.text3 }]}>
            {selectedDate.toLocaleDateString('en-US', { weekday: 'short' })} · {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </Text>
          <Text style={[styles.dateTitle, { color: tc.text1 }]}>
            {isToday ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'long' })}
          </Text>
        </View>
        <Pressable onPress={() => changeDate(1)} style={styles.navEdge} hitSlop={12}>
          <Text style={[styles.navEdgeChevron, { color: tc.text4 }]}>›</Text>
          <Text style={[styles.navEdgeDow, { color: tc.text4 }]}>
            {nextDate.toLocaleDateString('en-US', { weekday: 'short' })}
          </Text>
          <Text style={[styles.navEdgeNum, { color: tc.text4 }]}>{nextDate.getDate()}</Text>
        </Pressable>
      </View>

      {/* Timeline ↔ List */}
      {viewMode === 'list' ? (
        <DayListView
          date={dateStr}
          entries={entries}
          running={timer.running}
          categories={categories}
          now={now}
          colors={tc}
          onEntryPress={setEditingEntry}
          onGapPress={openGapFill}
        />
      ) : (
      <GestureDetector gesture={pinchGesture}>
      <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: tc.bg }]}
        scrollEnabled={draggingId === null}
        bounces={false}
        overScrollMode="never"
        onScroll={(e) => {
          handleTimelineScroll(e.nativeEvent.contentOffset.y)
        }}
        scrollEventThrottle={8}
        onLayout={(e) => { viewportHRef.current = e.nativeEvent.layout.height; setTickRenderTick(t => t + 1) }}
      >
        <View style={{ height: timelineHeight + 14 }}>
        <View style={styles.timeline}>
          {/* Hour ticks */}
          <View style={[styles.hourCol, { height: timelineHeight + 14 }]}>
            {windowDates.map((day, dayIndex) => (
              isDayVisible(dayIndex) ? (
              <View key={`label-day-${day}`}>
                <Text style={[styles.dayBoundaryLabel, { top: dayIndex * railHeight + 4, color: tc.text3 }]}>
                  {dateAtLocalMinutes(day, 0).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {hideSleep ? `  ${formatHour12(effectiveStart)}` : ''}
                </Text>
                {timelineTicks.map(tick => {
                  if (!tick.showLabel) return null
                  if (!isTickVisible(dayIndex, tick.topPct)) return null
                  return (
                    <Text
                      key={`label-${day}-${tick.minutes}`}
                      style={[styles.hourTick, { top: dayIndex * railHeight + tick.topPct * railHeight - 5, color: tc.text2 }]}
                    >
                      {tick.label}
                    </Text>
                  )
                })}
              </View>
              ) : null
            ))}
          </View>

          {/* Rail */}
          <GestureDetector gesture={railLongPressGesture}>
          <View
            style={[styles.rail, { height: timelineHeight + 14 }]}
            onLayout={(event) => { railWidthRef.current = event.nativeEvent.layout.width }}
          >
            {windowDates.map((day, dayIndex) => (
              isDayVisible(dayIndex) ? (
              <View key={`grid-day-${day}`}>
                <View style={[styles.dayBoundaryLine, { top: dayIndex * railHeight, backgroundColor: tc.text2 }]} />
                {hideSleep && dayIndex > 0 && (
                  <Text style={[styles.hourTick, { top: dayIndex * railHeight - 18, color: tc.text4, fontSize: 9, textAlign: 'right', right: 0, left: undefined }]}>
                    {`${formatHour12(sleepStart)}–${formatHour12(sleepEnd)}`}
                  </Text>
                )}
                {timelineTicks.map(tick => (
                  isTickVisible(dayIndex, tick.topPct) ? (
                  <View
                    key={`grid-${day}-${tick.minutes}`}
                    style={[
                      styles.gridLine,
                      {
                        top: dayIndex * railHeight + tick.topPct * railHeight,
                        borderTopColor: tc.text1,
                        opacity: tick.isMajor ? 0.2 : 0.1,
                      },
                    ]}
                  />
                  ) : null
                ))}
              </View>
              ) : null
            ))}

            {/* Planned blocks — full width when alone, left half when an actual entry overlaps */}
            {visibleBlocks.map(block => {
              const cat = categories.find(c => c.id === block.category_id)
              const catColor = cat?.color ?? tc.text3
              const renderId = `${block.id}:${block.date}`
              const lane = blockLanes.get(renderId) ?? FULL_LANE
              // Use the original (pre-clamp) start_time for the label so the
              // plan times stay fixed even after the now-line cuts into the block.
              const origStartTime = blocks.find(b => b.id === block.id)?.start_time ?? block.start_time
              const isInProgress = origStartTime !== block.start_time
              const remainingMs = isInProgress ? new Date(block.end_time).getTime() - now.getTime() : null
              const subText = `${formatTime(origStartTime)} – ${formatTime(block.end_time)}${remainingMs !== null ? ` · ${formatRemaining(remainingMs)}` : ''}`
              return (
                <DraggableItem
                  key={renderId}
                  id={renderId}
                  startTime={block.start_time}
                  endTime={block.end_time}
                  title={block.title}
                  bgColor="transparent"
                  titleColor={tc.text1}
                  subColor={tc.text3}
                  subText={subText}
                  plannedColor={catColor}
                  isDragging={draggingId === block.id}
                  dragOffset={dragOffset}
                  hourToPx={hourToPx}
                  onTap={handleBlockTap}
                  onDragStart={handleDragStart}
                  onDragUpdate={handleDragUpdate}
                  onDragEnd={handleBlockDragFinish}
                  colLeft={lane.colLeft}
                  colRight={lane.colRight}
                />
              )
            })}

            {/* Actual entries — solo entries stay full-width; overlapping actuals split. */}
            {actualEntries.map(entry => {
              const cat = categories.find(c => c.id === entry.category_id)
              const catColor = cat?.color ?? tc.text3
              const endTime = entry.end_time ?? now.toISOString()
              const lane = entryLanes.get(entry.id) ?? FULL_LANE
              return (
                <DraggableItem
                  key={entry.id}
                  id={entry.id}
                  startTime={entry.start_time}
                  endTime={endTime}
                  title={entry.title}
                  bgColor={catColor}
                  titleColor={tc.bg}
                  subColor={tc.bg + '99'}
                  subText={`${formatTime(entry.start_time)} → ${formatTime(endTime)}`}
                  isDragging={draggingId === entry.id}
                  dragOffset={dragOffset}
                  hourToPx={hourToPx}
                  onTap={handleEntryTap}
                  onDragStart={handleDragStart}
                  onDragUpdate={handleDragUpdate}
                  onDragEnd={handleEntryDragFinish}
                  colLeft={lane.colLeft}
                  colRight={lane.colRight}
                />
              )
            })}

            {/* Running entries — one full-width, or two split A│B over their overlap */}
            {timer.running.length > 0 && (() => {
              if (nowPx < 0) return null
              const runningEntries = timer.running
                .filter(entry => isDateInRange(toLocalDateStr(new Date(entry.start_time)), windowStartDate, windowEndDate))
                .filter(entry => hourToPx(entry.start_time) <= nowPx)
                .slice(0, 2)
              if (runningEntries.length === 0) return null
              const colorOf = (e: typeof runningEntries[number]) =>
                categories.find(c => c.id === e.category_id)?.color ?? tc.text3
              const body = (e: typeof runningEntries[number]) => (
                <>
                  <Text style={[styles.blockTitle, { color: tc.bg }]} numberOfLines={1}>{e.title}</Text>
                  <Text style={[styles.blockSub, { color: tc.bg + '99' }]} numberOfLines={1}>
                    {formatElapsed(timer.elapsed[e.id] ?? 0)} · running
                  </Text>
                </>
              )

              const MIN_H = 40
              const liveLayout = (startTime: string) => {
                const trueTop = hourToPx(startTime)
                const top = Math.max(0, Math.min(trueTop, nowPx - MIN_H))
                return { top, height: Math.max(2, nowPx - top) }
              }

              if (runningEntries.length === 1) {
                const entry = runningEntries[0]
                const { top, height } = liveLayout(entry.start_time)
                const entryStartMs = new Date(entry.start_time).getTime()
                const hasOverlappingActual = actualEntries.some(e => {
                  const es = new Date(e.start_time).getTime()
                  const ee = new Date(e.end_time ?? now.toISOString()).getTime()
                  return timeRangeOverlaps(entryStartMs, now.getTime(), es, ee, LANE_OVERLAP_TOL_MS)
                })
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => setEditingEntry(entry)}
                    style={[styles.block, { top, height, left: 0, right: hasOverlappingActual ? '50%' : 0, backgroundColor: colorOf(entry) }]}
                  >
                    {body(entry)}
                  </Pressable>
                )
              }

              // Two parallel timers split the full width into halves, each
              // starting at its OWN start_time so distinct starts are visible
              // (BUG #3). A = earlier (left), B = later (right).
              const [a, b] = runningEntries
              const { top: topA, height: heightA } = liveLayout(a.start_time)
              const { top: topB, height: heightB } = liveLayout(b.start_time)
              return (
                <>
                  <Pressable
                    key={a.id}
                    onPress={() => setEditingEntry(a)}
                    style={[styles.block, { top: topA, height: heightA, left: 0, right: '50%', backgroundColor: colorOf(a) }]}
                  >
                    {body(a)}
                  </Pressable>
                  <Pressable
                    key={b.id}
                    onPress={() => setEditingEntry(b)}
                    style={[styles.block, { top: topB, height: heightB, left: '50%', right: 0, backgroundColor: colorOf(b) }]}
                  >
                    {body(b)}
                  </Pressable>
                </>
              )
            })()}

            {/* Now line */}
            {nowPx > 0 && nowPx < timelineHeight && (
              <View style={[styles.nowLine, { top: nowPx, borderTopColor: tc.text1 }]}>
                <View style={[styles.nowDot, { backgroundColor: tc.text1 }]} />
                <View style={[styles.nowRule, { backgroundColor: tc.text1 }]} />
              </View>
            )}
          </View>
          </GestureDetector>
        </View>
        </View>
      </ScrollView>
      </View>
      </GestureDetector>
      )}
    </View>
    </GestureDetector>

      {/* View-mode toggle — quiet ghost button above the FAB */}
      <Pressable
        onPress={toggleViewMode}
        style={[styles.viewToggle, { borderColor: tc.border3, backgroundColor: tc.bg }]}
        hitSlop={8}
      >
        {viewMode === 'timeline' ? (
          // switch to list → rows glyph
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Path d="M2 4h12M2 8h12M2 12h8" stroke={tc.text3} strokeWidth={1.6} strokeLinecap="round" />
          </Svg>
        ) : (
          // switch to timeline → column glyph
          <Svg width={16} height={16} viewBox="0 0 16 16" fill="none">
            <Rect x={6} y={2} width={4} height={5} rx={1} stroke={tc.text3} strokeWidth={1.4} />
            <Rect x={6} y={9} width={4} height={5} rx={1} stroke={tc.text3} strokeWidth={1.4} />
          </Svg>
        )}
      </Pressable>

      <FABs onPress={openNewTimerSheet} />

      <AddEntrySheet
        visible={showEntrySheet}
        categories={categories}
        blocks={entrySheetBlocks}
        savedTags={savedTags}
        tagUsage={tagUsage}
        runningCount={timer.running.length}
        lastStopTime={lastStoppedEntry?.end_time ?? null}
        viewDate={entrySheetViewDate}
        initialMode={entrySheetInitialMode}
        initialLogPastRange={entrySheetRange}
        onClose={closeEntrySheet}
        onStart={async (categoryId, title, tags, parallel, startTime, notes, todoId) => {
          if (parallel) {
            await timer.startParallel({ categoryId, title, tags, startTime, notes, todoId })
          } else {
            await timer.start({ categoryId, title, tags, startTime, notes, todoId })
          }
          closeEntrySheet()
          loadData()
        }}
        onSaveCompleted={async (categoryId, title, tags, startTime, endTime, notes, todoId) => {
          await timeEntriesService.addCompletedEntry({ category_id: categoryId, title, tags, start_time: startTime, end_time: endTime, notes, todo_id: todoId })
          closeEntrySheet()
          loadData()
        }}
        onSavePlan={async () => {
          closeEntrySheet()
          loadData()
        }}
        onCategoryCreated={() => loadData()}
      />

      <EditBlockSheet
        block={editingBlock}
        categories={categories}
        savedTags={savedTags}
        tagUsage={tagUsage}
        onClose={() => setEditingBlock(null)}
        onSave={async () => {
          setEditingBlock(null)
          loadData()
        }}
        onDelete={async () => {
          const deleted = editingBlock
          setEditingBlock(null)
          loadData()
          if (deleted) setUndo({ kind: 'block', id: deleted.id, label: 'Block deleted' })
        }}
      />

      <EditEntrySheet
        entry={editingEntry}
        categories={categories}
        savedTags={savedTags}
        tagUsage={tagUsage}
        lastStopTime={lastStoppedEntry?.end_time ?? null}
        onClose={() => setEditingEntry(null)}
        onSave={async () => {
          setEditingEntry(null)
          loadData()
        }}
        onDelete={async () => {
          const deleted = editingEntry
          setEditingEntry(null)
          loadData()
          if (deleted) setUndo({ kind: 'entry', id: deleted.id, label: 'Entry deleted' })
        }}
        onCategoryCreated={() => loadData()}
      />

      {undo && (
        <UndoToast
          key={undo.id}
          message={undo.label}
          colors={tc}
          reduceMotion={reduceMotion}
          onUndo={async () => {
            try {
              if (undo.kind === 'entry') await timeEntriesService.restoreEntry(undo.id)
              else await calendarBlocksService.restoreBlock(undo.id)
              emitTimerChange()
              loadData()
            } catch {
              // ignore — entry stays deleted; toast dismisses
            }
            setUndo(null)
          }}
          onHide={() => setUndo(null)}
        />
      )}
    </View>
  )
}

function SheetShell({
  visible,
  reduceMotion,
  onBackdropPress,
  onPullDown,
  surfaceColor,
  borderColor,
  children,
  footer,
  errorMessage,
  onDismissError,
}: {
  visible: boolean
  reduceMotion: boolean
  onBackdropPress: () => void
  onPullDown: () => void
  surfaceColor: string
  borderColor: string
  children: ReactNode
  footer: ReactNode
  errorMessage?: string | null
  onDismissError?: () => void
}) {
  const onPullDownRef = useRef(onPullDown)
  onPullDownRef.current = onPullDown

  const dragY = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (visible) dragY.setValue(0)
  }, [visible, dragY])

  const pullGesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetY(10)
      .failOffsetX([-20, 20])
      .onUpdate((e) => {
        dragY.setValue(Math.max(0, e.translationY))
      })
      .onEnd((e) => {
        if (e.translationY > 60) {
          Animated.timing(dragY, { toValue: 800, duration: 220, useNativeDriver: true })
            .start(() => onPullDownRef.current())
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 300 }).start()
        }
      })
  , [dragY])

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'none' : 'slide'} transparent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={sheetStyles.keyboard}>
        <View style={sheetStyles.backdrop}>
          <Pressable style={sheetStyles.backdropTap} onPress={onBackdropPress} />
          <Animated.View style={[sheetStyles.sheet, { backgroundColor: surfaceColor, borderTopColor: borderColor }, { transform: [{ translateY: dragY }] }]}>
            <GestureDetector gesture={pullGesture}>
              <View style={sheetStyles.handleArea}>
                <View style={sheetStyles.handle} />
              </View>
            </GestureDetector>
            <ScrollView
              style={sheetStyles.scroller}
              contentContainerStyle={sheetStyles.content}
              keyboardShouldPersistTaps="always"
            >
              {children}
            </ScrollView>
            {errorMessage ? (
              <Pressable
                style={sheetStyles.errorBanner}
                onPress={onDismissError}
                accessibilityRole="alert"
                accessibilityLabel={errorMessage}
              >
                <Text style={sheetStyles.errorText}>{errorMessage}</Text>
                <Text style={sheetStyles.errorDismiss}>✕</Text>
              </Pressable>
            ) : null}
            <View style={[sheetStyles.footer, { backgroundColor: surfaceColor, borderTopColor: borderColor }]}>
              {footer}
            </View>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const CATEGORY_PALETTE = [
  '#B5AAC2', '#CCBADD', '#E7D0A2', '#AFC8AC',
  '#D2CFC5', '#C4B3A4', '#D4A5A5', '#A5BED4',
  '#B5D4C2', '#D4B5A5', '#94A3B8', '#64748B',
] as const

// ─── Add Entry Sheet ─────────────────────────────────────
interface AddEntrySheetProps {
  visible: boolean
  categories: Category[]
  blocks: CalendarBlock[]
  savedTags: Tag[]
  tagUsage: TagUsage[]
  runningCount: number
  lastStopTime: string | null
  viewDate: string
  initialMode: 'timer' | 'past' | 'plan'
  initialLogPastRange: PastEntryRange | null
  onClose: () => void
  onStart: (categoryId: string, title: string, tags: string[], parallel: boolean, startTime?: string, notes?: string | null, todoId?: string | null) => void | Promise<void>
  onSaveCompleted: (categoryId: string, title: string, tags: string[], startTime: string, endTime: string, notes?: string | null, todoId?: string | null) => void | Promise<void>
  onSavePlan: () => void | Promise<void>
  onCategoryCreated: (cat: Category) => void | Promise<void>
}

function AddEntrySheet({ visible, categories, blocks, savedTags, tagUsage, runningCount, lastStopTime, viewDate, initialMode, initialLogPastRange, onClose, onStart, onSaveCompleted, onSavePlan, onCategoryCreated }: AddEntrySheetProps) {
  const { reduceMotion, colors: tc, allowParallelTimers } = useSettings()
  const [mode, setMode] = useState<'timer' | 'past' | 'plan'>('timer')
  const [planRecurrence, setPlanRecurrence] = useState('none')
  const [title, setTitle] = useState('')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(new Date())
  const [startHour, setStartHour] = useState('')
  const [startMin, setStartMin] = useState('')
  const [startPeriod, setStartPeriod] = useState<'AM' | 'PM'>('AM')
  const [useCustomStart, setUseCustomStart] = useState(false)
  const [endHour, setEndHour] = useState('')
  const [endMin, setEndMin] = useState('')
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('PM')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [parallel, setParallel] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Capture-first: everything except the title (and time, when it matters)
  // lives behind one More-options disclosure.
  const [showMore, setShowMore] = useState(false)
  // Category is inferred from the title unless the user picks one explicitly.
  const [catIsAuto, setCatIsAuto] = useState(true)
  const [localNewCats, setLocalNewCats] = useState<Category[]>([])
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState<string>(CATEGORY_PALETTE[0])
  const [creatingCat, setCreatingCat] = useState(false)
  const [categoryUsage, setCategoryUsage] = useState<Map<string, number>>(new Map())
  const [titleIsAuto, setTitleIsAuto] = useState(true)
  const [notes, setNotes] = useState('')
  // Optional task link: doing/finishing this entry (or planning the block)
  // carries todo_id — stopping a linked timer auto-completes the task.
  const [openTodos, setOpenTodos] = useState<Todo[]>([])
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null)

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    const merged: Category[] = []
    for (const cat of [...categories, ...localNewCats]) {
      if (seen.has(cat.id)) continue
      seen.add(cat.id)
      merged.push(cat)
    }
    return merged.sort((a, b) => (categoryUsage.get(b.id) ?? 0) - (categoryUsage.get(a.id) ?? 0))
  }, [categories, localNewCats, categoryUsage])
  const tagSuggestions = useMemo(() => getTagSuggestions({
    categoryId: selectedCat,
    savedTags,
    tagUsage,
    selectedTags: tags,
    query: tagInput,
  }), [savedTags, selectedCat, tagInput, tags, tagUsage])

  function syncStartFields(date: Date, custom: boolean) {
    const start12 = to12(date.getHours())
    setStartDate(date)
    setStartHour(start12.h)
    setStartMin(String(date.getMinutes()).padStart(2, '0'))
    setStartPeriod(start12.period)
    setUseCustomStart(custom)
  }

  function syncEndFields(date: Date) {
    const end12 = to12(date.getHours())
    setEndHour(end12.h)
    setEndMin(String(date.getMinutes()).padStart(2, '0'))
    setEndPeriod(end12.period)
  }

  // Fires only when the sheet opens — initialises mode and fetches category usage.
  // Must NOT depend on categoryOptions/selectedCat so that the async usage fetch
  // resolving (which re-sorts categoryOptions) cannot reset the mode mid-session.
  useEffect(() => {
    if (!visible) return
    setTitleIsAuto(true)
    setSelectedTodoId(null)
    setShowMore(false)
    setCatIsAuto(true)
    timeEntriesService.getCategoryUsageNearHour(new Date().getHours(), new Date().getDay())
      .then(usage => setCategoryUsage(new Map(usage.map(u => [u.category_id, u.count]))))
      .catch(() => {})
    todosService.getOpenTodos().then(setOpenTodos).catch(() => {})
    if (initialLogPastRange) {
      syncStartFields(new Date(initialLogPastRange.startTime), true)
      syncEndFields(new Date(initialLogPastRange.endTime))
      setMode('past')
    } else if (initialMode === 'plan') {
      const occupiedHours = new Set<number>()
      for (const b of blocks) {
        const bs = new Date(b.start_time).getHours()
        const be = new Date(b.end_time).getHours()
        for (let h = bs; h < be; h++) occupiedHours.add(h)
      }
      const nowDate = new Date()
      let nextHour = nowDate.getHours() + 1
      while (occupiedHours.has(nextHour) && nextHour < 24) nextHour++
      if (nextHour >= 24) nextHour = 9
      const start12 = to12(nextHour)
      const end12 = to12(Math.min(nextHour + 1, 23))
      setStartHour(start12.h)
      setStartMin('00')
      setStartPeriod(start12.period)
      setEndHour(end12.h)
      setEndMin('00')
      setEndPeriod(end12.period)
      setMode('plan')
    } else if (viewDate !== toLocalDateStr(new Date())) {
      // Viewing a past day — a live timer makes no sense there; the intent is
      // almost always to log something that already happened.
      const noon = new Date(`${viewDate}T12:00:00`)
      syncStartFields(noon, true)
      syncEndFields(new Date(noon.getTime() + 60 * 60 * 1000))
      setMode('past')
    } else {
      syncStartFields(new Date(), false)
      setMode('timer')
    }
    setNotes('')
    setSubmitting(false)
    setError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialLogPastRange, initialMode, blocks, viewDate])

  // Separate effect: set a default category once options are available.
  // Kept apart so category-usage re-sorting never re-triggers mode init above.
  useEffect(() => {
    if (!visible) return
    if (categoryOptions.length > 0 && !selectedCat) setSelectedCat(categoryOptions[0].id)
  }, [visible, categoryOptions, selectedCat])

  useEffect(() => {
    setLocalNewCats(prev => prev.filter(cat => !categories.some(existing => existing.id === cat.id)))
  }, [categories])

  function setLastStopAsStart() {
    if (!lastStopTime) return
    syncStartFields(new Date(lastStopTime), true)
  }

  function switchToLogPast() {
    setError(null)
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    syncStartFields(oneHourAgo, true)
    syncEndFields(now)
    setMode('past')
  }

  function switchToStartTimer() {
    setError(null)
    syncStartFields(new Date(), false)
    setMode('timer')
  }

  function switchToPlan() {
    setError(null)
    const occupiedHours = new Set<number>()
    for (const b of blocks) {
      const bs = new Date(b.start_time).getHours()
      const be = new Date(b.end_time).getHours()
      for (let h = bs; h < be; h++) occupiedHours.add(h)
    }
    const now = new Date()
    let nextHour = now.getHours() + 1
    while (occupiedHours.has(nextHour) && nextHour < 24) nextHour++
    if (nextHour >= 24) nextHour = 9
    const start12 = to12(nextHour)
    const end12 = to12(Math.min(nextHour + 1, 23))
    setStartHour(start12.h)
    setStartMin('00')
    setStartPeriod(start12.period)
    setEndHour(end12.h)
    setEndMin('00')
    setEndPeriod(end12.period)
    setMode('plan')
  }

  async function handleCreateCat() {
    const name = newCatName.trim()
    if (!name || creatingCat) return
    setCreatingCat(true)
    try {
      const sortOrder = categoryOptions.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1
      const cat = await categoriesService.createCategory({ name, color: newCatColor, sort_order: sortOrder, kind: categoriesService.inferCategoryKind(name) })
      setLocalNewCats(prev => prev.some(existing => existing.id === cat.id) ? prev : [...prev, cat])
      setSelectedCat(cat.id)
      setCatIsAuto(false)
      setShowNewCat(false)
      setNewCatName('')
      setNewCatColor(CATEGORY_PALETTE[0])
      await onCategoryCreated(cat)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create category'
      fail(msg)
    } finally {
      setCreatingCat(false)
    }
  }

  function toggleTodo(t: Todo) {
    if (selectedTodoId === t.id) {
      // Deselect → clear the borrowed task title.
      setSelectedTodoId(null)
      setTitle('')
      setTitleIsAuto(true)
      return
    }
    setSelectedTodoId(t.id)
    if (t.category_id) { setSelectedCat(t.category_id); setCatIsAuto(false) }
    setTitle(t.title)
    setTitleIsAuto(false)
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  function addSuggestedTag(tag: string) {
    if (!tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  // Show validation/save failures inline in the sheet — the keyboard stays up so
  // the user can fix the field immediately. (Native Alerts over this Modal could
  // leave the screen dimmed and frozen; the inline banner avoids that entirely.)
  function fail(msg: string) {
    setError(msg)
  }

  async function handleStart() {
    if (submitting) return
    setError(null)

    // Title-first: when the user hasn't explicitly picked a category, infer it
    // from a category name mentioned in the title; else fall back to the
    // most-used category for this hour (categoryOptions is usage-sorted).
    const titleLower = ` ${title.trim().toLowerCase()} `
    const inferredCat = catIsAuto && title.trim()
      ? categoryOptions.find(c => titleLower.includes(` ${c.name.toLowerCase()} `))?.id ?? null
      : null
    const effectiveCat = inferredCat ?? selectedCat ?? categoryOptions[0]?.id ?? null
    if (!effectiveCat) { onClose(); return }

    const allTags = uniqueTags([...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])])
    const derivedTitle = (() => {
      const cat = categoryOptions.find(c => c.id === effectiveCat)
      const parts: string[] = []
      if (cat) parts.push(cat.name)
      parts.push(...allTags)
      return parts.join(' · ')
    })()
    const effectiveTitle = title.trim() || derivedTitle || 'Untitled'

    if (mode === 'plan') {
      const sh = parseInt(startHour, 10)
      const sm = parseInt(startMin, 10)
      const eh = parseInt(endHour, 10)
      const em = parseInt(endMin, 10)
      if (!Number.isFinite(sh) || sh < 1 || sh > 12 || !Number.isFinite(sm) || sm < 0 || sm > 59) {
        fail('Enter a valid start time')
        return
      }
      if (!Number.isFinite(eh) || eh < 1 || eh > 12 || !Number.isFinite(em) || em < 0 || em > 59) {
        fail('Enter a valid end time')
        return
      }
      // End at/before start rolls into the next day (cross-midnight block).
      const { start, end } = resolveLocalRange(viewDate, to24(sh, startPeriod), sm, to24(eh, endPeriod), em)
      setSubmitting(true)
      Keyboard.dismiss()
      try {
        await tagsService.ensureTagsForCategory(effectiveCat, allTags)
        await calendarBlocksService.createBlock({
          category_id: effectiveCat,
          title: effectiveTitle,
          date: viewDate,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          recurrence: planRecurrence as 'none' | 'daily' | 'weekdays' | 'mwf' | 'weekly' | 'custom',
          tags: allTags,
          notes: notes.trim() || null,
          todo_id: selectedTodoId,
        })
        setTitle('')
        setTitleIsAuto(true)
        setTags([])
        setTagInput('')
        setNotes('')
        setPlanRecurrence('none')
        setSelectedTodoId(null)
        await onSavePlan()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save'
        setError(msg)
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (mode === 'past') {
      const sh = parseInt(startHour, 10)
      const sm = parseInt(startMin, 10)
      if (!Number.isFinite(sh) || sh < 1 || sh > 12 || !Number.isFinite(sm) || sm < 0 || sm > 59) {
        fail('Enter a valid start time')
        return
      }
      const eh = parseInt(endHour, 10)
      const em = parseInt(endMin, 10)
      if (!Number.isFinite(eh) || eh < 1 || eh > 12 || !Number.isFinite(em) || em < 0 || em > 59) {
        fail('Enter a valid end time')
        return
      }
      // End at/before start rolls into the next day (cross-midnight entry).
      const { start, end } = resolveLocalRange(viewDate, to24(sh, startPeriod), sm, to24(eh, endPeriod), em)
      if (end.getTime() > Date.now() + 30_000) {
        fail('End time cannot be in the future')
        return
      }
      setSubmitting(true)
      Keyboard.dismiss()
      try {
        await tagsService.ensureTagsForCategory(effectiveCat, allTags)
        await onSaveCompleted(effectiveCat, effectiveTitle, allTags, start.toISOString(), end.toISOString(), notes.trim() || null, selectedTodoId)
        setTitle('')
        setTitleIsAuto(true)
        setTags([])
        setTagInput('')
        setNotes('')
        setSelectedTodoId(null)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to save'
        setError(msg)
      } finally {
        setSubmitting(false)
      }
      return
    }

    let startTime: string | undefined
    if (useCustomStart) {
      const h = parseInt(startHour, 10)
      const m = parseInt(startMin, 10)
      if (!Number.isFinite(h) || h < 1 || h > 12 || !Number.isFinite(m) || m < 0 || m > 59) {
        fail('Enter a valid start time')
        return
      }
      const start = new Date(startDate)
      start.setHours(to24(h, startPeriod), m, 0, 0)
      if (start.getTime() > Date.now() + 30_000) {
        fail('Start time cannot be in the future')
        return
      }
      startTime = start.toISOString()
    }
    setSubmitting(true)
    Keyboard.dismiss()
    try {
      await tagsService.ensureTagsForCategory(effectiveCat, allTags)
      // Hard cap: never attempt a parallel start when 2 are already running
      // (the DB trigger would reject it). A normal start stops both instead.
      // Parallel starts are also disabled entirely unless the setting is on.
      const wantParallel = allowParallelTimers && runningCount < 2 && parallel
      await onStart(effectiveCat, effectiveTitle, allTags, wantParallel, startTime, notes.trim() || null, selectedTodoId)
      setTitle('')
      setTitleIsAuto(true)
      setTags([])
      setTagInput('')
      setNotes('')
      setParallel(false)
      setUseCustomStart(false)
      setSelectedTodoId(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start timer'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SheetShell
      visible={visible}
      reduceMotion={reduceMotion}
      onBackdropPress={onClose}
      onPullDown={title.trim() ? handleStart : onClose}
      surfaceColor={tc.surface2}
      borderColor={tc.border}
      errorMessage={error}
      onDismissError={() => setError(null)}
      footer={
        <>
          <Pressable style={sheetStyles.ghostBtn} onPress={onClose} disabled={submitting}>
            <Text style={[sheetStyles.ghostText, { color: tc.text2 }]}>Discard</Text>
          </Pressable>
          <Pressable
            style={[sheetStyles.primaryBtn, { backgroundColor: tc.text1, opacity: submitting ? 0.55 : 1 }]}
            onPressIn={Keyboard.dismiss}
            onPress={handleStart}
            disabled={submitting}
          >
            <Text style={[sheetStyles.primaryText, { color: tc.bg }]}>
              {submitting ? 'Saving' : mode === 'past' ? 'Save entry' : mode === 'plan' ? 'Save plan' : 'Start timer'}
            </Text>
          </Pressable>
        </>
      }
    >

            <Text style={[sheetStyles.eyebrow, { marginBottom: 10, color: tc.text3 }]}>
              {mode === 'timer' ? 'Start now' : mode === 'past' ? 'Log past time' : 'Plan a block'}
            </Text>
            <TextInput
              style={[sheetStyles.input, { color: tc.text1, borderBottomColor: tc.border2, fontSize: 18, paddingBottom: 10, marginBottom: 4 }]}
              placeholder={mode === 'timer' ? 'What are you doing?' : mode === 'past' ? 'What did you do?' : 'What are you planning?'}
              placeholderTextColor={tc.text4}
              value={title}
              onChangeText={text => { setTitle(text); setTitleIsAuto(text === '') }}
            />

            {mode !== 'timer' && (
              <>
                <Text style={[sheetStyles.eyebrow, { marginTop: 18, marginBottom: 6, color: tc.text3 }]}>Time</Text>
                {mode === 'past' ? (
                  <View style={styles.timerStartRow}>
                    <TimePicker
                      label="Start"
                      hour={startHour} minute={startMin} period={startPeriod}
                      onHourChange={(v) => { setStartHour(v); setUseCustomStart(true) }}
                      onMinuteChange={(v) => { setStartMin(v); setUseCustomStart(true) }}
                      onPeriodToggle={() => { setStartPeriod(p => p === 'AM' ? 'PM' : 'AM'); setUseCustomStart(true) }}
                      style={styles.timerStartTime}
                    />
                    <TimePicker
                      label="End"
                      hour={endHour} minute={endMin} period={endPeriod}
                      onHourChange={setEndHour}
                      onMinuteChange={setEndMin}
                      onPeriodToggle={() => setEndPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                      style={styles.timerStartTime}
                    />
                  </View>
                ) : (
                  <View style={styles.timerStartRow}>
                    <TimePicker
                      label="Start"
                      hour={startHour} minute={startMin} period={startPeriod}
                      onHourChange={setStartHour}
                      onMinuteChange={setStartMin}
                      onPeriodToggle={() => setStartPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                      style={styles.timerStartTime}
                    />
                    <TimePicker
                      label="End"
                      hour={endHour} minute={endMin} period={endPeriod}
                      onHourChange={setEndHour}
                      onMinuteChange={setEndMin}
                      onPeriodToggle={() => setEndPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                      style={styles.timerStartTime}
                    />
                  </View>
                )}
              </>
            )}

            {mode === 'plan' && (
              <>
                <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>Repeat</Text>
                <View style={sheetStyles.chips}>
                  {([
                    { key: 'none', label: 'Once' },
                    { key: 'daily', label: 'Daily' },
                    { key: 'weekdays', label: 'Weekdays' },
                    { key: 'mwf', label: 'M W F' },
                    { key: 'weekly', label: 'Weekly' },
                  ] as const).map(opt => (
                    <Pressable
                      key={opt.key}
                      style={[styles.freqPill, { borderColor: tc.border2 }, planRecurrence === opt.key && [styles.freqActive, { backgroundColor: tc.text1 }]]}
                      onPress={() => setPlanRecurrence(opt.key)}
                    >
                      <Text style={[styles.freqText, { color: tc.text3 }, planRecurrence === opt.key && { color: tc.bg }]}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable
              onPress={() => { setError(null); setShowMore(v => !v) }}
              style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              hitSlop={8}
            >
              <Text style={[sheetStyles.eyebrow, { marginBottom: 0, color: tc.text3 }]}>More options</Text>
              <Text style={{ color: tc.text4, fontSize: 9 }}>{showMore ? '▲' : '▼'}</Text>
            </Pressable>

            {showMore && (<>
            {openTodos.length > 0 && (
              <>
                <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>Task (optional)</Text>
                <View style={sheetStyles.chips}>
                  {openTodos.slice(0, 8).map(t => {
                    const sel = selectedTodoId === t.id
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => toggleTodo(t)}
                        style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: sel ? tc.text1 : tc.border2, backgroundColor: sel ? tc.text1 : 'transparent' }}
                      >
                        <Text style={{ color: sel ? tc.bg : tc.text2, fontSize: 12, fontFamily: fonts.ui, maxWidth: 150 }} numberOfLines={1}>
                          {t.title}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                {selectedTodoId && (
                  <Text style={{ color: tc.text4, fontSize: 11.5, fontFamily: fonts.ui, marginTop: 8 }}>
                    {mode === 'plan' ? 'Block linked to this task.' : 'Finishing this entry marks the task done.'}
                  </Text>
                )}
              </>
            )}

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>Category</Text>
            <View style={sheetStyles.chips}>
              {categoryOptions.map(cat => (
                <CategoryChip
                  key={cat.id}
                  name={cat.name}
                  color={cat.color}
                  selected={selectedCat === cat.id}
                  onPress={() => { setSelectedCat(cat.id); setCatIsAuto(false); setShowNewCat(false) }}
                />
              ))}
              <Pressable
                onPress={() => setShowNewCat(v => !v)}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: showNewCat ? tc.text1 : tc.border2 }}
              >
                <Text style={{ color: showNewCat ? tc.text1 : tc.text3, fontSize: 12, fontFamily: fonts.ui }}>+ New</Text>
              </Pressable>
            </View>

            {showNewCat && (
              <View style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: tc.surface3 }}>
                <TextInput
                  style={{ color: tc.text1, fontSize: 14, fontFamily: fonts.ui, borderBottomWidth: 1, borderBottomColor: tc.border2, paddingBottom: 6, marginBottom: 10 }}
                  placeholder="Category name"
                  placeholderTextColor={tc.text4}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {CATEGORY_PALETTE.map(color => (
                    <Pressable
                      key={color}
                      onPress={() => setNewCatColor(color)}
                      style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color, borderWidth: newCatColor === color ? 2 : 0, borderColor: tc.text1 }}
                    />
                  ))}
                </View>
                <Pressable
                  onPress={handleCreateCat}
                  disabled={creatingCat}
                  style={{ alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: tc.text1, opacity: creatingCat ? 0.55 : 1 }}
                >
                  <Text style={{ color: tc.bg, fontSize: 13, fontFamily: fonts.ui }}>{creatingCat ? 'Creating' : 'Create'}</Text>
                </Pressable>
              </View>
            )}

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>Tags</Text>
            {tagSuggestions.length > 0 && (
              <View style={editStyles.suggestionRow}>
                {tagSuggestions.map(suggestion => (
                  <Pressable
                    key={suggestion.name}
                    onPress={() => addSuggestedTag(suggestion.name)}
                    style={[editStyles.suggestionChip, { borderColor: tc.border2, backgroundColor: tc.surface3 }]}
                  >
                    <Text style={[editStyles.suggestionText, { color: tc.text2 }]} numberOfLines={1}>
                      {suggestion.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={[editStyles.tagsRow, { borderBottomColor: tc.border2 }]}>
              {tags.map((t, i) => (
                <Pressable key={i} onPress={() => setTags(tags.filter((_, j) => j !== i))}>
                  <Text style={[editStyles.tag, { color: tc.text1 }]}>{t}</Text>
                </Pressable>
              ))}
              <TextInput
                style={[editStyles.tagInput, { color: tc.text2 }]}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="+ add tag"
                placeholderTextColor={tc.text4}
                onSubmitEditing={addTag}
                blurOnSubmit={false}
              />
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>Notes</Text>
            <TextInput
              style={[sheetStyles.notesInput, { color: tc.text1, borderBottomColor: tc.border2 }]}
              placeholder="Notes (optional)"
              placeholderTextColor={tc.text4}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {mode === 'timer' && (
              <>
                <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>Start time</Text>
                <View style={styles.timerStartRow}>
                  <TimePicker
                    label="Start"
                    hour={startHour} minute={startMin} period={startPeriod}
                    onHourChange={(v) => { setStartHour(v); setUseCustomStart(true) }}
                    onMinuteChange={(v) => { setStartMin(v); setUseCustomStart(true) }}
                    onPeriodToggle={() => { setStartPeriod(p => p === 'AM' ? 'PM' : 'AM'); setUseCustomStart(true) }}
                    style={styles.timerStartTime}
                  />
                  {lastStopTime && (
                    <Pressable style={[styles.lastStopBtn, { borderColor: tc.border2 }]} onPress={setLastStopAsStart}>
                      <Text style={[styles.lastStopText, { color: tc.text2 }]}>Set to last stop time</Text>
                      <Text style={[styles.lastStopTime, { color: tc.text3 }]}>{formatSheetTime(lastStopTime)}</Text>
                    </Pressable>
                  )}
                </View>
                {allowParallelTimers && (runningCount >= 2 ? (
                  <Text style={{ color: tc.text4, fontSize: 12.5, fontFamily: fonts.ui, marginTop: 16, lineHeight: 18 }}>
                    Max 2 parallel timers running — starting a new one will stop both.
                  </Text>
                ) : (
                  <Pressable
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 }}
                    onPress={() => setParallel(p => !p)}
                  >
                    <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: parallel ? tc.text1 : tc.text4, backgroundColor: parallel ? tc.text1 : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {parallel && <Text style={{ color: tc.bg, fontSize: 12, fontWeight: '700' }}>✓</Text>}
                    </View>
                    <Text style={{ color: tc.text2, fontSize: 13, fontFamily: fonts.ui }}>Run alongside current timer</Text>
                  </Pressable>
                ))}
              </>
            )}
            </>)}

            <View style={{ flexDirection: 'row', gap: 18, marginTop: 26 }}>
              {mode !== 'timer' && (
                <Pressable onPress={switchToStartTimer} hitSlop={8}>
                  <Text style={{ color: tc.text4, fontSize: 12, fontFamily: fonts.ui }}>Start a timer instead</Text>
                </Pressable>
              )}
              {mode !== 'past' && (
                <Pressable onPress={switchToLogPast} hitSlop={8}>
                  <Text style={{ color: tc.text4, fontSize: 12, fontFamily: fonts.ui }}>Log past time instead</Text>
                </Pressable>
              )}
              {mode !== 'plan' && (
                <Pressable onPress={switchToPlan} hitSlop={8}>
                  <Text style={{ color: tc.text4, fontSize: 12, fontFamily: fonts.ui }}>Plan a block instead</Text>
                </Pressable>
              )}
            </View>
    </SheetShell>
  )
}

// ─── Add Plan Sheet ──────────────────────────────────────
interface AddPlanSheetProps {
  visible: boolean
  categories: Category[]
  date: string
  blocks: CalendarBlock[]
  onClose: () => void
  onSave: () => void
}

function to12(h24: number): { h: string; period: 'AM' | 'PM' } {
  const period = h24 < 12 ? 'AM' as const : 'PM' as const
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24
  return { h: String(h12), period }
}

function to24(h12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return h12 === 12 ? 0 : h12
  return h12 === 12 ? 12 : h12 + 12
}

function formatSheetTime(time: string): string {
  const d = new Date(time)
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function AddPlanSheet({ visible, categories, date, blocks, onClose, onSave }: AddPlanSheetProps) {
  const { reduceMotion, colors: tc } = useSettings()
  const [title, setTitle] = useState('')
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [startHour, setStartHour] = useState('9')
  const [startMin, setStartMin] = useState('00')
  const [startPeriod, setStartPeriod] = useState<'AM' | 'PM'>('AM')
  const [endHour, setEndHour] = useState('10')
  const [endMin, setEndMin] = useState('00')
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('AM')
  const [recurrence, setRecurrence] = useState<string>('none')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (!visible) return
    if (categories.length > 0 && !selectedCat) setSelectedCat(categories[0].id)

    const occupiedHours = new Set<number>()
    for (const b of blocks) {
      const bs = new Date(b.start_time).getHours()
      const be = new Date(b.end_time).getHours()
      for (let h = bs; h < be; h++) occupiedHours.add(h)
    }

    const now = new Date()
    let nextHour = now.getHours() + 1
    while (occupiedHours.has(nextHour) && nextHour < 24) nextHour++
    if (nextHour >= 24) nextHour = 9

    const start12 = to12(nextHour)
    const end12 = to12(Math.min(nextHour + 1, 23))
    setStartHour(start12.h)
    setStartMin('00')
    setStartPeriod(start12.period)
    setEndHour(end12.h)
    setEndMin('00')
    setEndPeriod(end12.period)
  }, [visible, categories, blocks])

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  async function handleSave() {
    if (!selectedCat || !title.trim()) {
      Alert.alert('Required', 'Enter a name and select a category')
      return
    }
    const sh = to24(parseInt(startHour, 10), startPeriod)
    const sm = parseInt(startMin, 10)
    const eh = to24(parseInt(endHour, 10), endPeriod)
    const em = parseInt(endMin, 10)

    // End at/before start rolls into the next day (cross-midnight block).
    const { start: startDate, end: endDate } = resolveLocalRange(date, sh, sm, eh, em)
    const startTime = startDate.toISOString()
    const endTime = endDate.toISOString()
    const allTags = [...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])]

    try {
      await calendarBlocksService.createBlock({
        category_id: selectedCat,
        title: title.trim(),
        date,
        start_time: startTime,
        end_time: endTime,
        recurrence: recurrence as 'none' | 'daily' | 'weekdays' | 'mwf' | 'weekly' | 'custom',
        tags: allTags,
      })
      setTitle('')
      setTags([])
      setTagInput('')
      onSave()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      Alert.alert('Error', msg)
    }
  }

  const recurrenceOptions = [
    { key: 'none', label: 'Once' },
    { key: 'daily', label: 'Daily' },
    { key: 'weekdays', label: 'Weekdays' },
    { key: 'mwf', label: 'M W F' },
    { key: 'weekly', label: 'Weekly' },
  ]

  return (
    <SheetShell
      visible={visible}
      reduceMotion={reduceMotion}
      onBackdropPress={onClose}
      onPullDown={handleSave}
      surfaceColor={tc.surface2}
      borderColor={tc.border}
      footer={
        <>
          <Pressable style={sheetStyles.ghostBtn} onPress={onClose}>
            <Text style={[sheetStyles.ghostText, { color: tc.text2 }]}>Cancel</Text>
          </Pressable>
          <Pressable style={[sheetStyles.primaryBtn, { backgroundColor: tc.text1 }]} onPress={handleSave}>
            <Text style={[sheetStyles.primaryText, { color: tc.bg }]}>Save plan</Text>
          </Pressable>
        </>
      }
    >

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={[sheetStyles.eyebrow, { color: tc.text3 }]}>New plan</Text>
              <Text style={{ color: tc.text3, fontSize: 11.5, fontFamily: fonts.ui }}>No timer</Text>
            </View>

            <TextInput
              style={[sheetStyles.input, { color: tc.text1, borderBottomColor: tc.border2 }]}
              placeholder="What are you planning?"
              placeholderTextColor={tc.text4}
              value={title}
              onChangeText={setTitle}
              autoFocus
            />

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>01 — Time</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TimePicker
                label="Start"
                hour={startHour} minute={startMin} period={startPeriod}
                onHourChange={setStartHour}
                onMinuteChange={setStartMin}
                onPeriodToggle={() => setStartPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                style={{ flex: 1 }}
              />
              <TimePicker
                label="End"
                hour={endHour} minute={endMin} period={endPeriod}
                onHourChange={setEndHour}
                onMinuteChange={setEndMin}
                onPeriodToggle={() => setEndPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                style={{ flex: 1 }}
              />
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>02 — Category</Text>
            <View style={sheetStyles.chips}>
              {categories.map(cat => (
                <CategoryChip key={cat.id} name={cat.name} color={cat.color} selected={selectedCat === cat.id} onPress={() => setSelectedCat(cat.id)} />
              ))}
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>03 — Repeat</Text>
            <View style={sheetStyles.chips}>
              {recurrenceOptions.map(opt => (
                <Pressable key={opt.key} style={[styles.freqPill, { borderColor: tc.border2 }, recurrence === opt.key && [styles.freqActive, { backgroundColor: tc.text1 }]]} onPress={() => setRecurrence(opt.key)}>
                  <Text style={[styles.freqText, { color: tc.text3 }, recurrence === opt.key && { color: tc.bg }]}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>04 — Tags</Text>
            <View style={[editStyles.tagsRow, { borderBottomColor: tc.border2 }]}>
              {tags.map((t, i) => (
                <Pressable key={i} onPress={() => setTags(tags.filter((_, j) => j !== i))}>
                  <Text style={[editStyles.tag, { color: tc.text1 }]}>{t}</Text>
                </Pressable>
              ))}
              <TextInput
                style={[editStyles.tagInput, { color: tc.text2 }]}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="+ add tag"
                placeholderTextColor={tc.text4}
                onSubmitEditing={addTag}
                blurOnSubmit={false}
              />
            </View>

    </SheetShell>
  )
}

// ─── Edit Block Sheet ────────────────────────────────────
interface EditBlockSheetProps {
  block: CalendarBlock | null
  categories: Category[]
  savedTags: Tag[]
  tagUsage: TagUsage[]
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}

function EditBlockSheet({ block, categories, savedTags, tagUsage, onClose, onSave, onDelete }: EditBlockSheetProps) {
  const { reduceMotion, colors: tc } = useSettings()
  const [title, setTitle] = useState('')
  const [titleIsAuto, setTitleIsAuto] = useState(false)
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [categoryUsage, setCategoryUsage] = useState<Map<string, number>>(new Map())
  const [startHour, setStartHour] = useState('')
  const [startMin, setStartMin] = useState('')
  const [startPeriod, setStartPeriod] = useState<'AM' | 'PM'>('AM')
  const [endHour, setEndHour] = useState('')
  const [endMin, setEndMin] = useState('')
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('AM')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const origRef = useRef({
    title: '',
    cat: '' as string | null,
    sh: '',
    sm: '',
    sp: 'AM' as 'AM' | 'PM',
    eh: '',
    em: '',
    ep: 'AM' as 'AM' | 'PM',
    tags: '',
    notes: '',
  })

  const categoryOptions = useMemo(() => {
    return [...categories].sort((a, b) => (categoryUsage.get(b.id) ?? 0) - (categoryUsage.get(a.id) ?? 0))
  }, [categories, categoryUsage])

  const tagSuggestions = useMemo(() => getTagSuggestions({
    categoryId: selectedCat,
    savedTags,
    tagUsage,
    selectedTags: tags,
    query: tagInput,
  }), [savedTags, selectedCat, tagInput, tags, tagUsage])

  useEffect(() => {
    if (!titleIsAuto) return
    const cat = categoryOptions.find(c => c.id === selectedCat)
    const parts: string[] = []
    if (cat) parts.push(cat.name)
    parts.push(...tags)
    setTitle(parts.join(' · '))
  }, [selectedCat, tags, titleIsAuto, categoryOptions])

  useEffect(() => {
    if (!block) return
    setTitleIsAuto(false)
    timeEntriesService.getCategoryUsageNearHour(new Date().getHours(), new Date().getDay())
      .then(usage => setCategoryUsage(new Map(usage.map(u => [u.category_id, u.count]))))
      .catch(() => {})
    setTitle(block.title)
    setSelectedCat(block.category_id)
    const s = new Date(block.start_time)
    const e = new Date(block.end_time)
    const start12 = to12(s.getHours())
    const end12 = to12(e.getHours())
    const sh = start12.h
    const sm = String(s.getMinutes()).padStart(2, '0')
    const eh = end12.h
    const em = String(e.getMinutes()).padStart(2, '0')
    setStartHour(sh)
    setStartMin(sm)
    setStartPeriod(start12.period)
    setEndHour(eh)
    setEndMin(em)
    setEndPeriod(end12.period)
    setTags(block.tags ?? [])
    setTagInput('')
    setNotes(block.notes ?? '')
    setError(null)
    origRef.current = {
      title: block.title,
      cat: block.category_id,
      sh,
      sm,
      sp: start12.period,
      eh,
      em,
      ep: end12.period,
      tags: JSON.stringify(block.tags ?? []),
      notes: block.notes ?? '',
    }
  }, [block])

  function isDirty(): boolean {
    const o = origRef.current
    return title !== o.title
      || selectedCat !== o.cat
      || startHour !== o.sh
      || startMin !== o.sm
      || startPeriod !== o.sp
      || endHour !== o.eh
      || endMin !== o.em
      || endPeriod !== o.ep
      || JSON.stringify(tags) !== o.tags
      || tagInput.trim() !== ''
      || notes !== o.notes
  }

  function fail(msg: string) {
    setError(msg)
  }

  function handleBackdropPress() {
    if (isDirty()) {
      Keyboard.dismiss()
      Alert.alert('Unsaved changes', 'Do you want to save your changes?', [
        { text: 'Discard', style: 'destructive', onPress: onClose },
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save', onPress: handleSave },
      ])
    } else {
      onClose()
    }
  }

  async function handleSave() {
    if (!block || !selectedCat) return
    setError(null)
    const derivedTitle = (() => {
      const cat = categories.find(c => c.id === selectedCat)
      const parts: string[] = []
      if (cat) parts.push(cat.name)
      parts.push(...tags)
      return parts.join(' · ')
    })()
    const effectiveTitle = title.trim() || derivedTitle || 'Untitled'
    const sh = parseInt(startHour, 10)
    const sm = parseInt(startMin, 10)
    const eh = parseInt(endHour, 10)
    const em = parseInt(endMin, 10)
    if (!Number.isFinite(sh) || sh < 1 || sh > 12 || !Number.isFinite(sm) || sm < 0 || sm > 59) {
      fail('Enter a valid start time')
      return
    }
    if (!Number.isFinite(eh) || eh < 1 || eh > 12 || !Number.isFinite(em) || em < 0 || em > 59) {
      fail('Enter a valid end time')
      return
    }
    // End at/before start rolls into the next day (cross-midnight block).
    const { start: startDate, end: endDate } = resolveLocalRange(block.date, to24(sh, startPeriod), sm, to24(eh, endPeriod), em)
    try {
      await calendarBlocksService.updateBlock(block.id, {
        title: effectiveTitle,
        category_id: selectedCat,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        tags: [...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])],
        notes: notes.trim() || null,
      })
      onSave()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      setError(msg)
    }
  }

  async function handleDelete() {
    if (!block) return
    Keyboard.dismiss()
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Delete this plan?')
      : await new Promise<boolean>(resolve => {
          Alert.alert('Delete plan', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
          ])
        })
    if (!confirmed) return
    try {
      await calendarBlocksService.deleteBlock(block.id)
      onDelete()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete'
      setError(msg)
    }
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  const cat = categories.find(c => c.id === selectedCat)
  const durationMin = block ? Math.round((new Date(block.end_time).getTime() - new Date(block.start_time).getTime()) / 60000) : 0

  return (
    <SheetShell
      visible={block !== null}
      reduceMotion={reduceMotion}
      onBackdropPress={handleBackdropPress}
      onPullDown={handleSave}
      surfaceColor={tc.surface2}
      borderColor={tc.border}
      errorMessage={error}
      onDismissError={() => setError(null)}
      footer={
        <>
          <Pressable style={editStyles.dangerBtn} onPress={handleDelete}>
            <Text style={editStyles.dangerText}>Delete</Text>
          </Pressable>
          <Pressable style={sheetStyles.ghostBtn} onPress={onClose}>
            <Text style={[sheetStyles.ghostText, { color: tc.text2 }]}>Cancel</Text>
          </Pressable>
          <Pressable style={[sheetStyles.primaryBtn, { marginLeft: 'auto', backgroundColor: tc.text1 }]} onPress={handleSave}>
            <Text style={[sheetStyles.primaryText, { color: tc.bg }]}>Save</Text>
          </Pressable>
        </>
      }
    >

            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={[sheetStyles.eyebrow, { color: tc.text3 }]}>Edit plan</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {cat && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cat.color }} />}
                <Text style={{ color: tc.text3, fontSize: 11.5, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] }}>
                  {cat?.name} · {durationMin}m
                </Text>
              </View>
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 0, marginBottom: 6, color: tc.text3 }]}>01 — Time</Text>
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <TimePicker
                label="Start"
                hour={startHour} minute={startMin} period={startPeriod}
                onHourChange={setStartHour}
                onMinuteChange={setStartMin}
                onPeriodToggle={() => setStartPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                style={{ flex: 1 }}
              />
              <TimePicker
                label="End"
                hour={endHour} minute={endMin} period={endPeriod}
                onHourChange={setEndHour}
                onMinuteChange={setEndMin}
                onPeriodToggle={() => setEndPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                style={{ flex: 1 }}
              />
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>02 — Category</Text>
            <View style={sheetStyles.chips}>
              {categoryOptions.map(c => (
                <CategoryChip key={c.id} name={c.name} color={c.color} selected={selectedCat === c.id} onPress={() => {
                  setSelectedCat(c.id)
                  if (!title.trim() || titleIsAuto) setTitleIsAuto(true)
                }} />
              ))}
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>03 — Tags</Text>
            {tagSuggestions.length > 0 && (
              <View style={editStyles.suggestionRow}>
                {tagSuggestions.map(suggestion => (
                  <Pressable
                    key={suggestion.name}
                    onPress={() => { if (!tags.includes(suggestion.name)) { setTags([...tags, suggestion.name]); setTagInput('') } }}
                    style={[editStyles.suggestionChip, { borderColor: tc.border2, backgroundColor: tc.surface3 }]}
                  >
                    <Text style={[editStyles.suggestionText, { color: tc.text2 }]} numberOfLines={1}>
                      {suggestion.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={[editStyles.tagsRow, { borderBottomColor: tc.border2 }]}>
              {tags.map((t, i) => (
                <Pressable key={i} onPress={() => setTags(tags.filter((_, j) => j !== i))}>
                  <Text style={[editStyles.tag, { color: tc.text1 }]}>{t}</Text>
                </Pressable>
              ))}
              <TextInput
                style={[editStyles.tagInput, { color: tc.text2 }]}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="+ add tag"
                placeholderTextColor={tc.text4}
                onSubmitEditing={addTag}
                blurOnSubmit={false}
              />
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>04 — Name</Text>
            <TextInput
              style={[sheetStyles.input, { color: tc.text1, borderBottomColor: tc.border2 }]}
              value={title}
              onChangeText={text => {
                if (text === '') {
                  const cat = categoryOptions.find(c => c.id === selectedCat)
                  const parts: string[] = []
                  if (cat) parts.push(cat.name)
                  parts.push(...tags)
                  setTitle(parts.join(' · '))
                  setTitleIsAuto(true)
                } else {
                  setTitle(text)
                  setTitleIsAuto(false)
                }
              }}
              placeholder="Auto-filled from category & tags"
              placeholderTextColor={tc.text4}
            />

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>05 — Notes</Text>
            <TextInput
              style={[sheetStyles.notesInput, { color: tc.text1, borderBottomColor: tc.border2 }]}
              placeholder="Notes (optional)"
              placeholderTextColor={tc.text4}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

    </SheetShell>
  )
}

// ─── Edit Entry Sheet ────────────────────────────────────
interface EditEntrySheetProps {
  entry: TimeEntry | null
  categories: Category[]
  savedTags: Tag[]
  tagUsage: TagUsage[]
  lastStopTime: string | null
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onCategoryCreated: (cat: Category) => void | Promise<void>
}

function EditEntrySheet({ entry, categories, savedTags, tagUsage, lastStopTime, onClose, onSave, onDelete, onCategoryCreated }: EditEntrySheetProps) {
  const { reduceMotion, colors: tc } = useSettings()
  const [title, setTitle] = useState('')
  const [titleIsAuto, setTitleIsAuto] = useState(false)
  const [selectedCat, setSelectedCat] = useState<string | null>(null)
  const [startHour, setStartHour] = useState('')
  const [startMin, setStartMin] = useState('')
  const [startPeriod, setStartPeriod] = useState<'AM' | 'PM'>('AM')
  const [endHour, setEndHour] = useState('')
  const [endMin, setEndMin] = useState('')
  const [endPeriod, setEndPeriod] = useState<'AM' | 'PM'>('AM')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [localNewCats, setLocalNewCats] = useState<Category[]>([])
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState<string>(CATEGORY_PALETTE[0])
  const [creatingCat, setCreatingCat] = useState(false)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  // After "Set end to current time" is tapped, that same button flips to "Resume
  // timer" so an accidental stop can be undone without a separate button.
  const [showResume, setShowResume] = useState(false)
  const origRef = useRef({
    title: '',
    cat: '' as string | null,
    sh: '',
    sm: '',
    sp: 'AM' as 'AM' | 'PM',
    eh: '',
    em: '',
    ep: 'AM' as 'AM' | 'PM',
    tags: '',
    notes: '',
  })

  const [categoryUsage, setCategoryUsage] = useState<Map<string, number>>(new Map())

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    const merged: Category[] = []
    for (const cat of [...categories, ...localNewCats]) {
      if (seen.has(cat.id)) continue
      seen.add(cat.id)
      merged.push(cat)
    }
    return merged.sort((a, b) => (categoryUsage.get(b.id) ?? 0) - (categoryUsage.get(a.id) ?? 0))
  }, [categories, localNewCats, categoryUsage])
  const tagSuggestions = useMemo(() => getTagSuggestions({
    categoryId: selectedCat,
    savedTags,
    tagUsage,
    selectedTags: tags,
    query: tagInput,
  }), [savedTags, selectedCat, tagInput, tags, tagUsage])

  useEffect(() => {
    if (!titleIsAuto) return
    const cat = categoryOptions.find(c => c.id === selectedCat)
    const parts: string[] = []
    if (cat) parts.push(cat.name)
    parts.push(...tags)
    setTitle(parts.join(' · '))
  }, [selectedCat, tags, titleIsAuto, categoryOptions])

  useEffect(() => {
    if (!entry) return
    setTitleIsAuto(false)
    timeEntriesService.getCategoryUsageNearHour(new Date().getHours(), new Date().getDay())
      .then(usage => setCategoryUsage(new Map(usage.map(u => [u.category_id, u.count]))))
      .catch(() => {})
    setTitle(entry.title)
    setSelectedCat(entry.category_id)
    const s = new Date(entry.start_time)
    const start12 = to12(s.getHours())
    const sh = start12.h
    const sm = String(s.getMinutes()).padStart(2, '0')
    setStartHour(sh)
    setStartMin(sm)
    setStartPeriod(start12.period)
    let eh = ''
    let em = ''
    let ep: 'AM' | 'PM' = start12.period
    if (entry.end_time) {
      const e = new Date(entry.end_time)
      const end12 = to12(e.getHours())
      eh = end12.h
      em = String(e.getMinutes()).padStart(2, '0')
      ep = end12.period
    }
    setEndHour(eh)
    setEndMin(em)
    setEndPeriod(ep)
    setTags(entry.tags ?? [])
    setTagInput('')
    setNotes(entry.notes ?? '')
    setError(null)
    setShowResume(false)
    origRef.current = {
      title: entry.title,
      cat: entry.category_id,
      sh,
      sm,
      sp: start12.period,
      eh,
      em,
      ep,
      tags: JSON.stringify(entry.tags ?? []),
      notes: entry.notes ?? '',
    }
  }, [entry])

  useEffect(() => {
    setLocalNewCats(prev => prev.filter(cat => !categories.some(existing => existing.id === cat.id)))
  }, [categories])

  function isDirty(): boolean {
    const o = origRef.current
    return title !== o.title
      || selectedCat !== o.cat
      || startHour !== o.sh
      || startMin !== o.sm
      || startPeriod !== o.sp
      || endHour !== o.eh
      || endMin !== o.em
      || endPeriod !== o.ep
      || JSON.stringify(tags) !== o.tags
      || tagInput.trim() !== ''
      || newCatName.trim() !== ''
      || notes !== o.notes
  }

  function setLastStopAsStart() {
    if (!lastStopTime) return
    const lastStop = new Date(lastStopTime)
    const start12 = to12(lastStop.getHours())
    setStartHour(start12.h)
    setStartMin(String(lastStop.getMinutes()).padStart(2, '0'))
    setStartPeriod(start12.period)
  }

  async function handleCreateCat() {
    const name = newCatName.trim()
    if (!name || creatingCat) return
    setCreatingCat(true)
    try {
      const sortOrder = categoryOptions.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1
      const cat = await categoriesService.createCategory({ name, color: newCatColor, sort_order: sortOrder, kind: categoriesService.inferCategoryKind(name) })
      setLocalNewCats(prev => prev.some(existing => existing.id === cat.id) ? prev : [...prev, cat])
      setSelectedCat(cat.id)
      setShowNewCat(false)
      setNewCatName('')
      setNewCatColor(CATEGORY_PALETTE[0])
      await onCategoryCreated(cat)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create category'
      fail(msg)
    } finally {
      setCreatingCat(false)
    }
  }

  function fail(msg: string) {
    setError(msg)
  }

  function handleBackdropPress() {
    if (isDirty()) {
      Keyboard.dismiss()
      Alert.alert('Unsaved changes', 'Do you want to save your changes?', [
        { text: 'Discard', style: 'destructive', onPress: onClose },
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save', onPress: handleSave },
      ])
    } else {
      onClose()
    }
  }

  async function handleSave() {
    if (!entry || !selectedCat) return
    setError(null)
    const derivedTitle = (() => {
      const cat = categories.find(c => c.id === selectedCat)
      const parts: string[] = []
      if (cat) parts.push(cat.name)
      parts.push(...tags)
      return parts.join(' · ')
    })()
    const effectiveTitle = title.trim() || derivedTitle || 'Untitled'
    const dateStr = toLocalDateStr(new Date(entry.start_time))
    const sh = parseInt(startHour, 10)
    const sm = parseInt(startMin, 10)
    if (!Number.isFinite(sh) || sh < 1 || sh > 12 || !Number.isFinite(sm) || sm < 0 || sm > 59) {
      fail('Enter a valid start time')
      return
    }
    const startDate = new Date(parseInt(dateStr.slice(0, 4)), parseInt(dateStr.slice(5, 7)) - 1, parseInt(dateStr.slice(8, 10)), to24(sh, startPeriod), sm)
    const updates: {
      title: string
      category_id: string
      start_time: string
      end_time?: string | null
      is_running?: boolean
      tags: string[]
      notes: string | null
    } = {
      title: effectiveTitle,
      category_id: selectedCat,
      start_time: startDate.toISOString(),
      tags: [...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])],
      notes: notes.trim() || null,
    }

    if (entry.is_running) {
      updates.end_time = null
    } else if (endHour.trim() || endMin.trim()) {
      const eh = parseInt(endHour, 10)
      const em = parseInt(endMin, 10)
      if (!Number.isFinite(eh) || eh < 1 || eh > 12 || !Number.isFinite(em) || em < 0 || em > 59) {
        fail('Enter a valid end time')
        return
      }
      // End at/before start rolls into the next day (cross-midnight entry).
      const { end: endDate } = resolveLocalRange(dateStr, to24(sh, startPeriod), sm, to24(eh, endPeriod), em)
      updates.end_time = endDate.toISOString()
    } else {
      fail('Enter a valid end time')
      return
    }

    try {
      await tagsService.ensureTagsForCategory(selectedCat, updates.tags)
      await timeEntriesService.updateEntry(entry.id, updates)
      emitTimerChange()
      onSave()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save'
      setError(msg)
    }
  }

  // Re-open a stopped entry: apply any field edits, clear the end, and mark it
  // running again. Undoes an accidental stop. Fails (inline) if the DB's 2-timer
  // limit is hit.
  async function handleResume() {
    if (!entry || !selectedCat) return
    setError(null)
    const derivedTitle = (() => {
      const cat = categories.find(c => c.id === selectedCat)
      const parts: string[] = []
      if (cat) parts.push(cat.name)
      parts.push(...tags)
      return parts.join(' · ')
    })()
    const effectiveTitle = title.trim() || derivedTitle || 'Untitled'
    const dateStr = toLocalDateStr(new Date(entry.start_time))
    const sh = parseInt(startHour, 10)
    const sm = parseInt(startMin, 10)
    if (!Number.isFinite(sh) || sh < 1 || sh > 12 || !Number.isFinite(sm) || sm < 0 || sm > 59) {
      fail('Enter a valid start time')
      return
    }
    const startDate = new Date(parseInt(dateStr.slice(0, 4)), parseInt(dateStr.slice(5, 7)) - 1, parseInt(dateStr.slice(8, 10)), to24(sh, startPeriod), sm)
    const allTags = [...tags, ...(tagInput.trim() ? [tagInput.trim()] : [])]
    try {
      await tagsService.ensureTagsForCategory(selectedCat, allTags)
      await timeEntriesService.updateEntry(entry.id, {
        title: effectiveTitle,
        category_id: selectedCat,
        start_time: startDate.toISOString(),
        end_time: null,
        is_running: true,
        tags: allTags,
        notes: notes.trim() || null,
      })
      emitTimerChange()
      onSave()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resume'
      setError(msg)
    }
  }

  async function handleDelete() {
    if (!entry) return
    Keyboard.dismiss()
    const confirmed = Platform.OS === 'web'
      ? window.confirm('Delete this entry?')
      : await new Promise<boolean>(resolve => {
          Alert.alert('Delete entry', 'Are you sure?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
          ])
        })
    if (!confirmed) return
    try {
      await timeEntriesService.deleteEntry(entry.id)
      emitTimerChange()
      onDelete()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete'
      setError(msg)
    }
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setTagInput('')
    }
  }

  function addSuggestedTag(tag: string) {
    if (!tags.some(t => t.toLowerCase() === tag.toLowerCase())) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  const cat = categories.find(c => c.id === selectedCat)
  const durationMin = entry?.end_time
    ? Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000)
    : 0

  return (
    <SheetShell
      visible={entry !== null}
      reduceMotion={reduceMotion}
      onBackdropPress={handleBackdropPress}
      onPullDown={handleSave}
      surfaceColor={tc.surface2}
      borderColor={tc.border}
      errorMessage={error}
      onDismissError={() => setError(null)}
      footer={
        <>
          <Pressable style={editStyles.dangerBtn} onPress={handleDelete}>
            <Text style={editStyles.dangerText}>Delete</Text>
          </Pressable>
          <Pressable style={sheetStyles.ghostBtn} onPress={onClose}>
            <Text style={[sheetStyles.ghostText, { color: tc.text2 }]}>Cancel</Text>
          </Pressable>
          <Pressable style={[sheetStyles.primaryBtn, { marginLeft: 'auto', backgroundColor: tc.text1 }]} onPress={handleSave}>
            <Text style={[sheetStyles.primaryText, { color: tc.bg }]}>Save</Text>
          </Pressable>
        </>
      }
    >

            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={[sheetStyles.eyebrow, { color: tc.text3 }]}>Edit entry</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {cat && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: cat.color }} />}
                <Text style={{ color: tc.text3, fontSize: 11.5, fontFamily: fonts.ui, fontVariant: ['tabular-nums'] }}>
                  {cat?.name} · {durationMin}m
                </Text>
              </View>
            </View>

            {!entry?.is_running && (
              <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>01 — Time</Text>
            )}
            <View style={{ flexDirection: 'row', gap: 18 }}>
              <TimePicker
                label={entry?.is_running ? 'Time start' : 'Start'}
                hour={startHour} minute={startMin} period={startPeriod}
                onHourChange={setStartHour}
                onMinuteChange={setStartMin}
                onPeriodToggle={() => setStartPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                labelStyle={{ marginTop: entry?.is_running ? 22 : 0 }}
                style={{ flex: 1 }}
              />
              {!entry?.is_running && (
                <TimePicker
                  label="End"
                  hour={endHour} minute={endMin} period={endPeriod}
                  onHourChange={setEndHour}
                  onMinuteChange={setEndMin}
                  onPeriodToggle={() => setEndPeriod(p => p === 'AM' ? 'PM' : 'AM')}
                  placeholder="--"
                  style={{ flex: 1 }}
                />
              )}
              {entry?.is_running && lastStopTime && (
                <Pressable
                  style={[styles.lastStopBtn, styles.inlineLastStopBtn, { borderColor: tc.border2 }]}
                  onPress={setLastStopAsStart}
                >
                  <Text style={[styles.lastStopText, { color: tc.text2 }]}>Set to last stop time</Text>
                  <Text style={[styles.lastStopTime, { color: tc.text3 }]}>{formatSheetTime(lastStopTime)}</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.editTimeShortcuts}>
              {lastStopTime && !entry?.is_running && (
                <Pressable style={[styles.lastStopBtn, { borderColor: tc.border2 }]} onPress={setLastStopAsStart}>
                  <Text style={[styles.lastStopText, { color: tc.text2 }]}>Set start to last stop time</Text>
                  <Text style={[styles.lastStopTime, { color: tc.text3 }]}>{formatSheetTime(lastStopTime)}</Text>
                </Pressable>
              )}
              {entry && !entry.is_running && !showResume && (
                <Pressable
                  style={[styles.lastStopBtn, { borderColor: tc.border2 }]}
                  onPress={() => {
                    const end = new Date()
                    const end12 = to12(end.getHours())
                    setEndHour(end12.h)
                    setEndMin(String(end.getMinutes()).padStart(2, '0'))
                    setEndPeriod(end12.period)
                    setShowResume(true)
                  }}
                >
                  <Text style={[styles.lastStopText, { color: tc.text2 }]}>Set end to current time</Text>
                  <Text style={[styles.lastStopTime, { color: tc.text3 }]}>{formatSheetTime(new Date().toISOString())}</Text>
                </Pressable>
              )}
              {entry && !entry.is_running && showResume && (
                <Pressable style={[styles.lastStopBtn, { borderColor: tc.text1 }]} onPress={handleResume}>
                  <Text style={[styles.lastStopText, { color: tc.text1 }]}>Resume timer</Text>
                  <Text style={[styles.lastStopTime, { color: tc.text3 }]}>undo the stop</Text>
                </Pressable>
              )}
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 10, color: tc.text3 }]}>02 — Category</Text>
            <View style={sheetStyles.chips}>
              {categoryOptions.map(c => (
                <CategoryChip key={c.id} name={c.name} color={c.color} selected={selectedCat === c.id} onPress={() => {
                  setSelectedCat(c.id)
                  setShowNewCat(false)
                  if (!title.trim() || titleIsAuto) setTitleIsAuto(true)
                }} />
              ))}
              <Pressable
                onPress={() => setShowNewCat(v => !v)}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: showNewCat ? tc.text1 : tc.border2 }}
              >
                <Text style={{ color: showNewCat ? tc.text1 : tc.text3, fontSize: 12, fontFamily: fonts.ui }}>+ New</Text>
              </Pressable>
            </View>

            {showNewCat && (
              <View style={{ marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: tc.surface3 }}>
                <TextInput
                  style={{ color: tc.text1, fontSize: 14, fontFamily: fonts.ui, borderBottomWidth: 1, borderBottomColor: tc.border2, paddingBottom: 6, marginBottom: 10 }}
                  placeholder="Category name"
                  placeholderTextColor={tc.text4}
                  value={newCatName}
                  onChangeText={setNewCatName}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {CATEGORY_PALETTE.map(color => (
                    <Pressable
                      key={color}
                      onPress={() => setNewCatColor(color)}
                      style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: color, borderWidth: newCatColor === color ? 2 : 0, borderColor: tc.text1 }}
                    />
                  ))}
                </View>
                <Pressable
                  onPress={handleCreateCat}
                  disabled={creatingCat}
                  style={{ alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: tc.text1, opacity: creatingCat ? 0.55 : 1 }}
                >
                  <Text style={{ color: tc.bg, fontSize: 13, fontFamily: fonts.ui }}>{creatingCat ? 'Creating' : 'Create'}</Text>
                </Pressable>
              </View>
            )}

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>03 — Tags</Text>
            {tagSuggestions.length > 0 && (
              <View style={editStyles.suggestionRow}>
                {tagSuggestions.map(suggestion => (
                  <Pressable
                    key={suggestion.name}
                    onPress={() => addSuggestedTag(suggestion.name)}
                    style={[editStyles.suggestionChip, { borderColor: tc.border2, backgroundColor: tc.surface3 }]}
                  >
                    <Text style={[editStyles.suggestionText, { color: tc.text2 }]} numberOfLines={1}>
                      {suggestion.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={[editStyles.tagsRow, { borderBottomColor: tc.border2 }]}>
              {tags.map((t, i) => (
                <Pressable key={i} onPress={() => setTags(tags.filter((_, j) => j !== i))}>
                  <Text style={[editStyles.tag, { color: tc.text1 }]}>{t}</Text>
                </Pressable>
              ))}
              <TextInput
                style={[editStyles.tagInput, { color: tc.text2 }]}
                value={tagInput}
                onChangeText={setTagInput}
                placeholder="+ add tag"
                placeholderTextColor={tc.text4}
                onSubmitEditing={addTag}
                blurOnSubmit={false}
              />
            </View>

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>04 — Name</Text>
            <TextInput
              style={[sheetStyles.input, { color: tc.text1, borderBottomColor: tc.border2 }]}
              value={title}
              onChangeText={text => {
                if (text === '') {
                  const cat = categoryOptions.find(c => c.id === selectedCat)
                  const parts: string[] = []
                  if (cat) parts.push(cat.name)
                  parts.push(...tags)
                  setTitle(parts.join(' · '))
                  setTitleIsAuto(true)
                } else {
                  setTitle(text)
                  setTitleIsAuto(false)
                }
              }}
              placeholder="Auto-filled from category & tags"
              placeholderTextColor={tc.text4}
            />

            <Text style={[sheetStyles.eyebrow, { marginTop: 22, marginBottom: 6, color: tc.text3 }]}>05 — Notes</Text>
            <TextInput
              style={[sheetStyles.notesInput, { color: tc.text1, borderBottomColor: tc.border2 }]}
              placeholder="Notes (optional)"
              placeholderTextColor={tc.text4}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

    </SheetShell>
  )
}

const editStyles = StyleSheet.create({
  tagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
  },
  tag: {
    color: colors.text1,
    fontSize: 13,
    fontFamily: fonts.ui,
  },
  tagInput: {
    color: colors.text2,
    fontSize: 13,
    fontFamily: fonts.ui,
    minWidth: 80,
    paddingVertical: 2,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  suggestionChip: {
    maxWidth: '48%',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 12,
    fontFamily: fonts.ui,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 22,
    alignItems: 'center',
  },
  dangerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#B47568',
  },
  dangerText: {
    color: '#B47568',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  viewToggle: {
    position: 'absolute',
    bottom: 96,
    right: 27,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  navEdge: {
    width: 54,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    opacity: 0.72,
  },
  navEdgeChevron: {
    fontSize: 11,
    fontFamily: fonts.display,
  },
  navEdgeDow: {
    fontSize: 8,
    fontWeight: '500',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  navEdgeNum: {
    fontSize: 12,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
  },
  dateCenter: { alignItems: 'center' },
  dateSub: {
    color: colors.text3,
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
    fontFamily: fonts.displayItalic,
    letterSpacing: 0.7,
  },
  dateTitle: {
    color: colors.text1,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: fonts.displayBold,
    letterSpacing: -0.36,
    marginTop: 4,
  },
  timeline: { flexDirection: 'row', marginHorizontal: 16, paddingTop: 8 },
  hourCol: { width: 30, position: 'relative', height: BASE_RAIL_HEIGHT },
  hourTick: {
    position: 'absolute',
    left: 0,
    color: colors.text2,
    fontSize: 9.5,
    fontVariant: ['tabular-nums'],
    fontWeight: '400',
    letterSpacing: 0.4,
    fontFamily: fonts.ui,
  },
  dayBoundaryLabel: {
    position: 'absolute',
    left: 0,
    width: 42,
    fontSize: 8,
    lineHeight: 10,
    fontWeight: '600',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayBoundaryLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  rail: { flex: 1, height: BASE_RAIL_HEIGHT, position: 'relative', marginLeft: 4 },
  block: {
    position: 'absolute',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 9,
    overflow: 'hidden',
  },
  blockTitle: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: -0.18,
    fontFamily: fonts.ui,
  },
  blockSub: {
    fontSize: 10.5,
    color: colors.text3,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.1,
    fontWeight: '400',
    fontFamily: fonts.ui,
  },
  nowLine: {
    position: 'absolute',
    left: -3,
    right: 0,
    height: 0,
    borderTopWidth: 1,
    borderTopColor: colors.text1,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  nowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.text1,
    position: 'absolute',
    left: 0,
    top: -3,
  },
  nowRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.text1,
  },
  timePillLabel: {
    color: colors.text3,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
    fontFamily: fonts.ui,
  },
  timerStartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  timerStartTime: {
    flex: 1,
  },
  editTimeShortcuts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  timePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
  },
  timeInput: {
    color: colors.text1,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.displayMedium,
    fontWeight: '500',
    width: 28,
    textAlign: 'center',
    letterSpacing: -0.18,
  },
  timeColon: {
    color: colors.text3,
    fontSize: 18,
    fontFamily: fonts.display,
  },
  ampmBtn: {
    marginLeft: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.border2,
  },
  ampmText: {
    color: colors.text1,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: fonts.ui,
    letterSpacing: 0.5,
  },
  lastStopBtn: {
    flexShrink: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineLastStopBtn: {
    alignSelf: 'flex-end',
    maxWidth: 180,
  },
  lastStopText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  lastStopTime: {
    fontSize: 11,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
    fontFamily: fonts.ui,
  },
  freqPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  freqActive: {
    backgroundColor: colors.text1,
    borderColor: colors.text1,
  },
  freqText: {
    color: colors.text2,
    fontSize: 11.5,
    fontWeight: '400',
    letterSpacing: 0.2,
    fontFamily: fonts.ui,
  },
  freqActiveText: { color: colors.bg },
})

const sheetStyles = StyleSheet.create({
  keyboard: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.surface2,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  scroller: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: spacing.xxl,
    paddingTop: 8,
    paddingBottom: 18,
  },
  handleArea: {
    paddingTop: 10,
    paddingBottom: 14,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.text5,
  },
  eyebrow: {
    color: colors.text3,
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 2.3,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
  input: {
    color: colors.text1,
    fontSize: 22,
    fontWeight: '400',
    fontFamily: fonts.display,
    letterSpacing: -0.33,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
    paddingVertical: 12,
    paddingTop: 14,
    marginTop: 4,
  },
  notesInput: {
    color: colors.text1,
    fontSize: 14,
    fontFamily: fonts.ui,
    borderBottomWidth: 1,
    borderBottomColor: colors.border2,
    paddingVertical: 10,
    paddingTop: 10,
    marginTop: 4,
    minHeight: 72,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 22, alignItems: 'center' },
  footer: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xxl,
    paddingTop: 14,
    paddingBottom: 26,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.xxl,
    marginBottom: 4,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.14)',
  },
  errorText: {
    flex: 1,
    color: '#EF4444',
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: fonts.ui,
  },
  errorDismiss: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  ghostBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ghostText: {
    color: colors.text2,
    fontSize: 12.5,
    fontWeight: '500',
    fontFamily: fonts.ui,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: colors.text1,
    alignItems: 'center',
  },
  primaryText: {
    color: colors.bg,
    fontSize: 11,
    fontWeight: '400',
    letterSpacing: 0.44,
    textTransform: 'uppercase',
    fontFamily: fonts.ui,
  },
})
