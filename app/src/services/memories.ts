import { supabase } from '../lib/supabase'

// Agent memory palette — durable facts the agent may use. Fully inspectable:
// the user can add, edit, pin, and forget every row.

export type MemoryKind = 'profile' | 'routine' | 'preference' | 'fact'

export interface AgentMemory {
  id: string
  kind: MemoryKind
  content: string
  source: 'user' | 'agent'
  pinned: boolean
  created_at: string
  last_confirmed_at: string
}

export async function getMemories(): Promise<AgentMemory[]> {
  const { data, error } = await supabase
    .from('agent_memories')
    .select('id, kind, content, source, pinned, created_at, last_confirmed_at')
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('last_confirmed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as AgentMemory[]
}

export async function addMemory(content: string, kind: MemoryKind = 'fact'): Promise<AgentMemory> {
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) throw new Error('Not signed in')
  const { data, error } = await supabase
    .from('agent_memories')
    .insert({ user_id: userData.user.id, content, kind, source: 'user' })
    .select('id, kind, content, source, pinned, created_at, last_confirmed_at')
    .single()
  if (error) throw new Error(error.message)
  return data as AgentMemory
}

export async function setPinned(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('agent_memories').update({ pinned }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function forgetMemory(id: string): Promise<void> {
  const { error } = await supabase
    .from('agent_memories')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}
