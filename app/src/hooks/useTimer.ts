import { useCallback, useEffect, useRef, useState } from 'react'
import type { TimeEntry } from '../types/database'
import * as timeEntries from '../services/time-entries'
import { emitTimerChange, subscribeTimerChange } from '../lib/timer-events'

interface TimerState {
  running: TimeEntry[]
  loading: boolean
  elapsed: Record<string, number>
}

function getElapsed(running: TimeEntry[]): Record<string, number> {
  const now = Date.now()
  const elapsed: Record<string, number> = {}
  for (const entry of running) {
    elapsed[entry.id] = Math.max(0, Math.floor((now - new Date(entry.start_time).getTime()) / 1000))
  }
  return elapsed
}

export function useTimer() {
  const [state, setState] = useState<TimerState>({
    running: [],
    loading: true,
    elapsed: {},
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    const running = await timeEntries.getRunningTimers()
    setState(prev => ({ ...prev, running, elapsed: getElapsed(running), loading: false }))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    return subscribeTimerChange(() => {
      refresh().catch(() => {})
    })
  }, [refresh])

  useEffect(() => {
    if (state.running.length === 0) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }

    intervalRef.current = setInterval(() => {
      setState(prev => ({ ...prev, elapsed: getElapsed(state.running) }))
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.running])

  const start = useCallback(async (params: {
    categoryId: string
    title: string
    tags?: string[]
    startTime?: string
    notes?: string | null
    todoId?: string | null
    calendarBlockId?: string | null
  }) => {
    await timeEntries.startTimerStopPrevious(params)
    await refresh()
    emitTimerChange()
  }, [refresh])

  const startParallel = useCallback(async (params: {
    categoryId: string
    title: string
    tags?: string[]
    startTime?: string
    notes?: string | null
    todoId?: string | null
    calendarBlockId?: string | null
  }) => {
    await timeEntries.startTimer({
      category_id: params.categoryId,
      title: params.title,
      start_time: params.startTime ?? new Date().toISOString(),
      is_running: true,
      tags: params.tags ?? [],
      notes: params.notes ?? null,
      todo_id: params.todoId ?? null,
      calendar_block_id: params.calendarBlockId ?? null,
    })
    await refresh()
    emitTimerChange()
  }, [refresh])

  const stop = useCallback(async (entryId: string) => {
    await timeEntries.stopTimer(entryId)
    await refresh()
    emitTimerChange()
  }, [refresh])

  const stopAll = useCallback(async () => {
    await timeEntries.stopAllTimers()
    await refresh()
    emitTimerChange()
  }, [refresh])

  return {
    running: state.running,
    elapsed: state.elapsed,
    loading: state.loading,
    start,
    startParallel,
    stop,
    stopAll,
    refresh,
  }
}

export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
