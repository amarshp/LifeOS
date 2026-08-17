import { supabase } from '../lib/supabase'
import type { TimeEntry, TimeEntryInsert, TimeEntryUpdate } from '../types/database'
import { paddedDateRange, filterByLocalDay, shiftDate } from '../lib/day-range'
import { completeTodoById } from './todos'
import { emitTimerChange } from '../lib/timer-events'

// Title/category cleanup for a freshly-created manual entry: calls the
// enrich-capture classifier directly (instead of waiting for the DB
// trigger's webhook to get around to it) and, if it lands a patch, tells the
// UI to refetch so the corrected title/category shows up without the user
// doing anything. Deliberately fire-and-forget, NOT awaited by callers —
// measured live 2026-08-17, gpt-4.1-mini classification round-trips at
// ~2.7-4.0s (avg 3.36s across 3 calls), so awaiting it would freeze the
// start/log-entry action for several seconds. Never throws — a failed/slow
// enrich just means the raw title stands until the async DB-trigger fallback
// (still unchanged) catches it moments later.
function quickEnrichInBackground(table: 'time_entries' | 'todos', id: string, rawTitle: string): void {
  supabase.functions
    // rawTitle lets enrich-capture bail if the user edits the title before
    // this lands (same guard the DB-trigger path already relies on) instead
    // of classifying stale content and clobbering a real edit.
    .invoke('enrich-capture', { body: { table, id, title: rawTitle } })
    .then(({ data, error }) => {
      const applied = error ? null : (data as { applied?: Record<string, unknown> } | null)?.applied
      if (applied) emitTimerChange()
    })
    .catch(() => {})
}

// Auto-complete rule: a time entry linked to a task (todo_id) that gets STOPPED
// or logged as completed marks that task done. Lives here so every stop path
// (banner, sheet, Live Activity deep link, handoff) inherits it. Best-effort —
// a failed todo update must never fail the stop itself.
async function completeLinkedTodo(todoId: string | null | undefined): Promise<void> {
  if (!todoId) return
  try {
    await completeTodoById(todoId)
  } catch {
    /* stop succeeded; todo completion is best-effort */
  }
}

export async function getRunningTimers(): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('is_running', true)
    .is('deleted_at', null)
    .order('start_time')
    .returns<TimeEntry[]>()

  if (error) throw error
  return data
}

export async function getEntriesForDate(date: string): Promise<TimeEntry[]> {
  // Query a ±1-day-padded naive window, then bucket by LOCAL calendar day.
  // A naive same-day timestamptz window is offset from the user's real local
  // day (e.g. IST +5:30), silently dropping early/late entries (BUG #2).
  const { gte, lte } = paddedDateRange(date)

  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .gte('start_time', gte)
    .lte('start_time', lte)
    .is('deleted_at', null)
    .order('start_time')
    .returns<TimeEntry[]>()

  if (error) throw error
  return filterByLocalDay(data, date)
}

export async function getEntriesForDateRange(
  startDate: string,
  endDate: string
): Promise<TimeEntry[]> {
  // Pad ±1 day so callers that re-bucket by local day (Week view) still catch
  // entries whose naive UTC start falls just outside the range edges (BUG #2).
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .gte('start_time', `${shiftDate(startDate, -1)}T00:00:00`)
    .lte('start_time', `${shiftDate(endDate, 1)}T23:59:59`)
    .is('deleted_at', null)
    .order('start_time')
    .returns<TimeEntry[]>()

  if (error) throw error
  return data
}

export async function startTimer(entry: TimeEntryInsert): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .insert({ ...entry, is_running: true } as unknown as Record<string, unknown>)
    .select()
    .single<TimeEntry>()

  if (error) throw error
  quickEnrichInBackground('time_entries', data.id, data.title)
  return data
}

export async function startTimerStopPrevious(params: {
  categoryId: string
  title: string
  tags?: string[]
  startTime?: string
  notes?: string | null
  todoId?: string | null
  calendarBlockId?: string | null
}): Promise<string> {
  if (params.startTime) {
    // Chain: end the running timer(s) EXACTLY at the new start time (the handoff)
    // instead of now(), so sequential tasks are contiguous — no clean-minute
    // gap/overlap. Clamp so a start backdated before a running timer's own start
    // can't invert it (that timer just ends at its start).
    const running = await getRunningTimers()
    const handoffMs = new Date(params.startTime).getTime()
    for (const r of running) {
      const startMs = new Date(r.start_time).getTime()
      // Mis-tap protection: a timer that ran under a minute before being
      // switched away was almost certainly accidental — discard it instead of
      // leaving sub-minute dust on the timeline (and don't complete its todo).
      if (handoffMs - startMs < 60_000) {
        await supabase.from('time_entries').delete().eq('id', r.id)
        continue
      }
      const endIso = handoffMs > startMs ? params.startTime : r.start_time
      const { error: stopErr } = await supabase
        .from('time_entries')
        .update({ is_running: false, end_time: endIso } as unknown as Record<string, unknown>)
        .eq('id', r.id)
      if (stopErr) throw stopErr
      await completeLinkedTodo(r.todo_id)
    }
    const entry = await startTimer({
      category_id: params.categoryId,
      title: params.title,
      start_time: params.startTime,
      tags: params.tags ?? [],
      notes: params.notes ?? null,
      todo_id: params.todoId ?? null,
      calendar_block_id: params.calendarBlockId ?? null,
    })
    return entry.id
  }

  // RPC path stops previous timers server-side; complete their linked todos here.
  const stopped = await getRunningTimers()

  const { data, error } = await supabase.rpc('start_timer_stop_previous', {
    p_category_id: params.categoryId,
    p_title: params.title,
    p_tags: params.tags ?? [],
  })

  if (error) throw error
  const entryId = data as string
  const nowMs = Date.now()
  for (const r of stopped) {
    // Same mis-tap rule as the custom-start path: sub-minute switched-away
    // timers vanish rather than becoming timeline dust.
    if (nowMs - new Date(r.start_time).getTime() < 60_000) {
      await supabase.from('time_entries').delete().eq('id', r.id)
      continue
    }
    await completeLinkedTodo(r.todo_id)
  }
  if (params.notes || params.todoId || params.calendarBlockId) {
    await updateEntry(entryId, {
      ...(params.notes ? { notes: params.notes } : {}),
      ...(params.todoId ? { todo_id: params.todoId } : {}),
      ...(params.calendarBlockId ? { calendar_block_id: params.calendarBlockId } : {}),
    })
  }
  quickEnrichInBackground('time_entries', entryId, params.title)
  return entryId
}

export async function getLastStoppedEntry(): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('is_running', false)
    .not('end_time', 'is', null)
    .is('deleted_at', null)
    .order('end_time', { ascending: false })
    .limit(1)
    .returns<TimeEntry[]>()

  if (error) throw error
  return data[0] ?? null
}

export async function stopTimer(entryId: string): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update({ is_running: false, end_time: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', entryId)
    .select()
    .single<TimeEntry>()

  if (error) throw error
  await completeLinkedTodo(data.todo_id)
  return data
}

export async function stopAllTimers(): Promise<void> {
  const running = await getRunningTimers()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('time_entries')
    .update({ is_running: false, end_time: now } as unknown as Record<string, unknown>)
    .eq('is_running', true)
    .is('deleted_at', null)

  if (error) throw error
  for (const r of running) await completeLinkedTodo(r.todo_id)
}

// Moving an entry's start away from an entry that was touching it right before
// (prev.end_time === old start_time) would otherwise leave a silent gap (moved
// later) or an unnoticed overlap (moved earlier). Auto-extend/trim that
// neighbor's end to the new boundary — skipped if it would collapse the
// neighbor to zero/negative duration, leaving it for manual resolution.
async function extendTouchingNeighbor(entryId: string, oldStart: string, newStart: string): Promise<void> {
  const { data: entry } = await supabase.from('time_entries').select('user_id').eq('id', entryId).maybeSingle()
  if (!entry) return
  const { data: prev } = await supabase
    .from('time_entries')
    .select('id, start_time')
    .eq('user_id', (entry as { user_id: string }).user_id)
    .eq('end_time', oldStart)
    .is('deleted_at', null)
    .neq('id', entryId)
    .limit(1)
    .maybeSingle()
  if (!prev || (prev as { start_time: string }).start_time >= newStart) return
  await supabase.from('time_entries').update({ end_time: newStart } as unknown as Record<string, unknown>).eq('id', (prev as { id: string }).id)
}

export async function updateEntry(id: string, updates: TimeEntryUpdate): Promise<TimeEntry> {
  let oldStart: string | undefined
  if (updates.start_time) {
    const { data: current } = await supabase.from('time_entries').select('start_time').eq('id', id).maybeSingle()
    oldStart = (current as { start_time: string } | null)?.start_time
  }

  const { data, error } = await supabase
    .from('time_entries')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<TimeEntry>()

  if (error) throw error

  // Only touch the neighbor once the requested edit is confirmed committed —
  // extending it first risked leaving that mutation stranded if this update failed.
  if (oldStart && updates.start_time && oldStart !== updates.start_time) {
    await extendTouchingNeighbor(id, oldStart, updates.start_time as string)
  }
  return data
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from('time_entries')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}

// Undo a soft-delete: clear deleted_at so the entry is live again.
export async function restoreEntry(id: string): Promise<void> {
  const { error } = await supabase
    .from('time_entries')
    .update({ deleted_at: null } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}

const REVIEW_TAG = 'review'

// Voice/Siri entries are tagged `review` (may be mis-heard). The review queue
// surfaces them — running or completed — newest first, so they can be corrected.
export async function getEntriesNeedingReview(): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .contains('tags', [REVIEW_TAG])
    .is('deleted_at', null)
    .order('start_time', { ascending: false })
    .returns<TimeEntry[]>()

  if (error) throw error
  return data
}

// One-tap "reviewed": drop the `review` tag so it leaves the queue.
export async function clearReviewTag(id: string, tags: string[]): Promise<void> {
  await updateEntry(id, { tags: tags.filter((t) => t !== REVIEW_TAG) })
}

// Global entry search: title match (case-insensitive) and/or category filter,
// newest first. Empty query + no category returns the most recent entries.
export async function searchEntries(opts: {
  query?: string
  categoryId?: string | null
}): Promise<TimeEntry[]> {
  let q = supabase.from('time_entries').select('*').is('deleted_at', null)
  if (opts.categoryId) q = q.eq('category_id', opts.categoryId)
  const text = opts.query?.trim()
  if (text) q = q.ilike('title', `%${text}%`)

  const { data, error } = await q
    .order('start_time', { ascending: false })
    .limit(200)
    .returns<TimeEntry[]>()

  if (error) throw error
  return data
}

export async function addCompletedEntry(entry: {
  category_id: string
  title: string
  start_time: string
  end_time: string
  tags?: string[]
  notes?: string | null
  todo_id?: string | null
}): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      category_id: entry.category_id,
      title: entry.title,
      start_time: entry.start_time,
      end_time: entry.end_time,
      is_running: false,
      tags: entry.tags ?? [],
      notes: entry.notes ?? null,
      todo_id: entry.todo_id ?? null,
    } as unknown as Record<string, unknown>)
    .select()
    .single<TimeEntry>()

  if (error) throw error
  await completeLinkedTodo(data.todo_id)
  quickEnrichInBackground('time_entries', data.id, data.title)
  return data
}

export async function getRecentEntries(limit: number = 5): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .is('deleted_at', null)
    .order('start_time', { ascending: false })
    .limit(limit)
    .returns<TimeEntry[]>()

  if (error) throw error
  return data
}

export async function getCategoryUsageNearHour(
  hour: number,
  dayOfWeek?: number,
): Promise<{ category_id: string; count: number }[]> {
  const since = new Date()
  since.setDate(since.getDate() - 90)

  const { data, error } = await supabase
    .from('time_entries')
    .select('category_id,start_time')
    .is('deleted_at', null)
    .gte('start_time', since.toISOString())
    .returns<{ category_id: string; start_time: string }[]>()

  if (error) throw error

  const counts = new Map<string, number>()
  for (const entry of data) {
    const d = new Date(entry.start_time)
    const hDiff = Math.abs(d.getHours() - hour)
    const hourWeight = hDiff === 0 ? 3 : hDiff === 1 ? 2 : hDiff === 2 ? 1 : 0
    if (hourWeight === 0) continue

    let dayBonus = 0
    if (dayOfWeek !== undefined) {
      const dDiff = Math.min(Math.abs(d.getDay() - dayOfWeek), 7 - Math.abs(d.getDay() - dayOfWeek))
      dayBonus = dDiff === 0 ? 2 : dDiff === 1 ? 1 : 0
    }

    counts.set(entry.category_id, (counts.get(entry.category_id) ?? 0) + hourWeight + dayBonus)
  }

  return Array.from(counts.entries())
    .map(([category_id, count]) => ({ category_id, count }))
    .sort((a, b) => b.count - a.count)
}
