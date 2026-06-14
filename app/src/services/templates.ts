import { supabase } from '../lib/supabase'
import type {
  WeeklyTemplateBlock,
  WeeklyTemplateBlockInsert,
  WeeklyTemplateBlockUpdate,
} from '../types/database'

export async function getTemplates(): Promise<WeeklyTemplateBlock[]> {
  const { data, error } = await supabase
    .from('weekly_template_blocks')
    .select('*')
    .is('deleted_at', null)
    .order('day_of_week')
    .order('start_time')
    .returns<WeeklyTemplateBlock[]>()

  if (error) throw error
  return data
}

export async function getTemplatesForDay(dayOfWeek: number): Promise<WeeklyTemplateBlock[]> {
  const { data, error } = await supabase
    .from('weekly_template_blocks')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .is('deleted_at', null)
    .order('start_time')
    .returns<WeeklyTemplateBlock[]>()

  if (error) throw error
  return data
}

export async function createTemplate(
  template: WeeklyTemplateBlockInsert
): Promise<WeeklyTemplateBlock> {
  const { data, error } = await supabase
    .from('weekly_template_blocks')
    .insert(template as unknown as Record<string, unknown>)
    .select()
    .single<WeeklyTemplateBlock>()

  if (error) throw error
  return data
}

export async function updateTemplate(
  id: string,
  updates: WeeklyTemplateBlockUpdate
): Promise<WeeklyTemplateBlock> {
  const { data, error } = await supabase
    .from('weekly_template_blocks')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<WeeklyTemplateBlock>()

  if (error) throw error
  return data
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase
    .from('weekly_template_blocks')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)

  if (error) throw error
}
