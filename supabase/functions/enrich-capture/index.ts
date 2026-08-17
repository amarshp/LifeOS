// Edge Function: enrich-capture
// Async auto-classification of raw captures (Siri, app sheet, shortcuts):
// a SMALL model cleans the title, picks an EXISTING category, adds 0-2 tags
// (and a kind for todos). Fired by a DB insert webhook a moment after capture —
// capture itself is never blocked, and a failed enrichment just leaves the raw
// entry untouched. Never overwrites a title the user has already edited.
//
// Deploy: npx supabase functions deploy enrich-capture --no-verify-jwt
// Secret: npx supabase secrets set ENRICH_KEY=…  (also stored in Vault by
//         setup_enrich_webhook for the trigger to send)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'gpt-4.1-mini'
const OPENAI_TIMEOUT_MS = 20_000

interface Body {
  table?: 'time_entries' | 'todos'
  id?: string
  title?: string // raw title at insert time (guard against user edits)
}

// CORS: the Expo WEB build (localhost dev / testing) calls this directly from
// a browser now (the client-JWT path) and needs preflight + explicit allow
// headers; the DB trigger's server-to-server calls ignore these.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-enrich-key',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Cleaned human title, Sentence case. Fix mis-hearings/typos, expand shorthand. Keep it short.' },
    category_id: { type: ['string', 'null'], description: 'Best-fitting EXISTING category id, or null if genuinely none fits.' },
    tags: { type: 'array', items: { type: 'string' }, description: '0-2 lowercase-kebab tags (place, project, show name…). Reuse existing vocabulary when close.' },
    kind: { type: ['string', 'null'], enum: ['commitment', 'flexible', 'reminder', 'someday', null], description: 'Todos only; null for time entries.' },
    confidence: { type: 'string', enum: ['high', 'low'], description: 'high only when title meaning and category are unambiguous.' },
  },
  required: ['title', 'category_id', 'tags', 'kind', 'confidence'],
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  const enrichKey = Deno.env.get('ENRICH_KEY')
  if (!url || !serviceKey || !openaiKey) return json({ error: 'server misconfigured' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Two trusted callers: the DB trigger (shared secret — fully trusted, any
  // row) or a signed-in user calling directly right after their own manual
  // capture for instant feedback (verified against the row's owner below).
  const authHeader = req.headers.get('Authorization')
  let callerUserId: string | null = null
  if (enrichKey && req.headers.get('x-enrich-key') === enrichKey) {
    // trigger path — no owner check needed
  } else if (authHeader?.startsWith('Bearer ')) {
    const { data: userData, error: userErr } = await admin.auth.getUser(authHeader.slice(7))
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    callerUserId = userData.user.id
  } else {
    return json({ error: 'unauthorized' }, 401)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  const { table, id, title: rawTitle } = body
  if (!table || !id || !['time_entries', 'todos'].includes(table)) return json({ error: 'missing table/id' }, 400)

  // Load the row (may have been edited/deleted since the webhook fired).
  const cols = table === 'todos' ? 'id, user_id, title, category_id, kind' : 'id, user_id, title, category_id, tags'
  const { data: row } = await admin.from(table).select(cols).eq('id', id).is('deleted_at', null).maybeSingle()
  if (!row) return json({ ok: true, note: 'row gone' })
  if (callerUserId && row.user_id !== callerUserId) return json({ error: 'not your entry' }, 403)
  if (rawTitle && row.title !== rawTitle) return json({ ok: true, note: 'title changed since capture — leaving it alone' })

  const [{ data: categories }, { data: tagRows }, { data: recent }, { data: settings }] = await Promise.all([
    admin.from('categories').select('id, name, kind').eq('user_id', row.user_id).is('deleted_at', null).order('sort_order'),
    admin.from('tags').select('name').eq('user_id', row.user_id).is('deleted_at', null).limit(60),
    admin.from('time_entries').select('title').eq('user_id', row.user_id).is('deleted_at', null).order('start_time', { ascending: false }).limit(12),
    admin.from('user_settings').select('stt_vocabulary').eq('user_id', row.user_id).maybeSingle(),
  ])
  if (!categories || categories.length === 0) return json({ ok: true, note: 'no categories' })

  const system = `You clean up raw activity/task captures for a personal time tracker. Input titles come from voice dictation or hurried typing — mis-heard words, shorthand, lowercase. Return STRICT JSON.

RULES:
- Fix the title: correct obvious mis-hearings ("calform berito" → "California Burrito"), expand shorthand, Sentence case, keep it under ~6 words. If it is already clean, return it UNCHANGED.
- GENERIC TITLE, SPECIFIC TAGS: the title names the ACTIVITY in its most reusable form ("Snack", "Lunch", "Gym", "Watching anime"); the distinguishing details move into tags. "pre gym eggs" → title "Snack", tags ["eggs","pre-gym"]. "leg day workout" → title "Gym", tags ["legs"]. Named places/people may stay in the title when the place IS the activity ("At California Burrito").
- WORKOUT TYPE: when the title becomes (or already is) "Gym", if the entry names a workout type, tag it using EXACTLY one of this closed vocabulary — push, pull, legs, upper, lower, full-body, boxing, run, hyrox, rest — never a synonym or variant ("leg day"/"legs day" → "legs", "push day" → "push", "hyrox" → "hyrox"). Skip this tag entirely if the entry gives no type signal (e.g. just "Gym" or "Workout").
- category_id: choose the best EXISTING category id from the list; null only if nothing fits at all. Travel/driving → a commute-like category; eating out → food; a show/anime → watching/leisure; a known project name (e.g. "LifeOS") → the work/study-like category it belongs to.
- tags: 0-2 lowercase-kebab specifics worth aggregating later (place name, project name, show name). No generic tags like "misc".
- TAG CONSISTENCY (important): the EXISTING TAGS list is the user's established vocabulary. If any existing tag denotes the same thing as a tag you'd add, you MUST reuse the EXACT existing tag — never coin a near-synonym or platform variant. E.g. if "reels" exists, tag reels-watching "reels", not "instagram"/"shorts"/"scrolling"; if "gym" exists use it, not "workout". Only invent a new tag when NOTHING existing means the same thing. Do not attach a project tag to an unrelated activity (e.g. never tag an OCR/electric-bills entry "lifeos").
- kind (todos only): commitment = promise/deadline involving someone; reminder = tiny date-bound action; someday = parked wish; else flexible.
- confidence: high only when meaning + category are unambiguous.

CATEGORIES:
${categories.map((c) => `- ${c.name} (${c.kind}) → ${c.id}`).join('\n')}

EXISTING TAGS: ${(tagRows ?? []).map((t) => t.name).join(', ') || '(none)'}

KNOWN NAMES (people/places/projects the user actually means — correct mis-hearings TOWARD these): ${((settings?.stt_vocabulary as string[] | null) ?? []).join(', ') || '(none)'}

RECENT ENTRY TITLES (style/consistency reference): ${(recent ?? []).map((r) => `"${r.title}"`).join(', ')}`

  let content = ''
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_completion_tokens: 200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${table === 'todos' ? 'Task' : 'Time entry'}: "${row.title}"` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'enrichment', strict: true, schema: RESPONSE_SCHEMA } },
      }),
    })
    if (!res.ok) return json({ error: `openai ${res.status}` }, 502)
    content = (await res.json()).choices?.[0]?.message?.content ?? ''
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 502)
  }

  let out: { title: string; category_id: string | null; tags: string[]; kind: string | null; confidence: string }
  try {
    out = JSON.parse(content)
  } catch {
    return json({ error: 'non-JSON from model' }, 502)
  }

  const validCat = out.category_id && categories.some((c) => c.id === out.category_id) ? out.category_id : null
  const patch: Record<string, unknown> = {}
  if (out.title && out.title.trim() && out.title.trim() !== row.title) patch.title = out.title.trim()
  if (validCat && validCat !== row.category_id) patch.category_id = validCat

  if (table === 'time_entries') {
    const existing: string[] = Array.isArray((row as { tags?: string[] }).tags) ? (row as { tags: string[] }).tags : []
    const newTags = (out.tags ?? []).map((t) => t.toLowerCase().trim()).filter((t) => t && !existing.includes(t)).slice(0, 2)
    let tags = [...existing, ...newTags]
    // A confidently-understood voice entry no longer needs human review.
    if (out.confidence === 'high') tags = tags.filter((t) => t !== 'review')
    if (JSON.stringify(tags) !== JSON.stringify(existing)) patch.tags = tags
  } else if (out.kind && ['commitment', 'flexible', 'reminder', 'someday'].includes(out.kind) && out.kind !== (row as { kind?: string }).kind) {
    patch.kind = out.kind
  }

  if (Object.keys(patch).length === 0) return json({ ok: true, note: 'nothing to change' })
  // Guard again at write time: only apply if the title is still what we read.
  const { error } = await admin.from(table).update(patch).eq('id', id).eq('title', row.title)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true, applied: patch })
})
