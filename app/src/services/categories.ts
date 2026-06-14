import { supabase } from '../lib/supabase'
import type { Category, CategoryInsert, CategoryUpdate, CategoryKind } from '../types/database'

const ESSENTIAL_NAME_RE = /(sleep|nap|food|meal|lunch|breakfast|brunch|dinner|snack|bath|shower|skincare|groom|commute|drive|travel|call|chore|errand)/i

/** Best-guess kind for a new category from its name; user can override in Settings. */
export function inferCategoryKind(name: string): CategoryKind {
  return ESSENTIAL_NAME_RE.test(name) ? 'essential' : 'discretionary'
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order')
    .returns<Category[]>()

  if (error) throw error
  return data
}

export async function createCategory(category: CategoryInsert): Promise<Category> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('categories')
    .insert({ ...category, user_id: category.user_id ?? user.id } as unknown as Record<string, unknown>)
    .select()
    .single<Category>()

  if (error) throw error
  return data
}

export async function updateCategory(id: string, updates: CategoryUpdate): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<Category>()

  if (error) throw error
  return data
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}
