import { supabase } from '../lib/supabase'
import type { Tag, TagInsert, TagUpdate } from '../types/database'

export type TagUsage = {
  category_id: string
  name: string
  count: number
}

type TaggedItemRow = {
  category_id: string
  tags: string[] | null
}

export async function getTagsByCategory(categoryId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('category_id', categoryId)
    .is('deleted_at', null)
    .order('name')
    .returns<Tag[]>()

  if (error) throw error
  return data
}

export async function getAllTags(): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .is('deleted_at', null)
    .order('name')
    .returns<Tag[]>()

  if (error) throw error
  return data
}

function addTagUsageRows(counts: Map<string, TagUsage>, rows: TaggedItemRow[], weight: number) {
  for (const row of rows) {
    const rowTags = new Set(row.tags ?? [])
    for (const rawTag of rowTags) {
      const name = rawTag.trim()
      if (!name) continue
      const tagKey = name.toLowerCase()
      const key = `${row.category_id}:${tagKey}`
      const existing = counts.get(key)
      if (existing) {
        existing.count += weight
      } else {
        counts.set(key, { category_id: row.category_id, name, count: weight })
      }
    }
  }
}

export async function getTagUsage(): Promise<TagUsage[]> {
  const [entriesResult, blocksResult] = await Promise.all([
    supabase
      .from('time_entries')
      .select('category_id,tags')
      .is('deleted_at', null)
      .returns<TaggedItemRow[]>(),
    supabase
      .from('calendar_blocks')
      .select('category_id,tags')
      .is('deleted_at', null)
      .returns<TaggedItemRow[]>(),
  ])

  if (entriesResult.error) throw entriesResult.error
  if (blocksResult.error) throw blocksResult.error

  const counts = new Map<string, TagUsage>()
  addTagUsageRows(counts, entriesResult.data ?? [], 1)
  addTagUsageRows(counts, blocksResult.data ?? [], 1)
  return Array.from(counts.values())
}

export async function createTag(tag: TagInsert): Promise<Tag> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('tags')
    .insert({ ...tag, user_id: tag.user_id ?? user.id } as unknown as Record<string, unknown>)
    .select()
    .single<Tag>()

  if (error) throw error
  return data
}

export async function ensureTagsForCategory(categoryId: string, names: string[]): Promise<void> {
  const uniqueNames = Array.from(new Set(
    names.map(name => name.trim()).filter(Boolean)
  ))
  if (uniqueNames.length === 0) return

  const existing = await getTagsByCategory(categoryId)
  const existingNames = new Set(existing.map(tag => tag.name.trim().toLowerCase()))
  const missingNames = uniqueNames.filter(name => !existingNames.has(name.toLowerCase()))
  if (missingNames.length === 0) return

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('tags')
    .insert(missingNames.map(name => ({
      user_id: user.id,
      category_id: categoryId,
      name,
    })) as unknown as Record<string, unknown>[])

  if (error) throw error
}

export async function updateTag(id: string, updates: TagUpdate): Promise<Tag> {
  const { data, error } = await supabase
    .from('tags')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<Tag>()

  if (error) throw error
  return data
}

export async function deleteTag(id: string): Promise<void> {
  const { error } = await supabase
    .from('tags')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}
