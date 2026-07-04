import { supabase } from '../lib/supabase'
import * as calendarBlocksService from './calendar-blocks'
import { expandRecurrence } from './calendar-blocks'
import type {
  Todo,
  TodoInsert,
  TodoUpdate,
  TodoStep,
  TodoStepInsert,
  TodoStepUpdate,
  CalendarBlock,
  RecurrenceType,
} from '../types/database'
import { todayStr } from '../lib/date'
import { addLocalDays, resolveLocalRange } from '../lib/time-range'

/**
 * Todos service — backlog of intentions that feed the day planner.
 *
 * RECURRING-DONE INVARIANT (critical): a recurring todo is NEVER set to
 * status='done'. "Done today" = a todo_completions row + next_due advanced to
 * the next occurrence, so it rolls forward and reappears. Setting status='done'
 * would hide it from the open index permanently. Only one-off todos get 'done'.
 */

// ─── Recurrence ──────────────────────────────────────────────
// Reuse calendar-blocks' expandRecurrence engine (same 0=Mon convention,
// daily/weekdays/mwf/weekly/custom rules) by feeding it a minimal block-shaped
// object — avoids a second, divergent recurrence implementation.
function occursOn(
  recurrence: RecurrenceType,
  recurrenceDays: number[] | null,
  anchor: string,
  target: string,
): boolean {
  return expandRecurrence(
    { recurrence, recurrence_days: recurrenceDays, date: anchor, recurrence_end: null } as CalendarBlock,
    target,
  )
}

/** First date strictly AFTER `after` that matches the recurrence (or null). */
export function nextDueAfter(
  recurrence: RecurrenceType,
  recurrenceDays: number[] | null,
  after: string,
): string | null {
  if (recurrence === 'none') return null
  for (let i = 1; i <= 366; i++) {
    const d = addLocalDays(after, i)
    if (occursOn(recurrence, recurrenceDays, after, d)) return d
  }
  return null
}

/** The date a todo is effectively "due": next_due for recurring, else deadline. */
export function todoDueDate(todo: Todo): string | null {
  if (todo.recurrence !== 'none') return todo.next_due
  return todo.deadline ? todo.deadline.slice(0, 10) : null
}

// ─── Todos CRUD ──────────────────────────────────────────────
export async function getOpenTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('status', 'open')
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('sort_order')
    .returns<Todo[]>()
  if (error) throw error
  return data
}

export async function getAllTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('sort_order')
    .returns<Todo[]>()
  if (error) throw error
  return data
}

export async function createTodo(todo: TodoInsert): Promise<Todo> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Seed next_due for recurring todos so they surface as "due".
  const next_due =
    todo.recurrence && todo.recurrence !== 'none'
      ? todo.next_due ??
        (occursOn(todo.recurrence, todo.recurrence_days ?? null, todayStr(), todayStr())
          ? todayStr()
          : nextDueAfter(todo.recurrence, todo.recurrence_days ?? null, todayStr()))
      : null

  const { data, error } = await supabase
    .from('todos')
    .insert({ ...todo, next_due, user_id: user.id } as unknown as Record<string, unknown>)
    .select()
    .single<Todo>()
  if (error) throw error
  return data
}

export async function updateTodo(id: string, updates: TodoUpdate): Promise<Todo> {
  const { data, error } = await supabase
    .from('todos')
    .update({ ...updates, updated_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<Todo>()
  if (error) throw error
  return data
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)
  if (error) throw error
}

/**
 * Mark a todo done. One-off → status='done'. Recurring → record the occurrence
 * (idempotent) and roll next_due forward; status stays 'open' so it reappears.
 */
export async function completeTodo(todo: Todo): Promise<void> {
  if (todo.recurrence === 'none') {
    await updateTodo(todo.id, { status: 'done', completed_at: new Date().toISOString() })
    return
  }
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // "Mark done" means "I did this now" — credit TODAY and advance next_due from
  // today, so a neglected recurring todo (next_due in the past) lands its next
  // occurrence in the future instead of staying overdue after one tap.
  const credited = todayStr()
  await supabase
    .from('todo_completions')
    .upsert(
      { todo_id: todo.id, completed_on: credited, user_id: user.id } as unknown as Record<string, unknown>,
      { onConflict: 'todo_id,completed_on', ignoreDuplicates: true },
    )
  const next = nextDueAfter(todo.recurrence, todo.recurrence_days, credited)
  await updateTodo(todo.id, { next_due: next })
}

/** Undo a one-off completion (used by the undo toast / reopen). */
export async function reopenTodo(id: string): Promise<void> {
  await updateTodo(id, { status: 'open', completed_at: null })
}

/**
 * Complete a todo by id, if it is still open. Used by the auto-complete hook
 * (stopping a time entry linked to a task) — silently no-ops when the todo is
 * already done or gone, so every stop path can call it unconditionally.
 */
export async function completeTodoById(id: string): Promise<void> {
  const { data } = await supabase
    .from('todos')
    .select('*')
    .eq('id', id)
    .eq('status', 'open')
    .is('deleted_at', null)
    .maybeSingle<Todo>()
  if (!data) return
  await completeTodo(data)
}

// Tasks are category-optional (quick add is just a title). Scheduling surfaces
// (blocks, entries) require a category, so category-less tasks fall back to the
// user's first category.
export async function fallbackCategoryId(): Promise<string | null> {
  const { data } = await supabase
    .from('categories')
    .select('id')
    .is('deleted_at', null)
    .order('sort_order')
    .limit(1)
  return data?.[0]?.id ?? null
}

/** Todo ids that already have a block on `date` (so the backlog shows Planned). */
export async function getPlannedTodoIdsForDate(date: string): Promise<string[]> {
  const blocks = await calendarBlocksService.getBlocksForDate(date)
  return blocks.filter((b) => b.todo_id).map((b) => b.todo_id as string)
}

// ─── Steps ───────────────────────────────────────────────────
export async function getStepsForTodos(todoIds: string[]): Promise<TodoStep[]> {
  if (todoIds.length === 0) return []
  const { data, error } = await supabase
    .from('todo_steps')
    .select('*')
    .in('todo_id', todoIds)
    .is('deleted_at', null)
    .order('sort_order')
    .returns<TodoStep[]>()
  if (error) throw error
  return data
}

export async function addStep(step: TodoStepInsert): Promise<TodoStep> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('todo_steps')
    .insert({ ...step, user_id: user.id } as unknown as Record<string, unknown>)
    .select()
    .single<TodoStep>()
  if (error) throw error
  return data
}

export async function updateStep(id: string, updates: TodoStepUpdate): Promise<TodoStep> {
  const { data, error } = await supabase
    .from('todo_steps')
    .update(updates as unknown as Record<string, unknown>)
    .eq('id', id)
    .select()
    .single<TodoStep>()
  if (error) throw error
  return data
}

export async function deleteStep(id: string): Promise<void> {
  const { error } = await supabase
    .from('todo_steps')
    .update({ deleted_at: new Date().toISOString() } as unknown as Record<string, unknown>)
    .eq('id', id)
  if (error) throw error
}
