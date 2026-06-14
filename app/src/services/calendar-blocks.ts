import { supabase } from '../lib/supabase'
import type { CalendarBlock, CalendarBlockInsert, CalendarBlockUpdate } from '../types/database'
import { addLocalDays, localDaySpan, shiftToLocalDate } from '../lib/time-range'

export async function getBlocksForDate(date: string): Promise<CalendarBlock[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('*')
    .eq('date', date)
    .is('deleted_at', null)
    .order('start_time')
    .returns<CalendarBlock[]>()

  if (error) throw error
  return data
}

export async function getBlocksForDateRange(
  startDate: string,
  endDate: string
): Promise<CalendarBlock[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
    .is('deleted_at', null)
    .order('start_time')
    .returns<CalendarBlock[]>()

  if (error) throw error
  return data
}

export async function getRecurringBlocks(): Promise<CalendarBlock[]> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .select('*')
    .neq('recurrence', 'none')
    .is('deleted_at', null)
    .returns<CalendarBlock[]>()

  if (error) throw error
  return data
}

export function expandRecurrence(block: CalendarBlock, targetDate: string): boolean {
  if (block.recurrence === 'none') return block.date === targetDate

  const target = new Date(targetDate)
  const blockStart = new Date(block.date)
  if (target < blockStart) return false

  if (block.recurrence_end) {
    const end = new Date(block.recurrence_end)
    if (target > end) return false
  }

  const dayOfWeek = (target.getDay() + 6) % 7

  switch (block.recurrence) {
    case 'daily':
      return true
    case 'weekdays':
      return dayOfWeek >= 0 && dayOfWeek <= 4
    case 'mwf':
      return dayOfWeek === 0 || dayOfWeek === 2 || dayOfWeek === 4
    case 'weekly':
      return dayOfWeek === (blockStart.getDay() + 6) % 7
    case 'custom':
      return block.recurrence_days?.includes(dayOfWeek) ?? false
    default:
      return false
  }
}

export async function getEffectiveBlocksForDate(date: string): Promise<CalendarBlock[]> {
  const [directBlocks, recurringBlocks] = await Promise.all([
    getBlocksForDate(date),
    getRecurringBlocks(),
  ])

  const expandedRecurring = recurringBlocks
    .filter(b => b.date !== date && expandRecurrence(b, date))
    .map(b => {
      // Re-anchor in LOCAL time and preserve the original day-span so a
      // cross-midnight recurring block still ends on the following day.
      const span = localDaySpan(b.start_time, b.end_time)
      return {
        ...b,
        date,
        start_time: shiftToLocalDate(b.start_time, date),
        end_time: shiftToLocalDate(b.end_time, addLocalDays(date, span)),
      }
    })

  return [...directBlocks, ...expandedRecurring].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )
}

/**
 * Effective (recurrence-expanded) blocks for every local day in
 * `[startDate, endDate]`, in one pair of round-trips. Direct blocks are returned
 * as-is; recurring blocks are re-anchored onto each matching day (mirroring
 * `getEffectiveBlocksForDate`). Used by Insights so a Week/Month view does not
 * fire one request per day.
 */
export async function getBlocksInRange(
  startDate: string,
  endDate: string
): Promise<CalendarBlock[]> {
  const [directBlocks, recurringBlocks] = await Promise.all([
    getBlocksForDateRange(startDate, endDate),
    getRecurringBlocks(),
  ])

  const out: CalendarBlock[] = [...directBlocks]
  for (let d = startDate; d <= endDate; d = addLocalDays(d, 1)) {
    for (const b of recurringBlocks) {
      if (b.date === d) continue // anchor day already present in directBlocks
      if (!expandRecurrence(b, d)) continue
      const span = localDaySpan(b.start_time, b.end_time)
      out.push({
        ...b,
        date: d,
        start_time: shiftToLocalDate(b.start_time, d),
        end_time: shiftToLocalDate(b.end_time, addLocalDays(d, span)),
      })
    }
  }

  return out.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  )
}

export async function createBlock(block: CalendarBlockInsert): Promise<CalendarBlock> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert({ ...block, user_id: user.id } as unknown as Record<string, unknown>)
    .select()
    .single<CalendarBlock>()

  if (error) throw error
  return data
}

export async function updateBlock(
  id: string,
  updates: CalendarBlockUpdate
): Promise<CalendarBlock> {
  const { data, error } = await supabase
    .from('calendar_blocks')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<CalendarBlock>()

  if (error) throw error
  return data
}

export async function deleteBlock(id: string): Promise<void> {
  const { error } = await supabase
    .from('calendar_blocks')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}
