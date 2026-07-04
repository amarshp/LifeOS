import { supabase } from '../lib/supabase'

// Direct reminders (scheduled_notifications table): created by the agent tool
// or the user. Derived reminders (plan blocks / task deadlines / rituals) are
// computed client-side by lib/notifications.ts and never stored here in v1.

export interface Reminder {
  id: string
  source: 'agent' | 'user' | 'system'
  ref_id: string | null
  fire_at: string
  title: string
  body: string | null
  status: 'pending' | 'fired' | 'cancelled'
}

export async function getUpcomingReminders(): Promise<Reminder[]> {
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .select('id, source, ref_id, fire_at, title, body, status')
    .eq('status', 'pending')
    .gte('fire_at', new Date().toISOString())
    .order('fire_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Reminder[]
}

export async function createReminder(params: { title: string; fireAt: string; body?: string | null }): Promise<Reminder> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .insert({
      user_id: userData.user.id,
      source: 'user',
      fire_at: params.fireAt,
      title: params.title,
      body: params.body ?? null,
    })
    .select('id, source, ref_id, fire_at, title, body, status')
    .single()
  if (error) throw new Error(error.message)
  return data as Reminder
}

export async function cancelReminder(id: string): Promise<void> {
  const { error } = await supabase
    .from('scheduled_notifications')
    .update({ status: 'cancelled' })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

/** Mark past-due pending reminders as fired (housekeeping on reconcile). */
export async function sweepFiredReminders(): Promise<void> {
  await supabase
    .from('scheduled_notifications')
    .update({ status: 'fired' })
    .eq('status', 'pending')
    .lt('fire_at', new Date().toISOString())
}
