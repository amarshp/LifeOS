// Edge Function: plan-chat
// Conversational day-planner AND in-app agent. Called from the foreground,
// AUTHENTICATED app (verify_jwt ON — default). We resolve the user from their
// JWT, load their categories + planned blocks + open todos as context, then run
// an OpenAI tool-calling loop: the model can inspect and modify the user's REAL
// data (time entries + calendar blocks + backlog todos — always through the
// user-scoped client, so RLS applies) before returning a structured turn: a
// chat `reply`, an optional `plan`, and a list of `actions` it performed.
//
// Deploy: npx supabase functions deploy plan-chat
// Secret:  npx supabase secrets set OPENAI_API_KEY=sk-...

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'gpt-4.1-mini'
const MAX_TOOL_ROUNDS = 5
// Fail fast: a stalled upstream call must never ride into Supabase's 150s
// wall-clock kill (WORKER_RESOURCE_LIMIT) — surface a retryable error instead.
const OPENAI_TIMEOUT_MS = 45_000

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Body {
  date?: string // YYYY-MM-DD (local calendar day to plan)
  messages?: ChatMessage[]
  timezone?: string // IANA tz
  expected_sleep_hours?: number // user's nightly sleep target (Settings)
}

// CORS: the Expo WEB build (localhost dev / testing) calls from a browser and
// needs preflight + explicit allow headers; native apps ignore these.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ─── Local-time helpers (model speaks local clock; DB speaks ISO/UTC) ────────

/** Offset (ms) of `timeZone` from UTC at the given UTC instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(utcMs))
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!m) return 0
  const sign = m[1] === '-' ? -1 : 1
  return sign * ((parseInt(m[2], 10) * 60 + (m[3] ? parseInt(m[3], 10) : 0)) * 60_000)
}

/** "YYYY-MM-DD" + "HH:MM" in `timeZone` → ISO UTC string. */
function localToIso(dateStr: string, hhmm: string, timeZone: string): string {
  const [y, mo, d] = dateStr.split('-').map((n) => parseInt(n, 10))
  const [h, mi] = hhmm.split(':').map((n) => parseInt(n, 10))
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // Two-pass: offset can differ across DST boundaries; second pass converges.
  const off1 = tzOffsetMs(guess, timeZone)
  const off2 = tzOffsetMs(guess - off1, timeZone)
  return new Date(guess - off2).toISOString()
}

/** ISO UTC string → "YYYY-MM-DD HH:MM" rendered in `timeZone`. */
function isoToLocal(iso: string, timeZone: string): string {
  const dt = new Date(iso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return fmt.format(dt).replace(',', '')
}

/** Local date "YYYY-MM-DD" for the current instant in `timeZone`. */
function todayLocal(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(new Date())
}

// ─── Todo recurrence (mirrors src/services/todos.ts semantics) ───────────────

/** Weekday of a "YYYY-MM-DD" date, 0=Mon … 6=Sun (app convention). */
function weekdayOf(dateStr: string): number {
  return (new Date(dateStr + 'T00:00:00Z').getUTCDay() + 6) % 7
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todoOccursOn(recurrence: string, days: number[] | null, anchor: string, target: string): boolean {
  const wd = weekdayOf(target)
  switch (recurrence) {
    case 'daily':
      return true
    case 'weekdays':
      return wd <= 4
    case 'mwf':
      return wd === 0 || wd === 2 || wd === 4
    case 'weekly':
      return wd === weekdayOf(anchor)
    case 'custom':
      return Array.isArray(days) && days.includes(wd)
    default:
      return false
  }
}

/** First date strictly AFTER `after` matching the recurrence (or null). */
function todoNextDueAfter(recurrence: string, days: number[] | null, after: string): string | null {
  if (recurrence === 'none') return null
  for (let i = 1; i <= 14; i++) {
    const d = addDaysStr(after, i)
    if (todoOccursOn(recurrence, days, after, d)) return d
  }
  return null
}

// ─── Structured output contract ───────────────────────────────────────────────

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reply: {
      type: 'string',
      description: 'Conversational reply to the user (questions, suggestions, confirmations).',
    },
    plan: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              start_time: { type: 'string', description: '24h local clock, "HH:MM".' },
              end_time: { type: 'string', description: '24h local clock, "HH:MM".' },
              category_id: {
                type: ['string', 'null'],
                description: 'MUST be one of the provided category ids, or null if none fits.',
              },
              todo_id: {
                type: ['string', 'null'],
                description: 'If this item schedules one of the BACKLOG TASKS, set its todo id; else null. Never invent an id.',
              },
              notes: { type: ['string', 'null'] },
            },
            required: ['title', 'start_time', 'end_time', 'category_id', 'todo_id', 'notes'],
          },
        },
      },
      required: ['title', 'items'],
    },
  },
  required: ['reply', 'plan'],
} as const

// ─── Agent tools (all data access via the user-scoped client → RLS applies) ──

const TIME_ARG_NOTE =
  'Times are LOCAL clock strings: date "YYYY-MM-DD", time "HH:MM" (24h). Omit date → target/today as described.'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_time_entries',
      description:
        `List the user's real tracked time entries for a local date, including any RUNNING timers (end_time null). Use before fixing/backfilling. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'Local date YYYY-MM-DD. Defaults to today.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_timer',
      description:
        `Stop a RUNNING time entry. Provide the real end time if the user said when it actually ended (backfill); omit for "now". ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          end_date: { type: 'string' },
          end_time: { type: 'string' },
        },
        required: ['entry_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_timer',
      description:
        `Start a new RUNNING timer for the user's current activity. Optional backdated start. category_id must be a real category id. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string' },
          title: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
          todo_id: { type: 'string', description: 'If this activity works on a backlog task, its todo id (stopping the timer then completes the task).' },
        },
        required: ['category_id', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_completed_entry',
      description:
        `Insert a finished time entry (backfill a period the user forgot to track). ${TIME_ARG_NOTE} Date defaults to today for both ends; end after start.`,
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string' },
          title: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
          end_date: { type: 'string' },
          end_time: { type: 'string' },
          todo_id: { type: 'string', description: 'If this logged period was a backlog task being done, its todo id — the task is marked done.' },
        },
        required: ['category_id', 'title', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_time_entry',
      description: `Edit an existing entry's times/title/category. Only pass fields to change. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          title: { type: 'string' },
          category_id: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
          end_date: { type: 'string' },
          end_time: { type: 'string' },
        },
        required: ['entry_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_time_entry',
      description: 'Soft-delete a time entry the user says is wrong/duplicate.',
      parameters: {
        type: 'object',
        properties: { entry_id: { type: 'string' } },
        required: ['entry_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_calendar_blocks',
      description: 'List planned schedule blocks for a local date (with ids, for editing).',
      parameters: {
        type: 'object',
        properties: { date: { type: 'string', description: 'Local date YYYY-MM-DD. Defaults to the planning target date.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_calendar_block',
      description:
        `Add ONE schedule block directly (for quick edits: "add a dentist visit at 4"). For building/refining a WHOLE day plan, use the plan field of your reply instead. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          title: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          category_id: { type: 'string' },
          todo_id: { type: 'string', description: 'If the block schedules a backlog task, its todo id.' },
        },
        required: ['date', 'title', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_calendar_block',
      description: `Edit an existing schedule block. Only pass fields to change. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          block_id: { type: 'string' },
          title: { type: 'string' },
          date: { type: 'string', description: 'Block date, needed when changing times.' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          category_id: { type: 'string' },
        },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_calendar_block',
      description: 'Remove a planned schedule block.',
      parameters: {
        type: 'object',
        properties: { block_id: { type: 'string' } },
        required: ['block_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: "List the user's open backlog tasks with their ids (fresh state, including tasks added this conversation).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description:
        'Add a task to the backlog (a timeless to-do, NOT a scheduled block). Use when the user mentions something they need to do ("remind me to…", "I have to… sometime"). Only title is required.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          priority: { type: 'number', description: '0 none · 1 low · 2 medium · 3 high. Default 0.' },
          deadline: { type: 'string', description: 'Local date YYYY-MM-DD, only if the user gave one.' },
          recurrence: { type: 'string', enum: ['none', 'daily', 'weekdays', 'mwf', 'weekly'], description: 'Default none.' },
          category_id: { type: 'string', description: 'A real category id, only if one clearly fits.' },
          notes: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description:
        'Mark a backlog task done (the user says they did it). Recurring tasks roll forward to their next occurrence automatically.',
      parameters: {
        type: 'object',
        properties: { todo_id: { type: 'string' } },
        required: ['todo_id'],
      },
    },
  },
]

interface ToolCtx {
  supabase: SupabaseClient
  tz: string
  targetDate: string
  userId: string
  allowedCategoryIds: Set<string>
  allowedTodoIds: Set<string> // grows when the agent adds a task mid-conversation
  actions: string[]
}

/**
 * Mark a todo done, honoring the recurring-done invariant (recurring todos are
 * never status='done' — they get a completion row + advanced next_due).
 */
async function completeTodoRecord(ctx: ToolCtx, todoId: string): Promise<Record<string, unknown>> {
  const { supabase } = ctx
  const today = todayLocal(ctx.tz)
  const { data: todo, error } = await supabase
    .from('todos')
    .select('id, title, recurrence, recurrence_days, status')
    .eq('id', todoId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!todo) return { error: 'unknown todo_id' }
  if (todo.status !== 'open') return { ok: true, note: 'already done' }
  if (todo.recurrence === 'none') {
    const { error: upErr } = await supabase
      .from('todos')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', todoId)
    if (upErr) return { error: upErr.message }
  } else {
    await supabase
      .from('todo_completions')
      .upsert(
        { todo_id: todoId, completed_on: today, user_id: ctx.userId },
        { onConflict: 'todo_id,completed_on', ignoreDuplicates: true },
      )
    const next = todoNextDueAfter(todo.recurrence, todo.recurrence_days, today)
    const { error: upErr } = await supabase
      .from('todos')
      .update({ next_due: next, updated_at: new Date().toISOString() })
      .eq('id', todoId)
    if (upErr) return { error: upErr.message }
  }
  ctx.actions.push(`Completed task "${todo.title}"`)
  return { ok: true }
}

async function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { supabase, tz } = ctx
  const today = todayLocal(tz)
  const rawStr = (k: string) => (typeof args[k] === 'string' ? (args[k] as string) : undefined)
  // Date args are hallucination-prone; clamp anything further than 3 days from
  // today (or the planning target) back to today.
  const str = (k: string): string | undefined => {
    const v = rawStr(k)
    if (v === undefined || !k.endsWith('date')) return v
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return today
    if (v === ctx.targetDate) return v
    const diff = Math.abs(new Date(v + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime())
    return diff <= 3 * 86_400_000 ? v : today
  }

  switch (name) {
    case 'list_time_entries': {
      const date = str('date') ?? today
      const dayStart = localToIso(date, '00:00', tz)
      const dayEnd = new Date(new Date(dayStart).getTime() + 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('time_entries')
        .select('id, title, category_id, start_time, end_time, is_running')
        .is('deleted_at', null)
        .lt('start_time', dayEnd)
        .or(`end_time.gte.${dayStart},is_running.eq.true`)
        .order('start_time')
      if (error) return { error: error.message }
      return (data ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        category_id: e.category_id,
        start_local: isoToLocal(e.start_time, tz),
        end_local: e.end_time ? isoToLocal(e.end_time, tz) : null,
        is_running: e.is_running,
      }))
    }

    case 'stop_timer': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      const end = str('end_time')
        ? localToIso(str('end_date') ?? today, str('end_time')!, tz)
        : new Date().toISOString()
      const { data, error } = await supabase
        .from('time_entries')
        .update({ is_running: false, end_time: end })
        .eq('id', id)
        .eq('is_running', true)
        .select('id, title, todo_id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Stopped "${data.title}" at ${isoToLocal(end, tz)}`)
      // Entry linked to a task → the task is done (same rule as the app).
      if (data.todo_id) await completeTodoRecord(ctx, data.todo_id as string)
      return { ok: true, stopped_at_local: isoToLocal(end, tz) }
    }

    case 'start_timer': {
      const cat = str('category_id')
      const title = str('title')
      if (!cat || !title) return { error: 'category_id and title required' }
      if (!ctx.allowedCategoryIds.has(cat)) return { error: 'unknown category_id' }
      const todoId = str('todo_id')
      if (todoId && !ctx.allowedTodoIds.has(todoId)) return { error: 'unknown todo_id' }
      // Idempotency guard: a same-titled timer already running is a no-op, so a
      // confused model can't stack duplicates.
      const { data: dup } = await supabase
        .from('time_entries')
        .select('id')
        .eq('is_running', true)
        .eq('title', title)
        .is('deleted_at', null)
        .limit(1)
      if (dup && dup.length > 0) return { ok: true, entry_id: dup[0].id, note: 'already running — no duplicate created' }
      const start = str('start_time')
        ? localToIso(str('start_date') ?? today, str('start_time')!, tz)
        : new Date().toISOString()
      const { data, error } = await supabase
        .from('time_entries')
        .insert({ user_id: ctx.userId, category_id: cat, title, start_time: start, is_running: true, tags: [], todo_id: todoId ?? null })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Started "${title}" at ${isoToLocal(start, tz)}`)
      return { ok: true, entry_id: data.id }
    }

    case 'add_completed_entry': {
      const cat = str('category_id')
      const title = str('title')
      const st = str('start_time')
      const et = str('end_time')
      if (!cat || !title || !st || !et) return { error: 'category_id, title, start_time, end_time required' }
      if (!ctx.allowedCategoryIds.has(cat)) return { error: 'unknown category_id' }
      const todoId = str('todo_id')
      if (todoId && !ctx.allowedTodoIds.has(todoId)) return { error: 'unknown todo_id' }
      const startIso = localToIso(str('start_date') ?? today, st, tz)
      let endIso = localToIso(str('end_date') ?? str('start_date') ?? today, et, tz)
      if (endIso < startIso) {
        // cross-midnight (e.g. sleep 23:15 → 07:45): bump end a day
        endIso = new Date(new Date(endIso).getTime() + 86_400_000).toISOString()
      }
      if (endIso === startIso) return { error: 'zero-length entry rejected' }
      // Idempotency guard: identical title + start already logged → no-op.
      const { data: dup } = await supabase
        .from('time_entries')
        .select('id')
        .eq('title', title)
        .eq('start_time', startIso)
        .is('deleted_at', null)
        .limit(1)
      if (dup && dup.length > 0) return { ok: true, entry_id: dup[0].id, note: 'already logged — no duplicate created' }
      const { data, error } = await supabase
        .from('time_entries')
        .insert({ user_id: ctx.userId, category_id: cat, title, start_time: startIso, end_time: endIso, is_running: false, tags: [], todo_id: todoId ?? null })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Logged "${title}" ${isoToLocal(startIso, tz)} → ${isoToLocal(endIso, tz)}`)
      // Completed period linked to a task → the task is done.
      if (todoId) await completeTodoRecord(ctx, todoId)
      return { ok: true, entry_id: data.id }
    }

    case 'update_time_entry': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      const updates: Record<string, unknown> = {}
      if (str('title')) updates.title = str('title')
      if (str('category_id')) {
        if (!ctx.allowedCategoryIds.has(str('category_id')!)) return { error: 'unknown category_id' }
        updates.category_id = str('category_id')
      }
      if (str('start_time')) updates.start_time = localToIso(str('start_date') ?? today, str('start_time')!, tz)
      if (str('end_time')) {
        updates.end_time = localToIso(str('end_date') ?? today, str('end_time')!, tz)
        updates.is_running = false
      }
      if (Object.keys(updates).length === 0) return { error: 'nothing to update' }
      const { data, error } = await supabase
        .from('time_entries')
        .update(updates)
        .eq('id', id)
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Updated entry "${data.title}"`)
      return { ok: true }
    }

    case 'delete_time_entry': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      const { data, error } = await supabase
        .from('time_entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Deleted entry "${data.title}"`)
      return { ok: true }
    }

    case 'list_calendar_blocks': {
      const date = str('date') ?? ctx.targetDate
      const { data, error } = await supabase
        .from('calendar_blocks')
        .select('id, title, category_id, start_time, end_time')
        .eq('date', date)
        .is('deleted_at', null)
        .order('start_time')
      if (error) return { error: error.message }
      return (data ?? []).map((b) => ({
        id: b.id,
        title: b.title,
        category_id: b.category_id,
        start_local: isoToLocal(b.start_time, tz),
        end_local: isoToLocal(b.end_time, tz),
      }))
    }

    case 'add_calendar_block': {
      const date = str('date')
      const title = str('title')
      const st = str('start_time')
      const et = str('end_time')
      if (!date || !title || !st || !et) return { error: 'date, title, start_time, end_time required' }
      const cat = str('category_id')
      if (cat && !ctx.allowedCategoryIds.has(cat)) return { error: 'unknown category_id' }
      const todoId = str('todo_id')
      if (todoId && !ctx.allowedTodoIds.has(todoId)) return { error: 'unknown todo_id' }
      const startIso = localToIso(date, st, tz)
      let endIso = localToIso(date, et, tz)
      if (endIso <= startIso) endIso = new Date(new Date(endIso).getTime() + 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('calendar_blocks')
        .insert({
          user_id: ctx.userId,
          date,
          title,
          start_time: startIso,
          end_time: endIso,
          category_id: cat ?? null,
          source: 'manual',
          tags: [],
          todo_id: todoId ?? null,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Added block "${title}" on ${date}`)
      return { ok: true, block_id: data.id }
    }

    case 'update_calendar_block': {
      const id = str('block_id')
      if (!id) return { error: 'block_id required' }
      const updates: Record<string, unknown> = {}
      if (str('title')) updates.title = str('title')
      if (str('category_id')) {
        if (!ctx.allowedCategoryIds.has(str('category_id')!)) return { error: 'unknown category_id' }
        updates.category_id = str('category_id')
      }
      const date = str('date') ?? ctx.targetDate
      if (str('start_time')) updates.start_time = localToIso(date, str('start_time')!, tz)
      if (str('end_time')) updates.end_time = localToIso(date, str('end_time')!, tz)
      if (Object.keys(updates).length === 0) return { error: 'nothing to update' }
      const { data, error } = await supabase
        .from('calendar_blocks')
        .update(updates)
        .eq('id', id)
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Updated block "${data.title}"`)
      return { ok: true }
    }

    case 'delete_calendar_block': {
      const id = str('block_id')
      if (!id) return { error: 'block_id required' }
      const { data, error } = await supabase
        .from('calendar_blocks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Removed block "${data.title}"`)
      return { ok: true }
    }

    case 'list_todos': {
      const { data, error } = await supabase
        .from('todos')
        .select('id, title, priority, deadline, next_due, recurrence, category_id')
        .eq('status', 'open')
        .is('deleted_at', null)
        .order('priority', { ascending: false })
      if (error) return { error: error.message }
      return (data ?? []).map((t) => ({
        todo_id: t.id,
        title: t.title,
        priority: t.priority,
        due: t.recurrence !== 'none' ? t.next_due : t.deadline ? String(t.deadline).slice(0, 10) : null,
        recurrence: t.recurrence,
        category_id: t.category_id,
      }))
    }

    case 'add_todo': {
      const title = str('title')
      if (!title) return { error: 'title required' }
      const cat = str('category_id')
      if (cat && !ctx.allowedCategoryIds.has(cat)) return { error: 'unknown category_id' }
      const priorityRaw = typeof args.priority === 'number' ? Math.round(args.priority) : 0
      const priority = Math.min(3, Math.max(0, priorityRaw))
      const recurrence = ['none', 'daily', 'weekdays', 'mwf', 'weekly'].includes(str('recurrence') ?? '')
        ? (str('recurrence') as string)
        : 'none'
      const deadlineDate = rawStr('deadline')
      const deadline =
        recurrence === 'none' && deadlineDate && /^\d{4}-\d{2}-\d{2}$/.test(deadlineDate)
          ? localToIso(deadlineDate, '23:59', tz)
          : null
      const next_due =
        recurrence !== 'none'
          ? todoOccursOn(recurrence, null, today, today)
            ? today
            : todoNextDueAfter(recurrence, null, today)
          : null
      const { data, error } = await supabase
        .from('todos')
        .insert({
          user_id: ctx.userId,
          title,
          category_id: cat ?? null,
          priority,
          deadline,
          recurrence,
          next_due,
          notes: str('notes') ?? null,
          status: 'open',
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.allowedTodoIds.add(data.id as string)
      ctx.actions.push(`Added task "${title}"`)
      return { ok: true, todo_id: data.id }
    }

    case 'complete_todo': {
      const id = str('todo_id')
      if (!id) return { error: 'todo_id required' }
      return await completeTodoRecord(ctx, id)
    }

    default:
      return { error: `unknown tool ${name}` }
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

interface BacklogTodo {
  id: string
  title: string
  priority: number
  deadline: string | null
  next_due: string | null
  recurrence: string
  category_id: string | null
}

const PRIORITY_WORD = ['', 'low', 'medium', 'high']

function buildSystemPrompt(
  date: string,
  timezone: string,
  categories: Array<{ id: string; name: string; kind: string }>,
  existing: Array<{ title: string; start_time: string; end_time: string }>,
  todos: BacklogTodo[],
  expectedSleepHours: number,
): string {
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null
  const catLines = categories.length
    ? categories.map((c) => `- ${c.name} (${c.kind}) → id: ${c.id}`).join('\n')
    : '(none yet)'
  const existingLines = existing.length
    ? existing
        .map((b) => `- ${b.title}: ${b.start_time} → ${b.end_time}`)
        .join('\n')
    : '(nothing planned yet)'
  const todoLines = todos.length
    ? todos
        .map((t) => {
          const parts: string[] = []
          if (t.priority > 0) parts.push(`${PRIORITY_WORD[t.priority]} priority`)
          if (t.recurrence !== 'none') parts.push(`repeats ${t.recurrence}${t.next_due ? `, due ${t.next_due}` : ''}`)
          else if (t.deadline) parts.push(`deadline ${t.deadline.slice(0, 10)}`)
          const cn = catName(t.category_id)
          if (cn) parts.push(cn)
          return `- ${t.title}${parts.length ? ` (${parts.join(', ')})` : ''} → todo_id: ${t.id}`
        })
        .join('\n')
    : '(none)'

  const nowLocal = isoToLocal(new Date().toISOString(), timezone)

  return `You are LifeOS's personal assistant — warm, concise, and practical, like a good chief-of-staff. You plan the user's day through conversation AND you can act on their real data with tools.

CURRENT LOCAL TIME: ${nowLocal} (${timezone})
TARGET DAY BEING PLANNED: ${date}

The user's activity CATEGORIES (use the exact id when assigning an item):
${catLines}

ALREADY PLANNED for ${date} (avoid clashing unless the user wants to change it):
${existingLines}

BACKLOG TASKS the user wants to get done (pull the relevant ones into THIS day's plan, highest priority and nearest deadline first — only as many as realistically fit; leave the rest for another day):
${todoLines}

HOW TO BEHAVE:
- Converse naturally. Ask at most 1–2 sharp clarifying questions when details are missing. Don't interrogate.
- Make proactive suggestions (buffers between meetings, breaks, deep-work blocks, wind-down) but keep the user in control.
- Keep replies short — a few sentences. This may be read aloud by a voice assistant, so write for the ear: no markdown, no bullet symbols, no emoji.

ACTING WITH TOOLS (you are an agent, not just a planner):
- You can list/stop/start/insert/edit/delete the user's REAL tracked time entries and planned schedule blocks. Use tools whenever the user asks you to change something real — don't just talk about it.
- BACKFILL: when the user recounts what actually happened (e.g. "forgot to track: woke at 8, got ready till 8:30, drove till 9, working since"), first call list_time_entries to see the day (there may be a stale RUNNING timer like Sleep). Then: stop the stale timer at its true end, add_completed_entry for each missed period, and start_timer for what they're doing NOW. Chain times so periods touch without gaps or overlaps.
- Each backfilled entry's TITLE must describe that specific activity in the user's words ("Getting ready", "Drive to office") — never reuse the previous activity's title. Pick the closest category for each (commute → Commute, chores/errands/getting ready → Admin or Break); only the sleep period itself goes under Sleep.
- Tool time args: pass times as "HH:MM" exactly as the user said them. OMIT the date fields entirely when the period is today (they default to today). Never invent dates.
- If the LAST recounted activity runs "to now" / "since then" and the user hasn't said it ended, do NOT add_completed_entry for it — instead start_timer with its backdated start_time so it is still running. One continuous entry, not a completed piece plus a new timer.
- Quick schedule edits ("push my call to 3", "add dentist at 4") → use the calendar block tools on the right date.
- TASKS: you manage the user's backlog too. When they mention something they need to do without a fixed time ("remind me to renew my license", "I should call the plumber sometime") → add_todo. When they say they finished a task → complete_todo (plus log the time if they said when). Linking work to tasks: pass todo_id on start_timer / add_completed_entry / add_calendar_block when the activity IS one of the backlog tasks — stopping a linked timer or logging a linked period completes the task automatically.
- Building or reworking the WHOLE day's plan → use the "plan" field of your reply (the user taps Apply), NOT add_calendar_block calls.
- REPLAN FROM NOW: when the target day is today and the user asks to redo/replan the rest of the day, first look at reality (list_time_entries + list_calendar_blocks), then propose a plan that starts AT OR AFTER the current time — never re-emit items for hours that already passed. Apply only replaces planned blocks from now onward; the morning that already happened stays.
- After acting, your reply must state plainly what you changed.
- Never invent ids: only use entry/block/category ids returned by tools or listed above.

THE PLAN FIELD (structured output):
- Set "plan" to null until you have a concrete, useful schedule. Once you do, fill it AND keep refining it on later turns as the user adjusts.
- Every item needs start_time and end_time as 24-hour "HH:MM" local clock times.
- Set category_id to the matching category's id from the list above, or null if nothing fits. Never invent an id.
- Set todo_id whenever an item schedules one of the backlog tasks (including tasks you just added with add_todo) — that links the block to the task so doing it completes the task.
- Cover the meaningful parts of the day in order. Items must not overlap UNLESS the user explicitly wants things in parallel.
- PARALLEL ITEMS: when the user says things run in parallel / at the same time / while doing X, keep BOTH items at their full stated times even though they overlap (e.g. "study 7:30–10, calls 7:30–8 and 8–8:30 in parallel" → Study 19:30–22:00 PLUS Call 1 19:30–20:00 PLUS Call 2 20:00–20:30). Never shrink, split, or shift an item to avoid an overlap the user asked for. At most 2 items may run at any moment.
- SLEEP: the user's nightly sleep target is ${expectedSleepHours} hours. When they mention a bedtime (e.g. "I'll sleep at 11:15 PM"), add a Sleep item starting then and lasting the full ${expectedSleepHours} hours — the end_time will be an early-morning time smaller than the start_time (e.g. 23:15 → 07:45). That is the ONLY item allowed to cross midnight; never cut sleep short at midnight.
- When you include a plan, your "reply" should briefly summarize it and ask if they want changes.`
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'missing authorization' }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  const date = body.date
  const messages = body.messages
  if (!date || !Array.isArray(messages) || messages.length === 0) {
    return json({ error: 'missing date or messages' }, 400)
  }
  const timezone = body.timezone || 'UTC'
  const expectedSleepHours =
    typeof body.expected_sleep_hours === 'number' &&
    body.expected_sleep_hours >= 4 &&
    body.expected_sleep_hours <= 12
      ? body.expected_sleep_hours
      : 8.5

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!url || !anonKey || !openaiKey) return json({ error: 'server misconfigured' }, 500)

  // User-scoped client: RLS applies, so we only ever touch the caller's own rows.
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  const [{ data: categories }, { data: blocks }, { data: todos }] = await Promise.all([
    supabase.from('categories').select('id, name, kind').is('deleted_at', null).order('sort_order'),
    supabase
      .from('calendar_blocks')
      .select('title, start_time, end_time')
      .eq('date', date)
      .is('deleted_at', null)
      .order('start_time'),
    supabase
      .from('todos')
      .select('id, title, priority, deadline, next_due, recurrence, category_id')
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('priority', { ascending: false }),
  ])

  const cats = (categories ?? []) as Array<{ id: string; name: string; kind: string }>
  const allowedIds = new Set(cats.map((c) => c.id))
  const allowedTodoIds = new Set(((todos ?? []) as BacklogTodo[]).map((t) => t.id))
  const system = buildSystemPrompt(
    date,
    timezone,
    cats,
    (blocks ?? []) as Array<{ title: string; start_time: string; end_time: string }>,
    (todos ?? []) as BacklogTodo[],
    expectedSleepHours,
  )

  const ctx: ToolCtx = {
    supabase,
    tz: timezone,
    targetDate: date,
    userId: userData.user.id,
    allowedCategoryIds: allowedIds,
    allowedTodoIds, // same set instance — add_todo grows it, so the final plan filter accepts new tasks
    actions: [],
  }

  // Tool loop: let the model act, feed results back, until it answers.
  // deno-lint-ignore no-explicit-any
  const convo: any[] = [{ role: 'system', content: system }, ...messages]
  let content = ''
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS
    let openaiRes: Response
    try {
      openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.1,
          max_completion_tokens: 2000,
          messages: convo,
          ...(lastRound ? {} : { tools: TOOLS }),
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'plan_turn', strict: true, schema: RESPONSE_SCHEMA },
          },
        }),
      })
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'TimeoutError'
      return json(
        { error: timedOut ? 'The assistant took too long — please try again.' : `openai request failed: ${e instanceof Error ? e.message : String(e)}` },
        502,
      )
    }

    if (!openaiRes.ok) {
      const detail = await openaiRes.text()
      return json({ error: `openai error ${openaiRes.status}`, detail }, 502)
    }

    const completion = await openaiRes.json()
    const msg = completion.choices?.[0]?.message
    if (!msg) return json({ error: 'openai returned no message' }, 502)

    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      convo.push(msg)
      for (const call of msg.tool_calls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function?.arguments ?? '{}')
        } catch {
          /* leave empty */
        }
        const result = await runTool(ctx, call.function?.name ?? '', args)
        convo.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
      }
      continue
    }

    content = msg.content ?? ''
    break
  }

  let parsed: { reply: string; plan: null | { title: string; items: Array<Record<string, unknown>> } }
  try {
    parsed = JSON.parse(content)
  } catch {
    return json({ error: 'model returned non-JSON', content }, 502)
  }

  // Defensive: drop any category_id / todo_id the model hallucinated (RLS-safe sets).
  if (parsed.plan) {
    parsed.plan.items = (parsed.plan.items ?? []).map((it) => {
      const cid = it.category_id
      const tid = it.todo_id
      return {
        ...it,
        category_id: typeof cid === 'string' && allowedIds.has(cid) ? cid : null,
        todo_id: typeof tid === 'string' && allowedTodoIds.has(tid) ? tid : null,
      }
    })
  }

  return json({ reply: parsed.reply, plan: parsed.plan, actions: ctx.actions, model: MODEL })
})
