import { supabase } from '../lib/supabase'

// Server-backed settings (user_settings table). Unlike the AsyncStorage
// settings, these are readable by DB triggers and edge functions, so they can
// be ENFORCED below the UI (e.g. the running-timer cap).

export interface UserSettings {
  allow_parallel_timers: boolean
}

const DEFAULTS: UserSettings = {
  allow_parallel_timers: false,
}

export async function getUserSettings(): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('allow_parallel_timers')
    .maybeSingle()
  if (error || !data) return { ...DEFAULTS }
  return { allow_parallel_timers: data.allow_parallel_timers === true }
}

export async function setAllowParallelTimers(value: boolean): Promise<void> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: userData.user.id, allow_parallel_timers: value }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}
