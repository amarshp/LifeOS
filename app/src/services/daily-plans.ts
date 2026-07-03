import { supabase } from '../lib/supabase'
import type {
  DailyPlan,
  DailyPlanInsert,
  DailyPlanUpdate,
  DailyPlanItem,
  DailyPlanItemInsert,
  DailyPlanItemUpdate,
} from '../types/database'
import * as calendarBlocksService from './calendar-blocks'

/**
 * Daily planning service (OBJECTIVE #7).
 *
 * Foundation for custom + AI-generated day plans. CRUD here is intentionally
 * thin; the extension point for AI generation is the `PlanGenerator` interface
 * + `generateDailyPlan()` hook below — a future Claude.ai integration only has
 * to implement `PlanGenerator`, nothing else in the app changes.
 *
 * Consumed by the Plan tab via `src/services/plan-chat.ts` (conversational AI
 * planner) for the AI path; the manual/template paths reuse the same CRUD.
 */

// ─── Plans ───────────────────────────────────────────────────
export async function getPlansForDate(date: string): Promise<DailyPlan[]> {
  const { data, error } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('date', date)
    .is('deleted_at', null)
    .order('created_at')
    .returns<DailyPlan[]>()
  if (error) throw error
  return data
}

export async function getActivePlanForDate(date: string): Promise<DailyPlan | null> {
  const { data, error } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('date', date)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .returns<DailyPlan[]>()
  if (error) throw error
  return data[0] ?? null
}

export async function createPlan(plan: DailyPlanInsert): Promise<DailyPlan> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('daily_plans')
    .insert({ ...plan, user_id: user.id } as unknown as Record<string, unknown>)
    .select()
    .single<DailyPlan>()
  if (error) throw error
  return data
}

export async function updatePlan(id: string, updates: DailyPlanUpdate): Promise<DailyPlan> {
  const { data, error } = await supabase
    .from('daily_plans')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<DailyPlan>()
  if (error) throw error
  return data
}

export async function deletePlan(id: string): Promise<void> {
  const { error } = await supabase
    .from('daily_plans')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)
  if (error) throw error
}

// ─── Plan items ──────────────────────────────────────────────
export async function getPlanItems(planId: string): Promise<DailyPlanItem[]> {
  const { data, error } = await supabase
    .from('daily_plan_items')
    .select('*')
    .eq('plan_id', planId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('start_time')
    .returns<DailyPlanItem[]>()
  if (error) throw error
  return data
}

export async function addPlanItem(item: DailyPlanItemInsert): Promise<DailyPlanItem> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('daily_plan_items')
    .insert({ ...item, user_id: user.id } as unknown as Record<string, unknown>)
    .select()
    .single<DailyPlanItem>()
  if (error) throw error
  return data
}

export async function updatePlanItem(id: string, updates: DailyPlanItemUpdate): Promise<DailyPlanItem> {
  const { data, error } = await supabase
    .from('daily_plan_items')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<DailyPlanItem>()
  if (error) throw error
  return data
}

export async function deletePlanItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('daily_plan_items')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)
  if (error) throw error
}

/**
 * Materialize a plan's items into live `calendar_blocks` (the "plan" view that
 * Day/Week/Home already render). Items missing a category use
 * `fallbackCategoryId` when given, else are skipped. Returns the count of
 * blocks created. Idempotency / re-materialization is left to a later phase.
 */
export async function materializePlan(
  planId: string,
  date: string,
  fallbackCategoryId?: string | null,
): Promise<number> {
  const items = await getPlanItems(planId)
  let created = 0
  for (const item of items) {
    const categoryId = item.category_id ?? fallbackCategoryId ?? null
    if (!categoryId || item.calendar_block_id) continue
    const block = await calendarBlocksService.createBlock({
      category_id: categoryId,
      title: item.title,
      date,
      start_time: item.start_time,
      end_time: item.end_time,
      tags: item.tags,
      notes: item.notes,
      todo_id: item.todo_id,
    })
    await updatePlanItem(item.id, { calendar_block_id: block.id })
    created++
  }
  return created
}

// ─── AI generation extension point ───────────────────────────

/** Input handed to a plan generator. Stable contract for future integrations. */
export interface PlanGenerationInput {
  date: string
  prompt: string
  /** Optional free-form context (existing blocks, preferences, energy windows…). */
  context?: Record<string, unknown>
}

/** A proposed plan, source-agnostic. Maps cleanly onto DailyPlan + items. */
export interface GeneratedPlan {
  title?: string
  model?: string
  generationMeta?: Record<string, unknown>
  items: Array<{
    title: string
    start_time: string
    end_time: string
    category_id?: string | null
    tags?: string[]
    notes?: string | null
  }>
}

/**
 * Pluggable generator. A future Claude.ai integration implements this single
 * interface; nothing else in the app needs to change.
 */
export interface PlanGenerator {
  generate(input: PlanGenerationInput): Promise<GeneratedPlan>
}

let registeredGenerator: PlanGenerator | null = null

/** Register the active plan generator (e.g. a Claude-backed one) at startup. */
export function setPlanGenerator(generator: PlanGenerator | null): void {
  registeredGenerator = generator
}

/**
 * Generate an AI day plan and persist it as a `draft` `daily_plan` + items.
 * Throws if no generator is registered — wire one via `setPlanGenerator`.
 */
export async function generateDailyPlan(input: PlanGenerationInput): Promise<DailyPlan> {
  if (!registeredGenerator) {
    throw new Error('No plan generator registered. Call setPlanGenerator() first.')
  }
  const generated = await registeredGenerator.generate(input)

  const plan = await createPlan({
    date: input.date,
    source: 'ai',
    status: 'draft',
    title: generated.title ?? null,
    prompt: input.prompt,
    model: generated.model ?? null,
    generation_meta: generated.generationMeta ?? {},
    generated_at: new Date().toISOString(),
  })

  let sortOrder = 0
  for (const item of generated.items) {
    await addPlanItem({
      plan_id: plan.id,
      category_id: item.category_id ?? null,
      title: item.title,
      start_time: item.start_time,
      end_time: item.end_time,
      tags: item.tags ?? [],
      notes: item.notes ?? null,
      sort_order: sortOrder++,
    })
  }

  return plan
}
