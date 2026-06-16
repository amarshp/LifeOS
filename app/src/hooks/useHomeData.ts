import { useCallback, useMemo, useState } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSettings } from '../contexts/SettingsContext'
import { useTimer } from './useTimer'
import { useNow } from './useNow'
import { todayStr } from '../lib/date'
import { getVisiblePlannedBlocks } from '../lib/planned-blocks'
import { getQuoteForDate } from '../lib/quote'
import * as categoriesService from '../services/categories'
import * as calendarBlocksService from '../services/calendar-blocks'
import * as timeEntriesService from '../services/time-entries'
import type { Category, CalendarBlock, TimeEntry } from '../types/database'

/**
 * Aggregates everything the home / Today screens render: current + next blocks,
 * day totals, the daily quote, and timer/router handles. Returns raw data and
 * references only — each screen derives its own display strings and ratios so
 * the hook stays uncoupled from any single layout.
 */
export function useHomeData() {
  const router = useRouter()
  const timer = useTimer()
  const { colors, quickStartCount } = useSettings()
  const now = useNow()

  const [categories, setCategories] = useState<Category[]>([])
  const [todayBlocks, setTodayBlocks] = useState<CalendarBlock[]>([])
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([])
  const [recentEntries, setRecentEntries] = useState<TimeEntry[]>([])
  const [categoryUsage, setCategoryUsage] = useState<Map<string, number>>(new Map())
  const [reviewCount, setReviewCount] = useState(0)

  const today = todayStr()

  const loadData = useCallback(async () => {
    const n = new Date()
    try {
      const [cats, blocks, entries, recent] = await Promise.all([
        categoriesService.getCategories(),
        calendarBlocksService.getEffectiveBlocksForDate(today),
        timeEntriesService.getEntriesForDate(today),
        timeEntriesService.getRecentEntries(5),
      ])
      setCategories(cats)
      setTodayBlocks(blocks)
      setTodayEntries(entries)
      setRecentEntries(recent)
      timeEntriesService.getCategoryUsageNearHour(n.getHours(), n.getDay())
        .then(usage => setCategoryUsage(new Map(usage.map(u => [u.category_id, u.count]))))
        .catch(() => {})
      timeEntriesService.getEntriesNeedingReview()
        .then(r => setReviewCount(r.length))
        .catch(() => {})
    } catch {}
  }, [today])

  useFocusEffect(useCallback(() => { loadData(); timer.refresh() }, [loadData, timer.refresh]))

  // Running timers, already ordered by start_time (A = earlier). Up to 2 (parallel).
  const running = timer.running
  const currentEntry = running[0]
  const currentCategory = categories.find(c => c.id === currentEntry?.category_id)

  const runningCatIds = useMemo(() => new Set(running.map(e => e.category_id)), [running])

  const quickStartCategories = useMemo(() => {
    if (quickStartCount === 0) return []
    return [...categories]
      .filter(c => !runningCatIds.has(c.id))
      .sort((a, b) => (categoryUsage.get(b.id) ?? 0) - (categoryUsage.get(a.id) ?? 0))
      .slice(0, quickStartCount)
  }, [categories, categoryUsage, runningCatIds, quickStartCount])

  const visibleTodayBlocks = useMemo(() => getVisiblePlannedBlocks(todayBlocks, now), [todayBlocks, now])
  const nextBlock = visibleTodayBlocks[0]
  const nextCategory = categories.find(c => c.id === nextBlock?.category_id)

  const [year, month, day] = today.split('-').map(Number)
  const dayStartMs = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
  const dayEndMs = new Date(year, month - 1, day, 23, 59, 59, 999).getTime()
  const nowMs = now.getTime()

  const trackedMs = todayEntries.reduce((sum, e) => {
    const startMs = new Date(e.start_time).getTime()
    const endMs = e.end_time ? new Date(e.end_time).getTime() : nowMs
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return sum
    const clampedStart = Math.max(startMs, dayStartMs)
    const clampedEnd = Math.min(endMs, nowMs, dayEndMs)
    return sum + Math.max(0, clampedEnd - clampedStart)
  }, 0)

  const plannedMs = visibleTodayBlocks.reduce((sum, b) => {
    return sum + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
  }, 0)

  const elapsed = currentEntry ? (timer.elapsed[currentEntry.id] ?? 0) : 0

  const quote = useMemo(() => getQuoteForDate(now), [today]) // eslint-disable-line react-hooks/exhaustive-deps

  // Actual entries + running, deduped — what a timeline should render.
  const timelineEntries = useMemo(() => ([
    ...todayEntries.filter(e => !timer.running.some(r => r.id === e.id)),
    ...timer.running,
  ]), [todayEntries, timer.running])

  return {
    router,
    timer,
    now,
    colors,
    quickStartCount,
    categories,
    recentEntries,
    running,
    currentEntry,
    currentCategory,
    visibleTodayBlocks,
    nextBlock,
    nextCategory,
    trackedMs,
    plannedMs,
    elapsed,
    quote,
    timelineEntries,
    quickStartCategories,
    reviewCount,
  }
}
