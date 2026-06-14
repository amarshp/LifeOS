import { supabase } from '../lib/supabase'

export interface InsightEntry {
  id: string
  category_id: string
  start_time: string
  end_time: string | null
  tags: string[]
  is_running: boolean
}

export async function getAllEntries(): Promise<InsightEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('id, category_id, start_time, end_time, tags, is_running')
    .is('deleted_at', null)
    .order('start_time', { ascending: true })
    .returns<InsightEntry[]>()
  if (error) throw error
  return data ?? []
}
