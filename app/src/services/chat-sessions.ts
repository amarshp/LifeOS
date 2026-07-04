import { supabase } from '../lib/supabase'
import type { ChatMessage, ProposedPlan } from './plan-chat'

// Persistent agent conversations. Saved after every turn so nothing vanishes
// when the app is backgrounded or killed; the Agent screen lists recent
// sessions to resume.

export interface ChatSession {
  id: string
  title: string
  date: string
  messages: ChatMessage[]
  plan: ProposedPlan | null
  updated_at: string
}

/** Recent sessions — scoped to a plan-target date when given (the Agent's
 * date bar), so each day shows its own conversations. */
export async function getRecentSessions(date?: string, limit = 12): Promise<ChatSession[]> {
  let q = supabase
    .from('chat_sessions')
    .select('id, title, date, messages, plan, updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (date) q = q.eq('date', date)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as ChatSession[]
}

export async function createSession(params: {
  title: string
  date: string
  messages: ChatMessage[]
  plan: ProposedPlan | null
}): Promise<string> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id: userData.user.id,
      title: params.title.slice(0, 80),
      date: params.date,
      messages: params.messages,
      plan: params.plan,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function updateSession(
  id: string,
  patch: { messages?: ChatMessage[]; plan?: ProposedPlan | null; date?: string },
): Promise<void> {
  const { error } = await supabase.from('chat_sessions').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('chat_sessions')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
