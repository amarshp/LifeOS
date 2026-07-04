import { supabase } from '../lib/supabase'

// Server-backed settings (user_settings table). Unlike the AsyncStorage
// settings, these are readable by DB triggers and edge functions, so they can
// be ENFORCED below the UI (e.g. the running-timer cap).

export interface NotificationPrefs {
  notif_plan_enabled: boolean
  notif_plan_offsets_min: number[]
  notif_task_enabled: boolean
  notif_task_offsets_min: number[]
  notif_plan_tomorrow_hhmm: string | null // 'HH:MM' local; null = off
  quiet_hours_start: number | null // local hour 0-23; null = off
  quiet_hours_end: number | null
}

export interface UserSettings extends NotificationPrefs {
  allow_parallel_timers: boolean
}

const DEFAULTS: UserSettings = {
  allow_parallel_timers: false,
  notif_plan_enabled: true,
  notif_plan_offsets_min: [15, 5],
  notif_task_enabled: true,
  notif_task_offsets_min: [60],
  notif_plan_tomorrow_hhmm: null,
  quiet_hours_start: null,
  quiet_hours_end: null,
}

const COLUMNS =
  'allow_parallel_timers, notif_plan_enabled, notif_plan_offsets_min, notif_task_enabled, notif_task_offsets_min, notif_plan_tomorrow_hhmm, quiet_hours_start, quiet_hours_end'

export async function getUserSettings(): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select(COLUMNS)
    .maybeSingle()
  if (error || !data) return { ...DEFAULTS }
  const row = data as Record<string, unknown>
  return {
    allow_parallel_timers: row.allow_parallel_timers === true,
    notif_plan_enabled: row.notif_plan_enabled !== false,
    notif_plan_offsets_min: Array.isArray(row.notif_plan_offsets_min) ? (row.notif_plan_offsets_min as number[]) : DEFAULTS.notif_plan_offsets_min,
    notif_task_enabled: row.notif_task_enabled !== false,
    notif_task_offsets_min: Array.isArray(row.notif_task_offsets_min) ? (row.notif_task_offsets_min as number[]) : DEFAULTS.notif_task_offsets_min,
    notif_plan_tomorrow_hhmm: typeof row.notif_plan_tomorrow_hhmm === 'string' ? row.notif_plan_tomorrow_hhmm : null,
    quiet_hours_start: typeof row.quiet_hours_start === 'number' ? row.quiet_hours_start : null,
    quiet_hours_end: typeof row.quiet_hours_end === 'number' ? row.quiet_hours_end : null,
  }
}

async function upsertSettings(patch: Record<string, unknown>): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userData.user.id, ...patch }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}

export async function setAllowParallelTimers(value: boolean): Promise<void> {
  await upsertSettings({ allow_parallel_timers: value })
}

export async function updateNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
  await upsertSettings(patch)
}
