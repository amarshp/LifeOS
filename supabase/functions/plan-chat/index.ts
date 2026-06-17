// Edge Function: plan-chat
// Conversational day-planner ("PA"). Called from the foreground, AUTHENTICATED
// app (verify_jwt ON — default). We resolve the user from their JWT, load their
// categories + already-planned blocks for the target date as context, then ask
// OpenAI for a single structured turn: a chat `reply` plus an optional concrete
// `plan` the user can apply. The OpenAI key never leaves the server.
//
// Deploy: npx supabase functions deploy plan-chat
// Secret:  npx supabase secrets set OPENAI_API_KEY=sk-...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'gpt-4o-mini'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Body {
  date?: string // YYYY-MM-DD (local calendar day to plan)
  messages?: ChatMessage[]
  timezone?: string // IANA tz, for the model's awareness only
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Structured output contract. `plan` is null while the assistant is still
// gathering info; it's filled once there's a concrete schedule worth applying.
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
              notes: { type: ['string', 'null'] },
            },
            required: ['title', 'start_time', 'end_time', 'category_id', 'notes'],
          },
        },
      },
      required: ['title', 'items'],
    },
  },
  required: ['reply', 'plan'],
} as const

interface BacklogTodo {
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
          return `- ${t.title}${parts.length ? ` (${parts.join(', ')})` : ''}`
        })
        .join('\n')
    : '(none)'

  return `You are LifeOS's personal planning assistant — warm, concise, and practical, like a good chief-of-staff. You help the user plan a single day through conversation.

TARGET DAY: ${date}
TIMEZONE: ${timezone}

The user's activity CATEGORIES (use the exact id when assigning an item):
${catLines}

ALREADY PLANNED for ${date} (avoid clashing unless the user wants to change it):
${existingLines}

BACKLOG TASKS the user wants to get done (pull the relevant ones into THIS day's plan, highest priority and nearest deadline first — only as many as realistically fit; leave the rest for another day):
${todoLines}

HOW TO BEHAVE:
- Converse naturally. Ask at most 1–2 sharp clarifying questions when details are missing (times, durations, priorities, energy windows). Don't interrogate.
- Make proactive suggestions (buffers between meetings, breaks, deep-work blocks, wind-down) but keep the user in control.
- Keep replies short — a few sentences. This may be read aloud by a voice assistant, so write for the ear: no markdown, no bullet symbols, no emoji.

THE PLAN FIELD (structured output):
- Set "plan" to null until you have a concrete, useful schedule. Once you do, fill it AND keep refining it on later turns as the user adjusts.
- Every item needs start_time and end_time as 24-hour "HH:MM" local clock times.
- Set category_id to the matching category's id from the list above, or null if nothing fits. Never invent an id.
- Cover the meaningful parts of the day in order, without overlaps.
- When you include a plan, your "reply" should briefly summarize it and ask if they want changes.`
}

Deno.serve(async (req) => {
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

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!url || !anonKey || !openaiKey) return json({ error: 'server misconfigured' }, 500)

  // User-scoped client: RLS applies, so we only ever read the caller's own rows.
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
      .select('title, priority, deadline, next_due, recurrence, category_id')
      .eq('status', 'open')
      .is('deleted_at', null)
      .order('priority', { ascending: false }),
  ])

  const cats = (categories ?? []) as Array<{ id: string; name: string; kind: string }>
  const allowedIds = new Set(cats.map((c) => c.id))
  const system = buildSystemPrompt(
    date,
    timezone,
    cats,
    (blocks ?? []) as Array<{ title: string; start_time: string; end_time: string }>,
    (todos ?? []) as BacklogTodo[],
  )

  let openaiRes: Response
  try {
    openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...messages],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'plan_turn', strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    })
  } catch (e) {
    return json({ error: `openai request failed: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }

  if (!openaiRes.ok) {
    const detail = await openaiRes.text()
    return json({ error: `openai error ${openaiRes.status}`, detail }, 502)
  }

  const completion = await openaiRes.json()
  const content: string = completion.choices?.[0]?.message?.content ?? ''
  let parsed: { reply: string; plan: null | { title: string; items: Array<Record<string, unknown>> } }
  try {
    parsed = JSON.parse(content)
  } catch {
    return json({ error: 'model returned non-JSON', content }, 502)
  }

  // Defensive: drop any category_id the model hallucinated (RLS-safe set).
  if (parsed.plan) {
    parsed.plan.items = (parsed.plan.items ?? []).map((it) => {
      const cid = it.category_id
      return { ...it, category_id: typeof cid === 'string' && allowedIds.has(cid) ? cid : null }
    })
  }

  return json({ reply: parsed.reply, plan: parsed.plan, model: MODEL })
})
