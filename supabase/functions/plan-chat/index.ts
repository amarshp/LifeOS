// Edge Function: plan-chat
// Conversational day-planner AND in-app agent. Called from the foreground,
// AUTHENTICATED app (verify_jwt ON — default). We resolve the user from their
// JWT, load their categories + planned blocks + open todos as context, then run
// an OpenAI tool-calling loop: the model can inspect and modify the user's REAL
// data (time entries + calendar blocks + backlog todos — always through the
// user-scoped client, so RLS applies) before returning a structured turn: a
// chat `reply`, an optional `plan`, and a list of `actions` it performed.
//
// The turn (tool calls + persisting the conversation to chat_sessions) runs
// inside EdgeRuntime.waitUntil, so backgrounding the app mid-turn — which kills
// the client's side of the SSE connection — doesn't kill the turn: actions still
// commit and the reply still gets saved, even though the client never saw it land.
//
// Deploy: npx supabase functions deploy plan-chat
// Secret:  npx supabase secrets set OPENAI_API_KEY=sk-...

// Global provided by the Supabase Edge Runtime at execution time — not part of
// Deno's own lib, so it needs a local type hint (no runtime effect).
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void }

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  computeSleepEvidence,
  computeWorkoutEvidence,
  computeDurationEvidence,
  computeOfficeModeToday,
  isNapWindow,
  type OfficeModeToday,
} from '../_shared/wellness-evidence.ts'
import { describeOpenAIError } from '../_shared/openai-errors.ts'

const MODEL = 'gpt-5.1'
// Reasoning effort for gpt-5.x: 'low' keeps latency inside OPENAI_TIMEOUT_MS
// while still beating non-reasoning models on multi-step backfill/replan.
const REASONING_EFFORT = 'low'
const MAX_TOOL_ROUNDS = 5
// Fail fast: a stalled upstream call must never ride into Supabase's 150s
// wall-clock kill (WORKER_RESOURCE_LIMIT) — surface a retryable error instead.
const OPENAI_TIMEOUT_MS = 45_000

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** ISO timestamp of when a user message was sent (client clock). Absent on
   *  assistant messages and on messages predating this field. */
  at?: string
}

interface Body {
  date?: string // YYYY-MM-DD (local calendar day to plan)
  messages?: ChatMessage[]
  timezone?: string // IANA tz
  expected_sleep_hours?: number // user's nightly sleep target (Settings)
  stream?: boolean // true → Server-Sent Events (live step progress) instead of one JSON blob
  session_id?: string // existing chat_sessions row to append to; omitted → a new session is created
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

// ─── Agent tools (all data access via the user-scoped client → RLS applies) ──

const TIME_ARG_NOTE =
  'Times are LOCAL clock strings: date "YYYY-MM-DD", time "HH:MM" (24h). Omit date → target/today as described.'

// Agent-created entries used to always get tags: [] — no way for the model to
// tag them at all — while user-typed/voice entries (enrich-capture) reliably
// carry a "gym" tag. That gap is why a real gym session logged by the agent
// with a descriptive title ("Gym – upper body...") was silently invisible to
// every gym-frequency/gym-gap query on the server, which key off this tag.
const TAGS_ARG_NOTE =
  'Lowercase tags, mirroring how manually-logged entries are tagged. For a GYM session specifically, always include "gym" as a tag (plus a workout-type tag if named — one of push/pull/legs/upper/lower/full-body/boxing/run/hyrox/rest, never a synonym) even if the title is more descriptive. This is what lets Pulse and the gym-gap nudge recognize the session.'

// A planned block's title and its later tracked entry get shown side by side
// (Home "next", Insights Plan Drift) with no link required to be recognized as
// the same thing — so if the model titles the plan "Office work – focused
// block" but the user just types "Work" when they actually do it, a fully
// honoured plan visually reads as missed/off-plan even though the underlying
// match (by category + time overlap) is correct. Keep titles as plain as the
// user's own words.
const TITLE_ARG_NOTE =
  'Keep the title close to the user\'s own words for the activity — do not invent a fuller or more formal-sounding phrasing ("work" → "Work", not "Office work – focused block"; "gym" → "Gym", not an invented workout description). A vague one-word activity stays vague; add detail only when the user\'s own words already carried it, or via the tags field where instructed — never by padding the title with words the user never said.'

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_time_entries',
      description:
        `List the user's real tracked time entries for a local date, including any RUNNING timers (end_time null). Returns { entries, gaps, recently_removed } where gaps is the deterministically-computed list of uncovered spans (≥10 min) between entries — trust it, do not re-derive gaps by eyeballing entry times — and recently_removed lists entries soft-deleted in the last 7 days that overlap this date (e.g. auto-trimmed because a later backfill's window covered them). If the user says something was overridden/erased/lost, check recently_removed before saying it's unrecoverable — restore_time_entry brings one back exactly as it was. Use before fixing/backfilling. ${TIME_ARG_NOTE}`,
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
        `Start a new RUNNING timer for the user's current activity. Any previously running timer is stopped automatically at the new start time (atomic switch). Optional backdated start. category_id must be a real category id. ${TIME_ARG_NOTE} ${TITLE_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string' },
          title: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: `${TAGS_ARG_NOTE}` },
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
        `Insert a finished time entry (backfill a period the user forgot to track). ${TIME_ARG_NOTE} Date defaults to today for both ends; end after start. ${TITLE_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          category_id: { type: 'string' },
          title: { type: 'string' },
          start_date: { type: 'string' },
          start_time: { type: 'string' },
          end_date: { type: 'string' },
          end_time: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' }, description: `${TAGS_ARG_NOTE}` },
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
      name: 'restore_time_entry',
      description: 'Undo a soft-delete — brings back an entry from list_time_entries\' recently_removed list (same title/category/start time). Use when the user disputes an override/erasure and the entry shows up there. If it was still running when removed, it comes back as COMPLETED, ending at the moment it was removed — not resumed as running (something else may be running now). Call start_timer separately if the user actually wants to resume it.',
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
        `Add ONE schedule block directly (for quick edits: "add a dentist visit at 4"). For building/refining a WHOLE day plan, call propose_plan instead. ${TIME_ARG_NOTE} ${TITLE_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          title: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          category_id: { type: 'string' },
          todo_id: { type: 'string', description: 'If the block schedules a backlog task, its todo id.' },
          flexibility: { type: 'string', enum: ['fixed', 'flexible', 'protected'], description: 'fixed for appointments/meetings; protected for sleep/meals/routines; default flexible.' },
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
          kind: {
            type: 'string',
            enum: ['commitment', 'flexible', 'reminder', 'someday'],
            description: 'commitment = promise/deadline involving another person · reminder = date-bound one-minute action · someday = keep but not for now · default flexible.',
          },
          notes: { type: 'string' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'log_feedback',
      description:
        'Log a bug report or improvement idea about the LifeOS app itself into the dev notes ("the notification time is wrong", "I wish the timer did X"). The developer assistant reads these later. Log it AND still answer the user normally.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One-line summary of the bug/idea.' },
          detail: { type: 'string', description: "The user's words plus any context worth keeping." },
          kind: { type: 'string', enum: ['bug', 'idea'], description: 'Default bug.' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_feedback',
      description: 'List open dev notes (bugs/ideas already logged) when the user asks what has been reported.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Save a durable fact about the user (profile fact, routine, preference). ONLY when the user explicitly tells you to remember something, or explicitly confirms your "should I remember this?" question — never silently.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact, in one plain sentence.' },
          kind: { type: 'string', enum: ['profile', 'routine', 'preference', 'fact'], description: 'Default fact.' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forget_memory',
      description: 'Delete a saved memory the user says is wrong or should be forgotten. Use the memory id from MEMORIES.',
      parameters: {
        type: 'object',
        properties: { memory_id: { type: 'string' } },
        required: ['memory_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_journal',
      description:
        "Save (or update) the day's journal entry after an evening review: a factual summary of the tracked day plus the user's answers. One entry per day.",
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Local date YYYY-MM-DD. Defaults to today.' },
          summary: { type: 'string', description: 'Short factual summary of what actually happened (from the timeline).' },
          answers: { type: 'string', description: 'JSON object of question → user answer from the review, if any.' },
        },
        required: ['summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reminders',
      description: "List the user's upcoming one-off reminders (with ids, for cancelling).",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_reminder',
      description:
        `Schedule a one-off phone notification at an exact moment ("remind me to call mom at 5"). NOT for backlog tasks (add_todo) or schedule blocks (add_calendar_block) — only for a ping at a time. ${TIME_ARG_NOTE}`,
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          fire_date: { type: 'string', description: 'Local date YYYY-MM-DD. Defaults to today.' },
          fire_time: { type: 'string', description: 'Local 24h "HH:MM". Required.' },
          body: { type: 'string', description: 'Optional extra line shown under the title.' },
        },
        required: ['title', 'fire_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_reminder',
      description: 'Cancel an upcoming reminder the user no longer wants.',
      parameters: {
        type: 'object',
        properties: { reminder_id: { type: 'string' } },
        required: ['reminder_id'],
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
  {
    type: 'function',
    function: {
      name: 'propose_plan',
      description:
        "Show the user a concrete schedule for the target date — the proposal card they can Apply. Call this whenever you have a full or partial day plan to show, on the FIRST draft and on every later refinement. Do NOT call it on turns where you're just chatting or answering a question with no new/changed schedule — the plan you last proposed stays on screen untouched until you call this again.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
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
                  description: 'If this item schedules one of the BACKLOG TASKS, its todo id; else null. Never invent an id.',
                },
                flexibility: {
                  type: 'string',
                  enum: ['fixed', 'flexible', 'protected'],
                  description: 'fixed = appointment/meeting (never move without asking) · protected = sleep/meals/routines (move only with callout) · flexible = everything else.',
                },
                notes: { type: ['string', 'null'] },
              },
              required: ['title', 'start_time', 'end_time', 'category_id', 'todo_id', 'flexibility', 'notes'],
            },
          },
        },
        required: ['title', 'items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_plan',
      description: 'Remove the currently proposed plan card (the user asked to scrap it / start over). Does not touch calendar blocks already Applied — only the not-yet-applied proposal.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the live web for something you cannot know from training data alone — current events, prices, weather, sports results, "what time does X open today", or anything time-sensitive. Returns a short grounded answer. Do not use it for anything answerable from general knowledge or from the user\'s own LifeOS data (use the other tools for that).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'A focused search query, not the user\'s raw message.' } },
        required: ['query'],
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
  // Read-before-write: entry/block mutations only accept ids the model has
  // actually seen this conversation (from list_* results or its own creates),
  // so a hallucinated id can never hit someone's real row.
  allowedEntryIds: Set<string>
  allowedBlockIds: Set<string>
  allowedReminderIds: Set<string>
  allowedMemoryIds: Set<string>
  allowParallel: boolean // user_settings.allow_parallel_timers (default false)
  actions: string[]
  // Set by start_timer when it creates a live entry, so the handler can fire an
  // APNs push-to-start AFTER the tool loop (a backgrounded/closed app can't start
  // a Live Activity locally — the push is the only way the card appears).
  startedEntry?: { id: string; title: string; startMs: number }
  // undefined = untouched this turn (client keeps whatever plan it already has),
  // null = explicitly cleared (clear_plan), object = proposed/revised this turn.
  // Set by propose_plan/clear_plan; JSON.stringify drops the key entirely when
  // undefined, which is exactly the "untouched" signal the client relies on.
  plan?: { title: string; items: Array<Record<string, unknown>> } | null
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

/**
 * ONE REALITY: with parallel timers off, the [startIso, endIso) window being
 * (re)inserted is the truth for that span — trim/split/remove whatever else
 * covers it (completed or running) instead of leaving a hidden overlap.
 * Shared by add_completed_entry (new period) and restore_time_entry (a period
 * coming back from a soft-delete) — either way, something else may since have
 * claimed the time and needs to make room the same way.
 */
async function resolveOneRealityOverlap(ctx: ToolCtx, startIso: string, endIso: string): Promise<void> {
  const { supabase, tz } = ctx
  if (ctx.allowParallel) return
  const nowIso2 = new Date().toISOString()
  const { data: overlaps } = await supabase
    .from('time_entries')
    .select('id, title, category_id, start_time, end_time, is_running, tags, todo_id')
    .is('deleted_at', null)
    .lt('start_time', endIso)
    .or(`end_time.gt.${startIso},is_running.eq.true`)
  for (const o of overlaps ?? []) {
    const oStart = o.start_time as string
    const oEnd = (o.end_time as string | null) ?? nowIso2
    if (oEnd <= startIso) continue // touching, not overlapping
    if (oStart < startIso && oEnd > endIso) {
      // Spans the whole window → split around it.
      await supabase.from('time_entries').update({ end_time: startIso, is_running: false }).eq('id', o.id)
      await supabase.from('time_entries').insert({
        user_id: ctx.userId, category_id: o.category_id, title: o.title,
        start_time: endIso, end_time: o.is_running ? null : oEnd,
        is_running: o.is_running === true, tags: o.tags ?? [], todo_id: o.todo_id ?? null,
        source: 'agent',
      })
      ctx.actions.push(`Split "${o.title}" around the logged period`)
    } else if (oStart < startIso) {
      await supabase.from('time_entries').update({ end_time: startIso, is_running: false }).eq('id', o.id)
      // An interrupted RUNNING activity resumes after the backfill.
      if (o.is_running && endIso <= nowIso2) {
        await supabase.from('time_entries').insert({
          user_id: ctx.userId, category_id: o.category_id, title: o.title,
          start_time: endIso, is_running: true, tags: o.tags ?? [], todo_id: o.todo_id ?? null,
          source: 'agent',
        })
        ctx.actions.push(`Trimmed "${o.title}" to ${isoToLocal(startIso, tz)} and resumed it after`)
      } else {
        ctx.actions.push(`Trimmed "${o.title}" to end ${isoToLocal(startIso, tz)}`)
      }
    } else if (oEnd > endIso) {
      await supabase.from('time_entries').update({ start_time: endIso }).eq('id', o.id)
      ctx.actions.push(`Moved "${o.title}" to start ${isoToLocal(endIso, tz)}`)
    } else {
      await supabase.from('time_entries').update({ deleted_at: nowIso2, is_running: false }).eq('id', o.id)
      ctx.actions.push(`Removed "${o.title}" (covered by the logged period)`)
    }
  }
}

const WEB_SEARCH_TIMEOUT_MS = 15_000

// Isolated hand-off, not a main-loop swap: gpt-4o-search-preview rejects the
// `tools` parameter entirely (confirmed against OpenAI's own docs/community
// reports), so it can't replace gpt-5.1 mid-conversation without silently
// dropping every other tool. Instead this is a completely separate
// Chat Completions call — gpt-5.1 keeps all 20 other tools; only this one
// sub-request goes to the search-capable model, and its answer comes back
// as a normal tool result.
async function webSearchViaGpt(query: string, openaiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-search-preview',
      messages: [{ role: 'user', content: query }],
    }),
  })
  if (!res.ok) throw new Error(`web search failed (${res.status})`)
  const data = await res.json()
  const answer = data.choices?.[0]?.message?.content
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('web search returned no answer')
  return answer.trim()
}

async function runTool(ctx: ToolCtx, name: string, args: Record<string, unknown>, openaiKey: string): Promise<unknown> {
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
  const strArr = (k: string): string[] =>
    Array.isArray(args[k]) ? (args[k] as unknown[]).filter((v): v is string => typeof v === 'string') : []

  // A call like add_completed_entry/start_timer can trim/split/move/remove
  // OTHER entries as a side effect (one-reality overlap resolution, atomic
  // switch) — those only ever got pushed to ctx.actions, which is exposed to
  // the UI's ✓ chips but was NEVER part of what's returned to the model here.
  // The model was composing its reply blind to its own side effects and
  // narrating stale (pre-side-effect) state — a confirmed real failure, not
  // hypothetical. Capture this call's slice of ctx.actions and hand it back.
  const actionsBefore = ctx.actions.length
  const result = await (async (): Promise<unknown> => {
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
      for (const e of data ?? []) ctx.allowedEntryIds.add(e.id as string)
      const rows = (data ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        category_id: e.category_id,
        start_local: isoToLocal(e.start_time, tz),
        end_local: e.end_time ? isoToLocal(e.end_time, tz) : null,
        is_running: e.is_running,
      }))
      // Entries another action recently soft-deleted (e.g. an add_completed_entry
      // whose window covered them) — surfaced so the model can actually recover
      // them via restore_time_entry instead of telling the user they're gone.
      const recentCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data: removedData } = await supabase
        .from('time_entries')
        .select('id, title, category_id, start_time, end_time, deleted_at')
        .not('deleted_at', 'is', null)
        .gt('deleted_at', recentCutoff)
        .lt('start_time', dayEnd)
        .or(`end_time.gt.${dayStart},end_time.is.null`)
        .order('start_time')
      for (const e of removedData ?? []) ctx.allowedEntryIds.add(e.id as string)
      const recentlyRemoved = (removedData ?? []).map((e) => ({
        id: e.id,
        title: e.title,
        category_id: e.category_id,
        start_local: isoToLocal(e.start_time, tz),
        end_local: e.end_time ? isoToLocal(e.end_time as string, tz) : null,
        removed_at_local: isoToLocal(e.deleted_at as string, tz),
      }))
      // Deterministic gap detection: interior uncovered spans between entries.
      // The model must not eyeball adjacency across many rows — it misses gaps
      // (esp. sleep→next boundaries). We hand it the holes directly.
      const GAP_MIN_MS = 10 * 60_000
      const nowMs = Date.now()
      const spans = (data ?? [])
        .map((e) => ({
          start: new Date(e.start_time as string).getTime(),
          end: e.end_time ? new Date(e.end_time as string).getTime() : nowMs,
        }))
        .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
        .sort((a, b) => a.start - b.start)
      const gaps: { start_local: string; end_local: string; minutes: number }[] = []
      let cursor = spans.length ? spans[0].end : 0
      for (let i = 1; i < spans.length; i++) {
        if (spans[i].start - cursor >= GAP_MIN_MS) {
          gaps.push({
            start_local: isoToLocal(new Date(cursor).toISOString(), tz),
            end_local: isoToLocal(new Date(spans[i].start).toISOString(), tz),
            minutes: Math.round((spans[i].start - cursor) / 60_000),
          })
        }
        if (spans[i].end > cursor) cursor = spans[i].end
      }
      return { entries: rows, gaps, recently_removed: recentlyRemoved }
    }

    case 'stop_timer': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      if (!ctx.allowedEntryIds.has(id)) return { error: 'unknown entry_id — call list_time_entries first' }
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
      // Atomic switch: one current activity. Any still-running timer is stopped
      // at the new timer's start (clean handoff, gap-free timeline). Backfill
      // flows should still stop stale timers at their TRUE end first — this is
      // the safety net, not the primary path. Skipped when the user has
      // parallel timers enabled (the DB trigger caps at 2 in that mode).
      const { data: running } = ctx.allowParallel
        ? { data: [] as Array<{ id: string; title: string; todo_id: string | null; start_time: string }> }
        : await supabase
            .from('time_entries')
            .select('id, title, todo_id, start_time')
            .eq('is_running', true)
            .is('deleted_at', null)
      for (const r of running ?? []) {
        // Stop at the new timer's start; if that predates the running entry,
        // fall back to now; a future-dated running entry (bad earlier backfill)
        // collapses to zero length rather than going negative.
        const nowIso = new Date().toISOString()
        const rStart = r.start_time as string
        const end = start > rStart ? start : nowIso > rStart ? nowIso : rStart
        // Sub-minute switched-away timers are mis-speaks — discard, don't keep dust.
        if (new Date(end).getTime() - new Date(rStart).getTime() < 60_000) {
          await supabase.from('time_entries').delete().eq('id', r.id)
          continue
        }
        const { error: stopErr } = await supabase
          .from('time_entries')
          .update({ is_running: false, end_time: end })
          .eq('id', r.id)
          .eq('is_running', true)
        if (stopErr) return { error: `could not stop running "${r.title}": ${stopErr.message}` }
        ctx.actions.push(`Stopped "${r.title}" at ${isoToLocal(end, tz)} (switched)`)
        if (r.todo_id) await completeTodoRecord(ctx, r.todo_id as string)
      }
      const { data, error } = await supabase
        .from('time_entries')
        .insert({ user_id: ctx.userId, category_id: cat, title, start_time: start, is_running: true, tags: strArr('tags'), todo_id: todoId ?? null, source: 'agent' })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.allowedEntryIds.add(data.id as string)
      ctx.actions.push(`Started "${title}" at ${isoToLocal(start, tz)}`)
      // Remember the live entry so the handler can push-to-start its Live Activity
      // after the loop. Overwrite on repeated starts — only the last one is running.
      ctx.startedEntry = { id: data.id as string, title, startMs: Date.parse(start) }
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

      await resolveOneRealityOverlap(ctx, startIso, endIso)

      const { data, error } = await supabase
        .from('time_entries')
        .insert({ user_id: ctx.userId, category_id: cat, title, start_time: startIso, end_time: endIso, is_running: false, tags: strArr('tags'), todo_id: todoId ?? null, source: 'agent' })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.allowedEntryIds.add(data.id as string)
      ctx.actions.push(`Logged "${title}" ${isoToLocal(startIso, tz)} → ${isoToLocal(endIso, tz)}`)
      // Completed period linked to a task → the task is done.
      if (todoId) await completeTodoRecord(ctx, todoId)
      return { ok: true, entry_id: data.id }
    }

    case 'update_time_entry': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      if (!ctx.allowedEntryIds.has(id)) return { error: 'unknown entry_id — call list_time_entries first' }
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

      let oldStart: string | undefined
      if (typeof updates.start_time === 'string') {
        const { data: oldRow } = await supabase.from('time_entries').select('start_time').eq('id', id).single()
        oldStart = oldRow?.start_time as string | undefined
      }

      const { data, error } = await supabase
        .from('time_entries')
        .update(updates)
        .eq('id', id)
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Updated entry "${data.title}"`)

      // Only touch the neighbor once this edit is confirmed committed —
      // extending it first risked leaving that mutation stranded if this update failed.
      if (oldStart && typeof updates.start_time === 'string' && oldStart !== updates.start_time) {
        const { data: prev } = await supabase
          .from('time_entries')
          .select('id, title, start_time')
          .eq('user_id', ctx.userId)
          .eq('end_time', oldStart)
          .is('deleted_at', null)
          .neq('id', id)
          .limit(1)
          .maybeSingle()
        if (prev && (prev.start_time as string) < (updates.start_time as string)) {
          await supabase.from('time_entries').update({ end_time: updates.start_time }).eq('id', prev.id)
          ctx.actions.push(`Extended "${prev.title}" to ${isoToLocal(updates.start_time as string, tz)} to stay contiguous`)
        }
      }
      return { ok: true }
    }

    case 'delete_time_entry': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      if (!ctx.allowedEntryIds.has(id)) return { error: 'unknown entry_id — call list_time_entries first' }
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

    case 'restore_time_entry': {
      const id = str('entry_id')
      if (!id) return { error: 'entry_id required' }
      if (!ctx.allowedEntryIds.has(id)) return { error: 'unknown entry_id — call list_time_entries first' }
      const { data: row, error: fetchErr } = await supabase
        .from('time_entries')
        .select('id, title, start_time, end_time, deleted_at')
        .eq('id', id)
        .not('deleted_at', 'is', null)
        .single()
      if (fetchErr || !row) return { error: 'entry is not a recent soft-delete — call list_time_entries first' }
      // It was running (end_time null) when removed — "now" has moved on since,
      // and whatever else is running today owns that status. Restoring it as
      // still-open-ended would put two "running" entries in a single-timer
      // account. Close it at the moment it was removed instead — a completed
      // period, not a resumed timer. (Explicitly resuming it is a separate,
      // deliberate action, not something a restore should do implicitly.)
      const restoredEnd = (row.end_time as string | null) ?? (row.deleted_at as string)
      // Whatever now sits in this window (e.g. the very entry that swallowed
      // it) needs to make room, same as a fresh backfill would — otherwise the
      // restored period just overlaps it instead of actually undoing anything.
      await resolveOneRealityOverlap(ctx, row.start_time as string, restoredEnd)
      const { data, error } = await supabase
        .from('time_entries')
        .update({ deleted_at: null, end_time: restoredEnd, is_running: false })
        .eq('id', id)
        .select('id, title, start_time, end_time')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Restored "${data.title}" ${isoToLocal(data.start_time as string, tz)} → ${isoToLocal(data.end_time as string, tz)}`)
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
      for (const b of data ?? []) ctx.allowedBlockIds.add(b.id as string)
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
      const flex = ['fixed', 'flexible', 'protected'].includes(str('flexibility') ?? '') ? str('flexibility')! : 'flexible'
      // Idempotency: same title at the same start on the same date → no duplicate
      // (mirrors start_timer / add_reminder). A re-issued "add" after the user says
      // "fix it" must not stack a second copy of the block.
      {
        const { data: dup } = await supabase
          .from('calendar_blocks')
          .select('id')
          .eq('user_id', ctx.userId)
          .eq('date', date)
          .eq('title', title)
          .eq('start_time', startIso)
          .is('deleted_at', null)
          .limit(1)
        if (dup && dup.length > 0) {
          ctx.allowedBlockIds.add(dup[0].id as string)
          return { ok: true, block_id: dup[0].id, note: 'already scheduled — no duplicate created' }
        }
      }
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
          flexibility: flex,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.allowedBlockIds.add(data.id as string)
      ctx.actions.push(`Added block "${title}" on ${date}`)
      return { ok: true, block_id: data.id }
    }

    case 'update_calendar_block': {
      const id = str('block_id')
      if (!id) return { error: 'block_id required' }
      if (!ctx.allowedBlockIds.has(id)) return { error: 'unknown block_id — call list_calendar_blocks first' }
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
      if (!ctx.allowedBlockIds.has(id)) return { error: 'unknown block_id — call list_calendar_blocks first' }
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
      const kind = ['commitment', 'flexible', 'reminder', 'someday'].includes(str('kind') ?? '') ? str('kind')! : 'flexible'
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
          kind,
          source: 'agent',
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

    case 'log_feedback': {
      const title = str('title')
      if (!title) return { error: 'title required' }
      const kind = str('kind') === 'idea' ? 'idea' : 'bug'
      // Idempotency: same open title → no duplicate.
      const { data: dup } = await supabase
        .from('dev_notes')
        .select('id')
        .eq('title', title)
        .eq('status', 'open')
        .limit(1)
      if (dup && dup.length > 0) return { ok: true, note: 'already logged' }
      const { error } = await supabase
        .from('dev_notes')
        .insert({ user_id: ctx.userId, kind, title, detail: rawStr('detail') ?? null })
      if (error) return { error: error.message }
      ctx.actions.push(`Noted ${kind}: ${title}`)
      return { ok: true }
    }

    case 'list_feedback': {
      const { data, error } = await supabase
        .from('dev_notes')
        .select('kind, title, detail, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) return { error: error.message }
      return (data ?? []).map((n) => ({ kind: n.kind, title: n.title, detail: n.detail, logged: isoToLocal(n.created_at, tz) }))
    }

    case 'save_memory': {
      const content = str('content')
      if (!content) return { error: 'content required' }
      const kind = ['profile', 'routine', 'preference', 'fact'].includes(str('kind') ?? '') ? str('kind')! : 'fact'
      // Idempotency: identical live memory → refresh confirmation instead.
      const { data: dup } = await supabase
        .from('agent_memories')
        .select('id')
        .eq('content', content)
        .is('deleted_at', null)
        .limit(1)
      if (dup && dup.length > 0) {
        await supabase.from('agent_memories').update({ last_confirmed_at: new Date().toISOString() }).eq('id', dup[0].id)
        return { ok: true, memory_id: dup[0].id, note: 'already remembered — confirmation refreshed' }
      }
      const { data, error } = await supabase
        .from('agent_memories')
        .insert({ user_id: ctx.userId, content, kind, source: 'agent' })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Remembered: ${content}`)
      return { ok: true, memory_id: data.id }
    }

    case 'forget_memory': {
      const id = str('memory_id')
      if (!id) return { error: 'memory_id required' }
      if (!ctx.allowedMemoryIds.has(id)) return { error: 'unknown memory_id — only ids listed in MEMORIES' }
      const { data, error } = await supabase
        .from('agent_memories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select('content')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Forgot: ${data.content}`)
      return { ok: true }
    }

    case 'save_journal': {
      const summary = str('summary')
      if (!summary) return { error: 'summary required' }
      const date = str('date') ?? today
      let answers: unknown = null
      const rawAnswers = rawStr('answers')
      if (rawAnswers) {
        try { answers = JSON.parse(rawAnswers) } catch { answers = { note: rawAnswers } }
      }
      const { error } = await supabase
        .from('journal_entries')
        .upsert(
          { user_id: ctx.userId, date, summary, answers, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,date' },
        )
      if (error) return { error: error.message }
      ctx.actions.push(`Journal saved for ${date}`)
      return { ok: true }
    }

    case 'list_reminders': {
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .select('id, fire_at, title, body')
        .eq('status', 'pending')
        .gte('fire_at', new Date().toISOString())
        .order('fire_at')
      if (error) return { error: error.message }
      for (const r of data ?? []) ctx.allowedReminderIds.add(r.id as string)
      return (data ?? []).map((r) => ({
        reminder_id: r.id,
        fire_local: isoToLocal(r.fire_at, tz),
        title: r.title,
        body: r.body,
      }))
    }

    case 'add_reminder': {
      const title = str('title')
      const time = str('fire_time')
      if (!title || !time) return { error: 'title and fire_time required' }
      if (!/^\d{1,2}:\d{2}$/.test(time)) return { error: 'fire_time must be "HH:MM" 24h' }
      const fireIso = localToIso(str('fire_date') ?? today, time, tz)
      if (fireIso <= new Date().toISOString()) return { error: 'reminder time is in the past' }
      // Idempotency: identical pending reminder → no duplicate.
      const { data: dup } = await supabase
        .from('scheduled_notifications')
        .select('id')
        .eq('status', 'pending')
        .eq('title', title)
        .eq('fire_at', fireIso)
        .limit(1)
      if (dup && dup.length > 0) return { ok: true, reminder_id: dup[0].id, note: 'already scheduled' }
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .insert({ user_id: ctx.userId, source: 'agent', fire_at: fireIso, title, body: str('body') ?? null })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.allowedReminderIds.add(data.id as string)
      ctx.actions.push(`Reminder "${title}" set for ${isoToLocal(fireIso, tz)}`)
      return { ok: true, reminder_id: data.id }
    }

    case 'cancel_reminder': {
      const id = str('reminder_id')
      if (!id) return { error: 'reminder_id required' }
      if (!ctx.allowedReminderIds.has(id)) return { error: 'unknown reminder_id — call list_reminders first' }
      const { data, error } = await supabase
        .from('scheduled_notifications')
        .update({ status: 'cancelled' })
        .eq('id', id)
        .eq('status', 'pending')
        .select('id, title')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push(`Cancelled reminder "${data.title}"`)
      return { ok: true }
    }

    case 'propose_plan': {
      const title = rawStr('title') ?? ''
      const rawItems = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : []
      const HHMM = /^\d{1,2}:\d{2}$/
      const FLEXIBILITY = new Set(['fixed', 'flexible', 'protected'])
      const items = rawItems
        .filter((it) => HHMM.test(String(it.start_time ?? '')) && HHMM.test(String(it.end_time ?? '')))
        .map((it) => {
          const cid = it.category_id
          const tid = it.todo_id
          return {
            title: typeof it.title === 'string' ? it.title : '',
            start_time: it.start_time as string,
            end_time: it.end_time as string,
            category_id: typeof cid === 'string' && ctx.allowedCategoryIds.has(cid) ? cid : null,
            todo_id: typeof tid === 'string' && ctx.allowedTodoIds.has(tid) ? tid : null,
            flexibility: typeof it.flexibility === 'string' && FLEXIBILITY.has(it.flexibility) ? it.flexibility : 'flexible',
            notes: typeof it.notes === 'string' ? it.notes : null,
          }
        })
      // Every item failed the HH:MM check — don't replace a good plan (or show
      // an empty one) with junk; let the model see the failure and retry.
      if (rawItems.length > 0 && items.length === 0) {
        return { error: 'every item was missing a valid start_time/end_time ("HH:MM") — retry with real times' }
      }
      ctx.plan = { title, items }
      return { ok: true, item_count: items.length }
    }

    case 'clear_plan': {
      ctx.plan = null
      return { ok: true }
    }

    case 'web_search': {
      const query = str('query')
      if (!query) return { error: 'query required' }
      // A length cap was tried here as a leak backstop and reverted: length
      // doesn't distinguish "leaked private data" from "legitimately long
      // query" (a quoted error message, an address, a document title) — it
      // just blocked real searches without reliably catching the thing it
      // was meant to catch. The prompt's explicit instruction not to search
      // the user's own LifeOS data is the actual safeguard; gpt-5.1 already
      // has all of that data in its own context regardless of this tool.
      // Passive backstop instead: log every query server-side (Edge Function
      // logs, not a DB table — nothing user-visible, nothing new to secure) so
      // a leak is reviewable after the fact via `supabase functions logs
      // plan-chat`, without blocking or degrading legitimate searches.
      console.log(`[web_search] user=${ctx.userId} query=${JSON.stringify(query)}`)
      try {
        const answer = await webSearchViaGpt(query, openaiKey)
        return { ok: true, answer }
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    }

    default:
      return { error: `unknown tool ${name}` }
  }
  })()

  // Side effects (stop/trim/split/delete on OTHER entries) are already
  // committed by the time we get here, even if the primary op below them
  // then fails (e.g. add_completed_entry's overlap loop mutates other rows
  // before its own insert, which can still error). Attach db_changes
  // regardless of success/error — an error result that hides a real mutation
  // is worse than a success result that hides one (Codex catch).
  const sideEffects = ctx.actions.slice(actionsBefore)
  if (sideEffects.length > 0 && result && typeof result === 'object') {
    return { ...result, db_changes: sideEffects }
  }
  return result
}

// ─── Plan preferences (User Plan Preferences, 2026-08-18) ────────────────────

interface PlanPrefsSettings {
  wake_ideal_time: string | null
  wake_acceptable_time: string | null
  wake_lastresort_time: string | null
  coffee_cutoff_time: string | null
  melatonin_time: string | null
  weekend_wake_flex_min: number
  sunlight_after_wake: boolean
  nap_cap_min: number
  nap_cutoff_time: string | null
  gym_cutoff_time: string | null
}

const clockLabel = (t: string | null) => (t ? t.slice(0, 5) : null)

/** Formats the day's office mode + wake-tier + sleep-rule preferences as prompt text. */
function buildPreferencesBlock(settings: PlanPrefsSettings | null, office: OfficeModeToday, dow: string, dateStr: string): string {
  const lines: string[] = []
  if (office.mode === 'holiday') lines.push(`Today (${dow} ${dateStr}) is a holiday — ${office.holidayName}. No office commute needed.`)
  else if (office.mode) lines.push(`Today (${dow} ${dateStr}) is a ${office.mode.toUpperCase()} day per his stated office schedule.`)

  if (!settings) return lines.join('\n') || '(no preferences set)'

  const ideal = clockLabel(settings.wake_ideal_time)
  const ok = clockLabel(settings.wake_acceptable_time)
  const last = clockLabel(settings.wake_lastresort_time)
  if (ideal || ok || last) {
    lines.push(
      `Wake-time tiers for office days: IDEAL ${ideal ?? '?'} (on time, no traffic, time for breakfast) — this is the target, not one option among equals. ACCEPTABLE ${ok ?? '?'} (reaches right as breakfast window ends, more traffic — not for regular use). LAST RESORT ${last ?? '?'} (no breakfast, full traffic, late to office) — meant to be RARE; if the evidence snapshot's wake times show he's landing here repeatedly, say so plainly rather than quietly planning around it as normal.`,
    )
  }

  const rules: string[] = []
  const coffee = clockLabel(settings.coffee_cutoff_time)
  if (coffee) rules.push(`no coffee after ${coffee}`)
  const mel = clockLabel(settings.melatonin_time)
  if (mel) rules.push(`melatonin ~${mel}`)
  rules.push(`consistent wake time, weekends flexed by up to ${settings.weekend_wake_flex_min}min`)
  if (settings.sunlight_after_wake) rules.push('sunlight after waking')
  const napCutoff = clockLabel(settings.nap_cutoff_time)
  rules.push(`naps ≤${settings.nap_cap_min}min${napCutoff ? `, only before ${napCutoff}` : ''}`)
  const gymCutoff = clockLabel(settings.gym_cutoff_time)
  if (gymCutoff) rules.push(`gym finished before ${gymCutoff} so there's time to eat and digest before bed`)
  lines.push(`Sleep rules (his own, stated as complete): ${rules.join('; ')}.`)

  return lines.join('\n')
}

// ─── Evidence snapshot (deterministic, computed from real data) ──────────────

/**
 * Read-only context the planner should reason from: last-7-day tracked hours
 * per category, sleep pattern, and today's coverage. Deterministic numbers —
 * the model interprets them, it never invents them.
 */
async function buildEvidenceSnapshot(
  supabase: SupabaseClient,
  userId: string,
  tz: string,
  catName: (id: string | null) => string | null,
  idealWakeTime: string | null,
): Promise<string> {
  const nowMs = Date.now()
  const sinceIso = new Date(nowMs - 7 * 86_400_000).toISOString()

  const [{ data: entries }, sleepEv, workoutEv, durationStats] = await Promise.all([
    supabase
      .from('time_entries')
      .select('category_id, title, start_time, end_time, is_running')
      .is('deleted_at', null)
      .gte('start_time', sinceIso)
      .order('start_time'),
    computeSleepEvidence(supabase, userId, tz, catName, undefined, idealWakeTime),
    computeWorkoutEvidence(supabase, userId),
    computeDurationEvidence(supabase, userId),
  ])
  // Do NOT early-return here even if `entries` is empty — a quiet week (no
  // tracking at all) is exactly when the gym-gap signal from `workoutEv`
  // (queried with no 7-day floor) matters most and must still be reported.
  const today = todayLocal(tz)
  const yesterday = addDaysStr(today, -1)
  const catMs = new Map<string, number>()
  let todayMs = 0
  let yesterdayMs = 0

  for (const e of entries ?? []) {
    const startMs = new Date(e.start_time as string).getTime()
    const endMs = e.end_time ? new Date(e.end_time as string).getTime() : nowMs
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue
    const durMs = Math.min(endMs, nowMs) - startMs
    const name = catName(e.category_id as string | null) ?? 'Other'
    catMs.set(name, (catMs.get(name) ?? 0) + durMs)
    const endLocalDate = isoToLocal(new Date(Math.min(endMs, nowMs)).toISOString(), tz).slice(0, 10)
    if (endLocalDate === today) todayMs += durMs
    if (endLocalDate === yesterday) yesterdayMs += durMs
  }

  const h = (ms: number) => (ms / 3_600_000).toFixed(1)
  const catLine =
    [...catMs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, ms]) => `${name} ${h(ms)}h`)
      .join(', ') || '(nothing tracked)'

  const sleepLine = sleepEv.nightsLogged
    ? `sleep logged ${sleepEv.nightsLogged} night(s), avg ${sleepEv.avgH!.toFixed(1)}h/night, target ~${sleepEv.targetH!.toFixed(1)}h (own rolling avg, clamped 7-9h)${
        sleepEv.debtH! > 0.5 ? `, running ~${sleepEv.debtH!.toFixed(1)}h short of target over these nights` : ''
      }. Typical wake ~${sleepEv.recWakeClock} → derived bedtime for target ~${sleepEv.recBedClock}.`
    : 'no sleep entries logged in the last 7 days'

  // Workout rotation: last logged session per canonical type, and any-type gap
  // (the sharper, adherence-critical signal — see PLANNING_MODE_SPEC.md §4).
  // No editorial annotation on daysSinceAny (e.g. a specific "comeback odds"
  // curve) — an independent re-derivation from the raw Hevy export did not
  // reproduce the cited curve (not even its shape), so that precision isn't
  // trustworthy enough to assert as fact here. Report the plain count and let
  // the model's own reasoning (with its hedging rules) do the framing.
  const gymLine =
    workoutEv.daysSinceAny === null
      ? 'no gym sessions logged (ever, or at least in recent history)'
      : `Days since any gym session: ${workoutEv.daysSinceAny}. By type: ${
          workoutEv.byType.length ? workoutEv.byType.map((t) => `${t.type} ${t.days}d`).join(', ') : '(no tagged sessions yet)'
        }.${
          workoutEv.mostOverdueEligible
            ? ` Most overdue eligible type: ${workoutEv.mostOverdueEligible.type} (${workoutEv.mostOverdueEligible.days}d since last).`
            : workoutEv.byType.length
              ? ' No type is past its recovery threshold yet.'
              : ''
        }`

  // Nap window: only surfaced as a POSSIBILITY when in-window and debt is real
  // — the model still decides whether to raise it. Snap to 20min or 90min if used.
  const napLine = isNapWindow(tz)
    ? 'Current local time is within the typical post-lunch nap window (13:00-16:00) — if elevated sleep debt supports it, a nap should be ~20min (quick) or ~90min (full cycle), never in between, and not so close to bedtime it cuts into tonight\'s sleep.'
    : null

  // Typical durations (60-day median) — ground propose_plan's block-time
  // guesses in his own routine instead of generic estimates.
  const durationLine = durationStats.length
    ? `Typical durations (last 60 days, median): ${durationStats.map((s) => `${s.label} ~${Math.round(s.medianMin)}min (n=${s.sampleCount})`).join(', ')}.`
    : null

  return [
    `Tracked last 7 days: ${catLine}.`,
    `Sleep: ${sleepLine}`,
    `Workout rotation: ${gymLine}`,
    `Yesterday total tracked: ${h(yesterdayMs)}h. Today so far: ${h(todayMs)}h.`,
    ...(napLine ? [napLine] : []),
    ...(durationLine ? [durationLine] : []),
  ].join('\n')
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
  kind: string
}

const PRIORITY_WORD = ['', 'low', 'medium', 'high']

function buildSystemPrompt(
  date: string,
  timezone: string,
  categories: Array<{ id: string; name: string; kind: string }>,
  existing: Array<{ title: string; start_time: string; end_time: string; flexibility?: string }>,
  todos: BacklogTodo[],
  expectedSleepHours: number,
  evidenceSnapshot: string,
  memories: Array<{ id: string; kind: string; content: string; pinned: boolean }>,
  yesterdayJournal: string | null,
  currentState: string,
  preferences: string,
): string {
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? null
  const catLines = categories.length
    ? categories.map((c) => `- ${c.name} (${c.kind}) → id: ${c.id}`).join('\n')
    : '(none yet)'
  const existingLines = existing.length
    ? existing
        .map((b) => `- ${b.title}: ${b.start_time} → ${b.end_time}${b.flexibility && b.flexibility !== 'flexible' ? ` [${b.flexibility.toUpperCase()}]` : ''}`)
        .join('\n')
    : '(nothing planned yet)'
  const todoLines = todos.length
    ? todos
        .map((t) => {
          const parts: string[] = []
          if (t.kind !== 'flexible') parts.push(t.kind.toUpperCase())
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
  const todayDate = todayLocal(timezone)
  const yesterdayDate = addDaysStr(todayDate, -1)
  const DOW = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const todayDow = DOW[weekdayOf(todayDate)]
  // Concrete weekday→date map for the next 8 days so the model never has to
  // infer a date from a bare weekday name (it gets this wrong — see Tuesday/Friday
  // slips). "next <weekday>" always means the nearest FUTURE occurrence listed here.
  const upcomingDays = Array.from({ length: 8 }, (_, i) => {
    const d = addDaysStr(todayDate, i)
    const label = i === 0 ? 'today' : i === 1 ? 'tomorrow' : DOW[weekdayOf(d)]
    return `- ${DOW[weekdayOf(d)]} ${d}${i <= 1 ? ` (${label})` : ''}`
  }).join('\n')

  return `You are LifeOS's personal assistant — warm, concise, and practical, like a good chief-of-staff. You plan the user's day through conversation AND you can act on their real data with tools.

CURRENT LOCAL TIME: ${nowLocal}, ${todayDow} (${timezone})
TODAY'S DATE: ${todayDate} (${todayDow})
YESTERDAY'S DATE: ${yesterdayDate}
TARGET DAY BEING PLANNED: ${date}

UPCOMING DAYS (resolve any weekday the user names to the exact date here — never guess a weekday's date):
${upcomingDays}

The user's activity CATEGORIES (use the exact id when assigning an item):
${catLines}

ALREADY PLANNED for ${date} (avoid clashing unless the user wants to change it):
${existingLines}

BACKLOG TASKS the user wants to get done (pull the relevant ones into THIS day's plan, highest priority and nearest deadline first — only as many as realistically fit; leave the rest for another day):
${todoLines}

CURRENT STATE (most recent tracked entries, newest first — what the user is doing and where they plausibly are RIGHT NOW):
${currentState}

PREFERENCES (Amarsh's stated rules — respect these as constraints, not just context, and push back if a request or plan conflicts with one rather than silently complying):
${preferences}

EVIDENCE SNAPSHOT (deterministic, computed from the user's real tracked data — interpret it, never contradict it, and cite the window when you use it, e.g. "over the last 7 days"):
${evidenceSnapshot}

MEMORIES (durable facts the user let you keep — use them, don't re-ask; forget_memory removes one by id):
${memories.length ? memories.map((m) => `- [${m.kind}${m.pinned ? ' · pinned' : ''}] ${m.content} → memory_id: ${m.id}`).join('\n') : '(none yet)'}

YESTERDAY'S JOURNAL:
${yesterdayJournal ?? '(none)'}

MEMORY RULES:
- SAVE PROACTIVELY, THEN SAY SO: when the user states a durable fact or lasting preference about themselves, their routine, or how they want you to work ("I hate early meetings", "always protect my gym time", "my standup is daily at 10"), call save_memory on your own — you do NOT need to ask first. But you MUST name each save in your reply so it's visible ("Saved: you want gym time protected") and the user can correct or drop it.
- Do NOT save one-off, transient, or task-specific details (today's to-dos, a single appointment, passing context) — memory is for facts that stay true across days. When unsure whether something is durable, save it and mention it rather than interrogating.
- The user can always say "forget that" → forget_memory. When a memory contradicts what the user now says, trust the user: forget the old one and save the new one, and say you did.

EVENING REVIEW (when the user asks to review/journal the day):
1. list_time_entries for the day and write a 2–3 sentence factual summary.
2. Point out ONE meaningful deviation from the plan, if any.
3. Ask at most THREE short adaptive questions (rotate topics — energy 1–5, what caused the biggest deviation, one domain-specific follow-up like workout type; do not ask about every domain every day).
4. save_journal with the summary and their answers.
5. Keep it under two minutes of the user's time.

SEMANTICS:
- A user message prefixed like "[2026-08-30 15:40] ..." carries the exact moment they sent it — treat that as ground truth for computing exact times, durations, or splitting a logged block (e.g. "finished chapter 1" at one timestamp, "finished chapter 2" at a later one). Messages with no such prefix predate this feature — for those, ask for the time as you would today.
- Block flexibility: [FIXED] = appointment/meeting — never move or drop it in a plan without asking. [PROTECTED] = sleep/meals/important routines — move only within reason and explicitly call out the compromise. Unmarked = flexible, you may move it in a replan.
- Task kinds: COMMITMENT = a promise involving another person or a hard deadline — a finalized plan must schedule it, explicitly defer it (say so), or get the user's ok to skip it; never silently omit it. REMINDER = a one-minute date-bound action — surface it, give it a tiny slot or a reminder, not a big block. SOMEDAY = keep out of today unless asked. Set kind on add_todo from the user's language.
- Set flexibility on every plan item: meetings/appointments the user stated → fixed; sleep/meals → protected; else flexible.

HOW TO BEHAVE:
- Converse naturally. Ask at most 1–2 sharp clarifying questions when details are missing. Don't interrogate.
- Make proactive suggestions (buffers between meetings, breaks, deep-work blocks, wind-down) but keep the user in control.
- Keep replies short — a few sentences. This may be read aloud by a voice assistant, so write for the ear: no markdown, no bullet symbols, no emoji.
- BALANCED LIFE, EVIDENCE-DRIVEN: the user has explicitly asked to be nudged when the EVIDENCE SNAPSHOT shows he's overreaching — he knows he gets too aggressive with work and lets sleep/gym slip, and wants you to catch it, not just accommodate it. When the snapshot shows a real signal (elevated sleep debt, a gym gap past its threshold, a nap window with real debt behind it), don't just silently fold it into the schedule — SAY it, plainly, citing the number ("you're ~2h short on sleep over the last week" / "it's been 4 days since a gym session"). If the signal is ambiguous rather than clear (e.g. borderline nap window), ask ONE direct question instead of guessing ("are you feeling sleepy right now, or good to push on?") rather than silently assuming.
- WHEN SIGNALS STACK, BE BLUNT: if sleep debt, gym gap, and the user's own stated intent all point the same direction (e.g. he wants to "just work" while sleep has been bad AND the gym gap is past threshold), say so directly and recommend the corrective action plainly (e.g. "you're behind on sleep and it's been a while since the gym — I'd take today as a rest/recover day and protect sleep, not push more work") rather than hedging it into a soft suggestion. He has said he wants this — don't soften it into disappearing.
- SLEEP EVIDENCE IS NOT A REASON TO SKIP THE GYM ON ITS OWN: his own tracked data shows one bad night does not measurably hurt next-day performance — a single rough night is not grounds to suggest skipping the gym. Only SUSTAINED multi-day sleep debt, or the gym gap itself, are grounds for a rest-day suggestion.
- ALWAYS SHOW YOUR REASONING: whenever the EVIDENCE SNAPSHOT or PREFERENCES drives a suggestion, directive, or block placement, say which specific number or rule drove it, not just the conclusion ("legs 5d since last, past its 3-day threshold — that's why legs" not just "let's do legs"; "lunch at 45min, matches your usual" not silence). This is what makes the plan look intentional rather than arbitrary — he should be able to tell WHY each placement is where it is, not just what it is. Keep it to the reasoning that actually mattered for THIS plan, not a footnote on every block.
- PREFERENCE CONFLICTS — DON'T SILENTLY COMPLY: if a request conflicts with a stated PREFERENCE (scheduling gym after his cutoff, coffee past his cutoff, a nap over his cap or after its cutoff, picking the LAST RESORT wake tier when nothing forces it) or contradicts the day's office/WFH/holiday mode, name the conflict and the rule before proceeding ("that's past your gym cutoff of 21:00 — still want it there, or should I move it earlier?"). Proceed anyway if he confirms — this is a flag, not a block, same as [PROTECTED] blocks above. Don't re-flag something he already just overrode in this same conversation.
- USE HISTORICAL DURATIONS, NOT GENERIC GUESSES: when the EVIDENCE SNAPSHOT has a typical duration for lunch/commute/getting-ready/walk, use that as the default block length instead of a round-number guess, and say so briefly if it's a meaningfully different guess than he might expect ("commute ~30min based on your recent trips").
- DIRECT MEASUREMENTS vs BEHAVIORAL CORRELATIONS — treat these differently: a direct count (days since last session, hours slept, sleep debt) is a fact, state it plainly. A correlation about WHICH ACTIVITY CHOICE predicts an outcome (e.g. "sessions tagged X tend to be followed by longer gaps than sessions tagged Y") is a much weaker claim — it is easily confounded by WHY he chose that activity that day (e.g. he reaches for a shorter/different session specifically because he's already busy or short on time — the business causes both the choice and the gap, the choice itself may not). Never state a behavioral correlation as if it were a causal rule ("full-body days cause you to disappear") — at most mention it as a loose pattern worth being aware of, and only when directly relevant, never as the sole grounds for a directive.

GENERAL RESEARCH EVIDENCE (tier 1 — population-level science, kept separate from his own tracked
data above; when you use this, say "general research says" or similar — never blend it into his
personal numbers as if it were the same kind of claim. Full sourcing/confidence tags in
research/*.md at the repo root):
- Wind-down: 30-60 min screen-free before bed, inside a broader ~3h dimmer-light window, is the
  standard recommendation — a reasonable default, not a precise dose-response number.
- Caffeine: ~100mg is fine up to ~4h before bed; larger doses (~400mg) need 8-12h; 8-10h is a safe
  generic cutoff if the dose isn't known.
- Alcohol: disrupts sleep architecture (less REM, more fragmented sleep later in the night) even
  at low doses, even though it can speed up sleep onset — no dose actually improves overall sleep
  quality despite how it feels in the moment.
- Naps: ~20min or a full ~90min cycle are the safe lengths; 30-60min risks grogginess (sleep
  inertia); best taken before ~3pm to avoid delaying that night's sleep.
- Sleep debt: a single bad night recovers within a few days. But weekend catch-up sleep does NOT
  fully reverse debt built up over many days — it restores mood, not objective cognitive/metabolic
  performance. Frame this as "prevent the buildup," never "you can always catch up later."
- Exercise-before-bed: a ≥4h buffer is safe at any intensity; high-intensity exercise ending ≤1h
  before bed can impair sleep onset.
- Same-muscle recovery: for a trained lifter, current research points to roughly a 36-48h floor,
  shorter than commonly assumed — the coded thresholds are in wellness-evidence.ts's
  RECOVERY_DAYS, treat those as the source of truth for actual gym-gap math, this is just the
  general-knowledge backing for it.
- Detraining is forgiving: ~2 weeks off costs a trained lifter little to no strength; real decline
  more realistically starts around 3-5 weeks off.
- Overtraining: no single day or single marker is diagnostic — normal training fatigue by itself
  is never a reason to suggest backing off. Only a real pattern (roughly 2+ concurrent signals —
  declining trend, subjective fatigue, a measurable performance drop — sustained 1-2+ weeks) is
  grounds for a deload suggestion.
- Bryan Johnson's Blueprint protocol: usable ONLY as a source for broadly-supported principles
  (a fixed sleep schedule, morning light exposure, avoiding late meals/caffeine/alcohol, movement
  breaks after sitting). Never cite his specific numbers as evidence-backed defaults — 300mcg
  nightly melatonin, an 8:30pm bedtime, HBOT/red-light-glasses, chasing a "100 sleep score," or
  daily zero-rest-day training are his own N=1 self-experimentation, and several are explicitly
  contested by sleep/exercise scientists (a perfect sleep score is flagged as orthosomnia-inducing;
  zero-rest-day training runs well past where research shows resistance-training benefit peaks).

ACTING WITH TOOLS (you are an agent, not just a planner):
- You can list/stop/start/insert/edit/delete the user's REAL tracked time entries and planned schedule blocks. Use tools whenever the user asks you to change something real — don't just talk about it.
- SWITCH: when the user says they are NOW doing something different ("taking a coffee break", "starting lunch", "back to office work"), just call start_timer for the new activity — the previous timer is stopped automatically at that instant. Do NOT ask how long it will take, and do NOT call stop_timer first for a simple switch. (For BACKFILL, still stop stale timers at their TRUE historical end before adding entries — the auto-stop uses the new start time, which is wrong for a timer that really ended hours ago.) SWITCH IS NOT THE WHOLE MESSAGE if it also recounts what the RUNNING timer actually was ("I actually wasn't doing X, I was doing Y" / "I was working, not resting") — that recount is a SEPARATE required edit, not flavor text you can drop. In that case, BEFORE calling start_timer for the new activity: call update_time_entry on the (about-to-be-switched) running entry to correct its title/category to what it really was. Only after that edit succeeds do you call start_timer for what's happening now. See COMPOUND CORRECTION below for the full worked pattern — this is the same case, and skipping the update step is a confirmed real failure that has already happened once.
- BACKFILL: when the user recounts what actually happened (e.g. "forgot to track: woke at 8, got ready till 8:30, drove till 9, working since"), first call list_time_entries to see the day (there may be a stale RUNNING timer like Sleep or a very-old running entry from a prior day — check its start_local). Then: stop the stale timer at its true end, add_completed_entry for each missed period, and start_timer for what they're doing NOW. Chain times so periods touch without gaps or overlaps.
- BACKFILL FILLS GAPS, IT NEVER SWALLOWS ALREADY-LOGGED TIME: add_completed_entry silently trims/deletes ANY existing entry it overlaps — including a real, correctly-logged Lunch/errand/call the user tracked separately earlier. Before writing a backfill spanning more than a few minutes, look at the entries list_time_entries already returned for that window. If one or more already-logged entries sit inside the recounted span, do NOT add_completed_entry across the whole span — call it once per actual empty sub-period (the "gaps" array is the exact boundaries), so the existing entries are left untouched. This is exactly what "backfill the gaps" means when the user says it explicitly. Only ever cover an existing entry with a new one when the user is explicitly correcting it ("that wasn't lunch, I was on a call") — never because one blanket entry is simpler to write.
- ALWAYS CLOSE GAPS AFTER BACKFILL: the moment you finish writing a backfill, call list_time_entries again and read its "gaps" array. If it is non-empty, you MUST proactively raise it in the SAME reply — do not wait for the user to notice. Name each gap with its clock window ("there's still 08:42–09:00 open") and ask what they were doing then, in one concise question covering all gaps. Only report the day as complete once a fresh list_time_entries returns gaps: []. Never end a backfill turn silently leaving gaps unaddressed.
- Each backfilled entry's TITLE must describe that specific activity in the user's words ("Getting ready", "Drive to office") — never reuse the previous activity's title. Pick the closest category for each (commute → Commute, chores/errands/getting ready → Admin or Break); only the sleep period itself goes under Sleep.
- Tool time args: pass times as "HH:MM" exactly as the user said them. ALWAYS pass explicit start_date/end_date — do not rely on the "defaults to today" omission for any backfilled period once the narrative involves more than a few recent hours; get it wrong and every activity silently lands on the wrong calendar day. Never invent dates — only use TODAY'S DATE, YESTERDAY'S DATE, a date from the UPCOMING DAYS map (for future events the user names by weekday), or a date returned by list_time_entries/list_calendar_blocks.
- BACKFILL ACROSS MIDNIGHT: a single recounted stretch often spans TWO calendar days (e.g. "left office 6:30 yesterday ... worked till 1am ... slept ... woke today at 8"). Find the sleep period first — it is the hinge. Every activity BEFORE that sleep period happened on YESTERDAY'S DATE; every activity from waking onward happened on TODAY'S DATE. An activity that itself crosses midnight (e.g. "worked on a project till 1am") gets start_date=YESTERDAY'S DATE and end_date=TODAY'S DATE on the SAME call — never split one continuous activity into two entries just because the clock rolled over. Do not default anything before the sleep hinge to today's date.
  Worked example — TODAY'S DATE 2026-07-03, YESTERDAY'S DATE 2026-07-02, user says "I left office at 6:30pm yesterday, got home by 7, had dinner till 8, then worked on a side project until 1am, slept, woke up today at 8am, and I've been doing office work since":
    1. list_time_entries → finds a stale Office timer still running from yesterday morning.
    2. stop_timer(office_id, end_date="2026-07-02", end_time="18:30")
    3. add_completed_entry(title="Commute home", start_date="2026-07-02", start_time="18:30", end_date="2026-07-02", end_time="19:00", category=Commute)
    4. add_completed_entry(title="Dinner", start_date="2026-07-02", start_time="19:00", end_date="2026-07-02", end_time="20:00", category=Break)
    5. add_completed_entry(title="Side project", start_date="2026-07-02", start_time="20:00", end_date="2026-07-03", end_time="01:00", category=Study) — note end_date flips to TODAY'S DATE because this one activity itself crosses midnight.
    6. add_completed_entry(title="Sleep", start_date="2026-07-03", start_time="01:00", end_date="2026-07-03", end_time="08:00", category=Sleep)
    7. start_timer(title="Office work", start_date="2026-07-03", start_time="08:00", category=Office)
- If the LAST recounted activity runs "to now" / "since then" and the user hasn't said it ended, do NOT add_completed_entry for it — instead start_timer with its backdated start_time so it is still running. One continuous entry, not a completed piece plus a new timer.
- MID-ACTIVITY CORRECTIONS ("the last 20 minutes I was actually on a call"): just add_completed_entry for the recounted period — do NOT stop the running timer first. With single-timer mode on, the overlap is trimmed automatically and an interrupted running activity resumes after the period. Then report exactly what got trimmed/resumed.
- COMPOUND CORRECTION ("I actually wasn't doing X, I was doing Y, and I'm starting Z now"): this is TWO separate edits, done in this order, and you MUST call the tool for each before saying it happened — do not describe the recount in your reply until update_time_entry/add_completed_entry for it has actually returned success (see NEVER CLAIM AN ACTION YOU DIDN'T TAKE below; this exact pattern — narrating a retime the tool loop never ran — is a confirmed real failure, not hypothetical). (1) Fix the mislabeled past period: update_time_entry (or add_completed_entry if it wasn't logged at all) with the corrected title/end_time for Y. (2) THEN start_timer for Z. Before step 2, call list_time_entries if there's any chance an entry titled Z already exists nearby (e.g. from an earlier turn) — starting a same-titled timer without checking is how a real duplicate/overlapping entry gets created that the user then has to spot and report.
- Quick schedule edits ("push my call to 3", "add dentist at 4") → use the calendar block tools on the right date.
- TASKS: you manage the user's backlog too. When they mention something they need to do without a fixed time ("remind me to renew my license", "I should call the plumber sometime") → add_todo. When they say they finished a task → complete_todo (plus log the time if they said when). Linking work to tasks: pass todo_id on start_timer / add_completed_entry / add_calendar_block when the activity IS one of the backlog tasks — stopping a linked timer or logging a linked period completes the task automatically.
- DATED COMMITMENT → BLOCK, NEVER TODO: if the user gives a specific day AND time ("Monday 6–7:30 PM interview", "Tuesday 6pm system design round", "Sunday 7pm meet Bharadwaj") it is a scheduled event — resolve the weekday to its date via UPCOMING DAYS and call add_calendar_block (flexibility fixed) on that date. Do NOT put a day+time commitment into the backlog with add_todo. Only genuinely timeless items ("sometime", "eventually", no day) go to add_todo. If several commitments come in one message, add_calendar_block for each on its correct date.
- NAMED EVENT, NO TIME GIVEN — TWO SEPARATE STEPS, IN ORDER: (1) ALWAYS call add_todo for it first — this step is unconditional, never skip it no matter what step 2 decides. (2) THEN decide whether to also ask for the time in the same reply: ask if it's really a scheduled commitment by nature (an interview, a meeting, an appointment, a movie) — it needs a real slot eventually. Don't ask for a casual personal item ("call Mom", "call the plumber", "read that book") or anything the user already called "sometime"/"eventually" — the backlog entry alone is enough there.
- REMINDERS: "remind me to X at TIME" → add_reminder (a phone ping at that moment, nothing on the calendar). A task with no time → add_todo. An appointment/block of time → calendar block or plan item. Pick ONE — do not double-book the same request as reminder + todo + block.
- DEV NOTES: whenever the user complains about the APP ITSELF or wishes it worked differently ("this time is wrong", "it's slow", "I want a button that…"), call log_feedback with a crisp title — silently, then respond normally. These are for the developer, not the user's task list; never add_todo for app bugs.
- WEB SEARCH: only call web_search for something genuinely time-sensitive or outside your training knowledge (today's weather, current prices, a live score, "is X open right now"). Don't reach for it to answer something you already know, and never use it for the user's own LifeOS data.
- Building or reworking the WHOLE day's plan → call propose_plan (the user taps Apply), NOT add_calendar_block calls.
- ONE ACTIVE PLAN: Apply REPLACES every non-fixed, non-recurring block for the day (future-only when replanning today) — there are never two parallel schedules. So your plan must be COMPLETE: re-include anything from ALREADY PLANNED that should survive (meals, sleep, tasks you agree with) — only [FIXED] appointments and recurring routines persist on their own.
- CONFIRM OVERRIDES: if ALREADY PLANNED has meaningful content and the user asks for a NEW plan (not a tweak), confirm once before calling propose_plan: name what exists ("you already have gym at 6 and dinner at 8 planned") and ask whether to replace or work around it. Skip the confirmation only when the user already said to redo/replace/replan.
- PLAN FROM CURRENT STATE: read CURRENT STATE before planning. A running entry tells you where the user is and what they're doing — if they're out (commuting, at a restaurant, at the gym), the plan's first items must get them from THERE to the next thing (finish up, travel home), never assume they're at home/office. Same for replanning: start from the running activity, not from an imagined idle state.
- NO GAPS: a day plan is a continuous timeline — consecutive items should touch (buffers/travel are themselves items). If the user's own outline leaves a gap of 30+ minutes, do not silently keep it: either ask ONE question about how to fill it or propose something explicit (rest, buffer, free time) so every stretch is accounted for up to sleep.
- GAP CHECK IS DATA, NOT EYEBALL: when reviewing/backfilling a day, the "gaps" array from list_time_entries is the source of truth for uncovered spans — enumerate EVERY entry in it (a sleep→next-activity boundary counts like any other). Never claim a day is "continuous"/"gap-free" unless that array is empty. Fill each gap (ask if unsure what it was), then re-list to confirm gaps is now empty before saying so.
- REPLAN FROM NOW: when the target day is today and the user asks to redo/replan the rest of the day, first look at reality (list_time_entries + list_calendar_blocks), then propose a plan that starts AT OR AFTER the current time — never re-emit items for hours that already passed. Apply only replaces planned blocks from now onward; the morning that already happened stays.
- REPLAN TRADEOFFS: when the day is meaningfully behind, ask at most TWO sharp tradeoff questions before proposing (e.g. protect the gym or recover sleep; shorten deep work or defer a task) — ground them in the EVIDENCE SNAPSHOT and state facts (with their window) separately from your judgment. Then propose. Do not interrogate further.
- After acting, your reply must state plainly what you changed.
- NEVER CLAIM AN ACTION YOU DIDN'T TAKE: only say you added/moved/deleted/scheduled something if a tool call for it actually succeeded THIS turn. The exact list of real changes is shown to the user beneath your reply as a verified log — if you describe a change that isn't in it, you are caught lying. If you intend to do something but haven't called the tool yet, call the tool now; don't narrate it as done.
- READ db_changes, DON'T GUESS AT SIDE EFFECTS: add_completed_entry/start_timer can silently trim, split, move, or delete OTHER entries to resolve an overlap (one-reality: a backfilled/switched period always wins). Every such side effect is returned in that tool result's db_changes array — this is the ONLY place you learn about it; your own memory of what an entry's time range "should" be is not updated automatically and WILL be stale. Before describing the resulting timeline, read db_changes from every tool result this turn and reflect the ACTUAL final times/titles it reports — do not describe an entry using the range you originally set it to if db_changes shows it got trimmed/split/moved afterward. Narrating the pre-side-effect state is exactly how a reply ends up describing two things as overlapping that the database already resolved correctly. db_changes can be present even on a result that ALSO has an error — the side effects happened for real before the failure and are not undone; if you see both, tell the user what actually changed AND that the specific thing you were trying to do on top of it failed. Never say "nothing happened" when db_changes is non-empty.
- Never invent ids: only use entry/block/category ids returned by tools or listed above.

THE propose_plan TOOL:
- Call propose_plan whenever you have a concrete, useful schedule to show — the first draft AND every later refinement. Do NOT call it on a turn where you're just chatting or answering a question with no schedule change: the plan you last proposed stays on screen exactly as it was until you call propose_plan again. If the user asks to scrap the plan entirely, call clear_plan instead.
- Every item needs start_time and end_time as 24-hour "HH:MM" local clock times.
- Set category_id to the matching category's id from the list above, or null if nothing fits. Never invent an id.
- Set todo_id whenever an item schedules one of the backlog tasks (including tasks you just added with add_todo) — that links the block to the task so doing it completes the task. When todo_id is set, the item's title MUST be the task's own title verbatim — never rephrase or elaborate it.
- ${TITLE_ARG_NOTE}
- Cover the meaningful parts of the day in order. Items must not overlap UNLESS the user explicitly wants things in parallel.
- PARALLEL ITEMS: when the user says things run in parallel / at the same time / while doing X, keep BOTH items at their full stated times even though they overlap (e.g. "study 7:30–10, calls 7:30–8 and 8–8:30 in parallel" → Study 19:30–22:00 PLUS Call 1 19:30–20:00 PLUS Call 2 20:00–20:30). Never shrink, split, or shift an item to avoid an overlap the user asked for. At most 2 items may run at any moment.
- SLEEP: the user's nightly sleep target is ${expectedSleepHours} hours. When they mention a bedtime (e.g. "I'll sleep at 11:15 PM"), add a Sleep item starting then and lasting the full ${expectedSleepHours} hours — the end_time will be an early-morning time smaller than the start_time (e.g. 23:15 → 07:45). That is the ONLY item allowed to cross midnight; never cut sleep short at midnight.
- After calling propose_plan, do NOT re-list the schedule item by item with times — the Apply card already shows every block, so restating it is pure duplication. Reply in 1-3 short sentences: what's new or changed since the last plan, plus one open question if you have one. If nothing meaningfully changed from the prior plan, a single sentence is enough. Keep it plain conversational text — never describe the schedule as JSON or mention the tool by name.`
}

// ─── Turn runner (shared by JSON and streaming paths) ───────────────────────

/** Carries an HTTP status so the handler can map failures to json() or an SSE
 *  `error` event without either path duplicating the tool loop. */
class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message)
  }
}

/** A short, human label for a tool call — shown live as the agent works so the
 *  user sees real steps + progress, not just a spinner. */
function stepLabel(name: string, args: Record<string, unknown>): string {
  const title = typeof args.title === 'string' ? args.title : ''
  switch (name) {
    case 'list_time_entries':
    case 'list_calendar_blocks':
    case 'list_todos':
    case 'list_reminders':
    case 'list_feedback':
      return 'Checking your schedule…'
    case 'add_calendar_block':
      return title ? `Scheduling “${title}”…` : 'Scheduling a block…'
    case 'update_calendar_block':
      return 'Adjusting a block…'
    case 'delete_calendar_block':
      return 'Removing a block…'
    case 'add_todo':
      return title ? `Adding task “${title}”…` : 'Adding a task…'
    case 'complete_todo':
      return 'Completing a task…'
    case 'start_timer':
      return title ? `Starting “${title}”…` : 'Starting a timer…'
    case 'stop_timer':
      return 'Stopping the timer…'
    case 'add_completed_entry':
      return title ? `Logging “${title}”…` : 'Logging time…'
    case 'update_time_entry':
    case 'delete_time_entry':
      return 'Fixing a time entry…'
    case 'restore_time_entry':
      return 'Restoring a time entry…'
    case 'add_reminder':
      return 'Setting a reminder…'
    case 'cancel_reminder':
      return 'Cancelling a reminder…'
    case 'save_memory':
      return 'Saving to memory…'
    case 'forget_memory':
      return 'Updating memory…'
    case 'save_journal':
      return 'Writing your journal…'
    case 'log_feedback':
      return 'Noting that for the developers…'
    case 'propose_plan':
      return 'Drafting your schedule…'
    case 'clear_plan':
      return 'Clearing the plan…'
    case 'web_search':
      return 'Searching the web…'
    default:
      return 'Working…'
  }
}

interface TurnResult {
  reply: string
  // undefined → omitted from the wire payload entirely (JSON.stringify drops
  // it) — the client reads a missing key as "plan unchanged this turn", vs an
  // explicit null meaning "cleared". See ToolCtx.plan.
  plan?: null | { title: string; items: Array<Record<string, unknown>> }
  actions: string[]
  model: string
}

interface StreamToolCall {
  id: string
  name: string
  arguments: string
}

/** One streamed OpenAI chat/completions call. Emits each text token via
 *  `onTextDelta` as it arrives (no-op in the JSON path) and returns the
 *  assembled text + any tool calls the model made, once the stream ends. */
async function streamOpenAICompletion(
  // deno-lint-ignore no-explicit-any
  convo: any[],
  tools: typeof TOOLS | undefined,
  openaiKey: string,
  onTextDelta: (chunk: string) => void,
): Promise<{ content: string; toolCalls: StreamToolCall[]; finishReason: string | null }> {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: REASONING_EFFORT,
        max_completion_tokens: 4000,
        messages: convo,
        stream: true,
        ...(tools ? { tools } : {}),
      }),
    })
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'TimeoutError'
    throw new HttpError(502, timedOut ? 'The assistant took too long — please try again.' : `openai request failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!res.ok) {
    const detail = await res.text()
    throw new HttpError(502, describeOpenAIError(res.status, detail), detail)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new HttpError(502, 'openai returned no stream')
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCallsByIndex = new Map<number, StreamToolCall>()
  let finishReason: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      // deno-lint-ignore no-explicit-any
      let chunk: any
      try {
        chunk = JSON.parse(data)
      } catch {
        continue
      }
      const choice = chunk.choices?.[0]
      if (!choice) continue
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta ?? {}
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content
        onTextDelta(delta.content)
      }
      if (Array.isArray(delta.tool_calls)) {
        // deno-lint-ignore no-explicit-any
        for (const tc of delta.tool_calls as any[]) {
          const idx = typeof tc.index === 'number' ? tc.index : 0
          const acc = toolCallsByIndex.get(idx) ?? { id: '', name: '', arguments: '' }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name += tc.function.name
          if (typeof tc.function?.arguments === 'string') acc.arguments += tc.function.arguments
          toolCallsByIndex.set(idx, acc)
        }
      }
    }
  }

  const toolCalls = Array.from(toolCallsByIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)
  return { content, toolCalls, finishReason }
}

/** Run the OpenAI tool loop to completion. `onStep` fires a live progress
 *  label per tool call; `onTextDelta` fires per streamed token of the FINAL
 *  reply (both no-ops in the JSON path). Throws HttpError on any failure. */
async function runPlanTurn(
  ctx: ToolCtx,
  // deno-lint-ignore no-explicit-any
  convo: any[],
  openaiKey: string,
  onStep: (label: string) => void,
  onTextDelta: (chunk: string) => void,
): Promise<TurnResult> {
  let reply = ''
  // Rounds 0..MAX_TOOL_ROUNDS-1 get every tool. Round MAX_TOOL_ROUNDS (the
  // "wrap it up" round) drops the exploratory/action tools but keeps
  // propose_plan/clear_plan — otherwise a model still mid-plan on that round
  // is left with no way to report it and silently answers in prose only. One
  // further no-tools round is the hard stop that guarantees termination.
  const REPORTING_TOOLS = TOOLS.filter(
    (t) => t.function.name === 'propose_plan' || t.function.name === 'clear_plan',
  )
  for (let round = 0; round <= MAX_TOOL_ROUNDS + 1; round++) {
    const lastRound = round === MAX_TOOL_ROUNDS
    const finalRound = round === MAX_TOOL_ROUNDS + 1
    onStep('Thinking…')
    // Buffer this round's text instead of streaming it live: a round that
    // ends in tool_calls may have streamed a preamble first, and we only
    // learn finishReason after the round completes. Streaming live and then
    // discarding on tool_calls made real text visibly appear and vanish
    // (Amarsh catch, 2026-08-18). Buffering means nothing is shown until we
    // know it's the terminal round, so there's nothing left to discard.
    const { content, toolCalls, finishReason } = await streamOpenAICompletion(
      convo,
      finalRound ? undefined : lastRound ? REPORTING_TOOLS : TOOLS,
      openaiKey,
      () => {},
    )

    if (finishReason === 'tool_calls' && toolCalls.length > 0) {
      // Re-add the assistant's own tool-call turn so the next round (and the
      // model) sees it, same shape the non-streaming API used to hand back.
      convo.push({
        role: 'assistant',
        content: content || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      })
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.arguments || '{}')
        } catch {
          /* leave empty */
        }
        onStep(stepLabel(call.name, args))
        const result = await runTool(ctx, call.name, args, openaiKey)
        convo.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        })
      }
      continue
    }

    reply = content
    if (content) onTextDelta(content)
    break
  }

  // NOTE: no APNs push-to-start here. plan-chat only runs while the app is in the
  // FOREGROUND (the user is actively in the Agent chat), so the client's
  // reconcileLiveActivities starts the Live Activity locally the moment
  // emitTimerChange refreshes the running set — the same reliable path as a manual
  // timer. Firing a push-to-start instead stamped push_started_at, which made the
  // client SKIP the local card (reconcile skips push-managed entries); when the
  // foreground push was then suppressed/dropped by iOS, the agent-started timer
  // showed no card at all. Background starts are the voice path's job, not this one.
  return { reply, plan: ctx.plan, actions: ctx.actions, model: MODEL }
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
  const sessionId = body.session_id || null
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

  const [{ data: categories }, { data: blocks }, { data: todos }, { data: settingsRow }] = await Promise.all([
    supabase.from('categories').select('id, name, kind').is('deleted_at', null).order('sort_order'),
    supabase
      .from('calendar_blocks')
      .select('title, start_time, end_time, flexibility')
      .eq('date', date)
      .is('deleted_at', null)
      .order('start_time'),
    supabase
      .from('todos')
      .select('id, title, priority, deadline, next_due, recurrence, category_id, kind')
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('priority', { ascending: false }),
    supabase
      .from('user_settings')
      .select(
        'allow_parallel_timers, wake_ideal_time, wake_acceptable_time, wake_lastresort_time, coffee_cutoff_time, melatonin_time, weekend_wake_flex_min, sunlight_after_wake, nap_cap_min, nap_cutoff_time, gym_cutoff_time',
      )
      .maybeSingle(),
  ])

  const cats = (categories ?? []) as Array<{ id: string; name: string; kind: string }>
  const allowedIds = new Set(cats.map((c) => c.id))
  const allowedTodoIds = new Set(((todos ?? []) as BacklogTodo[]).map((t) => t.id))

  const yesterdayStr = addDaysStr(todayLocal(timezone), -1)
  const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const [{ data: memories }, { data: yJournal }, { data: recentEntries }, evidenceSnapshot, officeModeToday] = await Promise.all([
    supabase
      .from('agent_memories')
      .select('id, kind, content, pinned')
      .is('deleted_at', null)
      .order('pinned', { ascending: false })
      .order('last_confirmed_at', { ascending: false })
      .limit(40),
    supabase.from('journal_entries').select('summary, answers').eq('date', yesterdayStr).maybeSingle(),
    // What the user is doing RIGHT NOW + the last few things they did — the
    // model must plan from this reality (e.g. currently out of the house).
    supabase
      .from('time_entries')
      .select('title, start_time, end_time, is_running')
      .is('deleted_at', null)
      .order('start_time', { ascending: false })
      .limit(5),
    buildEvidenceSnapshot(
      supabase,
      userData.user.id,
      timezone,
      (id) => cats.find((c) => c.id === id)?.name ?? null,
      (settingsRow as PlanPrefsSettings | null)?.wake_ideal_time ?? null,
    ).catch(() => '(snapshot unavailable)'),
    // Office mode for the day being PLANNED, not necessarily today (e.g. "plan tomorrow").
    computeOfficeModeToday(supabase, userData.user.id, date, weekdayOf(date)).catch(
      () => ({ mode: null, holidayName: null }) as OfficeModeToday,
    ),
  ])
  const preferences = buildPreferencesBlock(
    settingsRow as PlanPrefsSettings | null,
    officeModeToday,
    DOW_NAMES[weekdayOf(date)],
    date,
  )

  const currentState = (recentEntries ?? [])
    .map((e) =>
      e.is_running
        ? `- NOW RUNNING: "${e.title}" since ${isoToLocal(e.start_time, timezone)}`
        : `- ${e.title}: ${isoToLocal(e.start_time, timezone)} → ${e.end_time ? isoToLocal(e.end_time, timezone) : '?'}`,
    )
    .join('\n') || '(no recent entries)'

  const memoryRows = (memories ?? []) as Array<{ id: string; kind: string; content: string; pinned: boolean }>
  const system = buildSystemPrompt(
    date,
    timezone,
    cats,
    (blocks ?? []) as Array<{ title: string; start_time: string; end_time: string; flexibility?: string }>,
    (todos ?? []) as BacklogTodo[],
    expectedSleepHours,
    evidenceSnapshot,
    memoryRows,
    yJournal ? `${yJournal.summary}${yJournal.answers ? ` — answers: ${JSON.stringify(yJournal.answers)}` : ''}` : null,
    currentState,
    preferences,
  )

  const ctx: ToolCtx = {
    supabase,
    tz: timezone,
    targetDate: date,
    userId: userData.user.id,
    allowedCategoryIds: allowedIds,
    allowedTodoIds, // same set instance — add_todo grows it, so the final plan filter accepts new tasks
    allowedEntryIds: new Set<string>(),
    allowedBlockIds: new Set<string>(),
    allowedReminderIds: new Set<string>(),
    allowedMemoryIds: new Set<string>(memoryRows.map((m) => m.id)),
    allowParallel: settingsRow?.allow_parallel_timers === true,
    actions: [],
  }

  // Sanitize to {role, content} only — the client may attach UI-only fields
  // (e.g. a verified `actions` log) to persisted messages; OpenAI rejects unknown keys.
  // User messages carrying `at` get their send time folded INTO content here
  // (model-facing copy only — the stored/displayed message is never touched)
  // so the model can read exact times instead of asking for them.
  const cleanMsgs = messages.map((m: ChatMessage) => ({
    role: m.role,
    content: m.role === 'user' && m.at ? `[${isoToLocal(m.at, timezone)}] ${m.content}` : m.content,
  }))
  // deno-lint-ignore no-explicit-any
  const convo: any[] = [{ role: 'system', content: system }, ...cleanMsgs]

  // Streaming path: a live `step` event per tool call, a `token` event per
  // chunk of the final reply as the model writes it, then one `done` event
  // with the full payload (final reply text + actions + plan, if touched).
  if (body.stream === true) {
    const enc = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          } catch {
            /* controller already closed (client aborted) */
          }
        }
        // Registered with waitUntil below so it runs to completion — including
        // persisting the turn — even if the client's connection dies mid-flight
        // (app backgrounded) and every send() above starts silently no-op'ing.
        const work = (async () => {
          const result = await runPlanTurn(
            ctx,
            convo,
            openaiKey,
            (label) => send('step', { label }),
            (chunk) => send('token', { chunk }),
          )
          const assistantMsg = { role: 'assistant' as const, content: result.reply, actions: result.actions }
          const finalMessages = [...messages, assistantMsg]
          let finalSessionId = sessionId
          try {
            if (sessionId) {
              const patch: Record<string, unknown> = { messages: finalMessages, date }
              if (result.plan !== undefined) patch.plan = result.plan
              const { error } = await supabase.from('chat_sessions').update(patch).eq('id', sessionId)
              if (error) console.error('plan-chat: failed to persist turn', error.message)
            } else {
              const title = (messages.find((m) => m.role === 'user')?.content ?? 'Chat').slice(0, 80)
              const { data: inserted, error } = await supabase
                .from('chat_sessions')
                .insert({ user_id: userData.user.id, title, date, messages: finalMessages, plan: result.plan ?? null })
                .select('id')
                .single()
              if (error) console.error('plan-chat: failed to create session', error.message)
              else finalSessionId = inserted.id as string
            }
          } catch (persistErr) {
            console.error('plan-chat: persistence threw', persistErr)
          }
          return { ...result, session_id: finalSessionId }
        })()
        EdgeRuntime.waitUntil(work)
        try {
          const result = await work
          send('done', result)
        } catch (e) {
          const he = e instanceof HttpError ? e : new HttpError(500, e instanceof Error ? e.message : String(e))
          send('error', { error: he.message, detail: he.detail })
        } finally {
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
      },
    })
    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }

  // JSON path (back-compat): run to completion, return the whole payload at once.
  try {
    const result = await runPlanTurn(ctx, convo, openaiKey, () => {}, () => {})
    return json(result)
  } catch (e) {
    const he = e instanceof HttpError ? e : new HttpError(500, e instanceof Error ? e.message : String(e))
    return json(he.detail ? { error: he.message, detail: he.detail } : { error: he.message }, he.status)
  }
})
