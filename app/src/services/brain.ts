import { supabase } from '../lib/supabase'

// Client side of the autonomous brain: read concerns + run log, and poke the
// loop on app-open so in-app usage doesn't wait for the half-hourly cron.

export interface Concern {
  id: string
  key: string
  kind: string
  title: string
  detail: string | null
  evidence: string | null
  importance: number
  status: 'open' | 'resolved' | 'dismissed' | 'superseded'
  resolution: string | null
  last_action: string | null
  last_action_at: string | null
  notified_count: number
  updated_at: string
}

export interface BrainRun {
  id: string
  trigger: string
  summary: string
  created_at: string
}

export async function getConcerns(): Promise<Concern[]> {
  const { data, error } = await supabase
    .from('concerns')
    .select('id, key, kind, title, detail, evidence, importance, status, resolution, last_action, last_action_at, notified_count, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Concern[]
}

export async function dismissConcern(id: string): Promise<void> {
  const { error } = await supabase
    .from('concerns')
    .update({ status: 'dismissed', resolution: 'dismissed by user' })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function getRecentRuns(): Promise<BrainRun[]> {
  const { data, error } = await supabase
    .from('brain_runs')
    .select('id, trigger, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return (data ?? []) as BrainRun[]
}

let lastTickMs = 0
const TICK_MIN_INTERVAL_MS = 10 * 60_000

/** Fire a brain cycle for this user (throttled — cron covers the background). */
export async function tickBrain(): Promise<void> {
  const now = Date.now()
  if (now - lastTickMs < TICK_MIN_INTERVAL_MS) return
  lastTickMs = now
  await supabase.functions.invoke('brain', { body: { trigger: 'app_open' } }).catch(() => {})
}
