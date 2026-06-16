import { supabase } from '../lib/supabase'
import type { TimeEntry, TimeEntryInsert, TimeEntryUpdate } from '../types/database'
import { paddedDateRange, filterByLocalDay, shiftDate } from '../lib/day-range'

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
  return data
}

export async function startTimerStopPrevious(params: {
  categoryId: string
  title: string
  tags?: string[]
  startTime?: string
  notes?: string | null
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
      const endIso = handoffMs > startMs ? params.startTime : r.start_time
      const { error: stopErr } = await supabase
        .from('time_entries')
        .update({ is_running: false, end_time: endIso } as unknown as Record<string, unknown>)
        .eq('id', r.id)
      if (stopErr) throw stopErr
    }
    const entry = await startTimer({
      category_id: params.categoryId,
      title: params.title,
      start_time: params.startTime,
      tags: params.tags ?? [],
      notes: params.notes ?? null,
    })
    return entry.id
  }

  const { data, error } = await supabase.rpc('start_timer_stop_previous', {
    p_category_id: params.categoryId,
    p_title: params.title,
    p_tags: params.tags ?? [],
  })

  if (error) throw error
  const entryId = data as string
  if (params.notes) {
    await updateEntry(entryId, { notes: params.notes })
  }
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
  return data
}

export async function stopAllTimers(): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('time_entries')
    .update({ is_running: false, end_time: now } as unknown as Record<string, unknown>)
    .eq('is_running', true)
    .is('deleted_at', null)

  if (error) throw error
}

export async function updateEntry(id: string, updates: TimeEntryUpdate): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<TimeEntry>()

  if (error) throw error
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

export async function addCompletedEntry(entry: {
  category_id: string
  title: string
  start_time: string
  end_time: string
  tags?: string[]
  notes?: string | null
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
    } as unknown as Record<string, unknown>)
    .select()
    .single<TimeEntry>()

  if (error) throw error
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
