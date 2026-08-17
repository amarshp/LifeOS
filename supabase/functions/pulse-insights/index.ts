// Edge Function: pulse-insights
// Broader Pulse coverage across all categories, not just Sleep/Gym. Server
// computes three signal types per category — trend (intensity), attendance
// (frequency/quiet), fragmentation — gated ONLY on whether there's enough
// history to trust a comparison, never on how big the change is (a fixed
// magnitude cutoff missed a real -27% Sleep drop and can't self-calibrate
// across categories with different natural variance). One gpt-5.1 call
// phrases whichever signals are real into cards; the client renders all of
// them in a scrolling list — no card cap, so there's no forced ranking
// between e.g. a health signal and a bigger-but-less-important one.
//
// Validated over 4 rounds of eval against real + synthetic data before this
// was written (scratchpad/insight-eval/ — not shipped). Settled: sample-gate
// only (no magnitude threshold), generator->verifier drops zero value at
// ~2x cost so it's not used, self-relative attendance gate (3x a category's
// own median gap, floor 7d) beats a shared global number.
//
// Deploy: npx supabase functions deploy pulse-insights

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'gpt-5.1'
const REASONING_EFFORT = 'low'
const OPENAI_TIMEOUT_MS = 45_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

// ─── Aggregation (mirrors scratchpad/insight-eval/aggregate3.cjs) ────────────

const RUNAWAY_MIN = 1200 // >=20h -- a real session never runs this long; exclude, don't cap
const LOOKBACK_DAYS = 84 // attendance/fragmentation history window
const MIN_ACTIVE_DAYS = 3
const CURRENT_WINDOW_DAYS = 7
const BASELINE_WINDOW_DAYS = 21
const MIN_SESSIONS_FOR_GAP_ESTIMATE = 3
const GAP_MULTIPLE = 3
const GAP_FLOOR_DAYS = 7

interface Row { category: string; start: string; durMin: number }

function dateOf(iso: string): string { return iso.slice(0, 10) }
function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000)
}
function median(vals: number[]): number | null {
  if (!vals.length) return null
  const s = [...vals].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

function activeDayMedian(rows: Row[], cat: string, sinceIso: string, untilIsoExclusive: string) {
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.category !== cat) continue
    if (r.start < sinceIso || r.start >= untilIsoExclusive) continue
    const d = dateOf(r.start)
    byDay.set(d, (byDay.get(d) ?? 0) + r.durMin)
  }
  const vals = [...byDay.values()]
  const m = median(vals)
  return { activeDays: vals.length, medianPerActiveDay: m !== null ? Math.round(m) : null }
}

function buildAggregates(rows: Row[], referenceDate: string) {
  const currentSince = new Date(new Date(referenceDate + 'T00:00:00Z').getTime() - CURRENT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const baselineSince = new Date(new Date(currentSince + 'T00:00:00Z').getTime() - BASELINE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const cats = [...new Set(rows.map((r) => r.category))]

  const trend: Record<string, unknown> = {}
  for (const c of cats) {
    const current = activeDayMedian(rows, c, currentSince, referenceDate)
    const baseline = activeDayMedian(rows, c, baselineSince, currentSince)
    const enoughSample = current.activeDays >= MIN_ACTIVE_DAYS && baseline.activeDays >= MIN_ACTIVE_DAYS
    const pctChange = enoughSample && baseline.medianPerActiveDay && baseline.medianPerActiveDay > 0
      ? Math.round(((current.medianPerActiveDay! - baseline.medianPerActiveDay) / baseline.medianPerActiveDay) * 100)
      : null
    trend[c] = { current, baseline, enoughSample, pctChange: enoughSample ? pctChange : null }
  }

  const fragmentation: Record<string, unknown> = {}
  const catStats = new Map<string, { sessions: number; totalMin: number }>()
  for (const r of rows) {
    const s = catStats.get(r.category) ?? { sessions: 0, totalMin: 0 }
    s.sessions++; s.totalMin += r.durMin
    catStats.set(r.category, s)
  }
  for (const c of cats) {
    const s = catStats.get(c)!
    fragmentation[c] = { sessionsInWindow: s.sessions, avgSessionMin: Math.round(s.totalMin / s.sessions), totalHrsInWindow: +(s.totalMin / 60).toFixed(1) }
  }

  const attendance: Record<string, unknown> = {}
  for (const c of cats) {
    const activeDates = [...new Set(rows.filter((r) => r.category === c && r.start < referenceDate).map((r) => dateOf(r.start)))].sort()
    if (activeDates.length < MIN_SESSIONS_FOR_GAP_ESTIMATE) {
      attendance[c] = { enoughHistory: false }
      continue
    }
    const gaps: number[] = []
    for (let i = 1; i < activeDates.length; i++) gaps.push(daysBetween(activeDates[i - 1], activeDates[i]))
    const medianGap = median(gaps)!
    const lastActive = activeDates[activeDates.length - 1]
    const daysSinceLast = daysBetween(lastActive, referenceDate)
    const quietThreshold = Math.max(GAP_MULTIPLE * medianGap, GAP_FLOOR_DAYS)
    attendance[c] = { enoughHistory: true, totalActiveDays: activeDates.length, medianGapDays: medianGap, lastActive, daysSinceLast, quietThreshold, wentQuiet: daysSinceLast > quietThreshold }
  }

  return { trend, fragmentation, attendance }
}

// ─── Prompt (validated shape from R4) ────────────────────────────────────────

const RULE = `Only entries under "trend" with "enoughSample": true have a valid pctChange -- treat every "enoughSample": false entry as NO trend data, full stop. Attendance entries with "wentQuiet": true mean that category was routine before and has gone silent recently -- a real, separate kind of observation from a trend. "fragmentation" entries are always statistically valid (whole window) but only worth a card if the pattern is actually notable (e.g. many short sessions, or very few very long ones) -- most categories' fragmentation is unremarkable and should not get a card. Never state a number not present in the data; every claim must cite the exact number it's based on. At most ONE card per category -- if a category has more than one real signal, fold them into a single card, still without implying they cause or relate to each other. Never imply that one category's change is related to, caused by, or balanced against a DIFFERENT category's change unless the data itself directly links them -- that is always two separate cards, never one combined narrative. If nothing in the data is real, return an empty cards array -- do not invent something to fill space.`

interface Card { category: string; kind: 'trend' | 'attendance' | 'fragmentation'; headline: string; detail: string }

async function callOpenAI(agg: ReturnType<typeof buildAggregates>, openaiKey: string): Promise<Card[]> {
  const dataBlock = `trend:\n${JSON.stringify(agg.trend, null, 1)}\n\nfragmentation:\n${JSON.stringify(agg.fragmentation, null, 1)}\n\nattendance:\n${JSON.stringify(agg.attendance, null, 1)}`
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: REASONING_EFFORT,
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `You analyze a personal time-tracking log for genuinely useful observations about time allocation and efficiency, one per category, plain language (the reader isn't technical). ${RULE} Return JSON: {"cards": [{"category": string, "kind": "trend"|"attendance"|"fragmentation", "headline": string (short, <=10 words), "detail": string (one sentence, cites the real numbers)}]}` },
          { role: 'user', content: dataBlock },
        ],
      }),
    })
  } catch (e) {
    console.error('pulse-insights: openai request failed', e)
    return []
  }
  if (!res.ok) {
    console.error('pulse-insights: openai non-2xx', res.status, await res.text().catch(() => ''))
    return []
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') return []
  try {
    const parsed = JSON.parse(content)
    const cards = Array.isArray(parsed.cards) ? parsed.cards : []
    return cards.filter((c: unknown): c is Card =>
      typeof c === 'object' && c !== null &&
      typeof (c as Card).category === 'string' &&
      typeof (c as Card).headline === 'string' &&
      typeof (c as Card).detail === 'string' &&
      ['trend', 'attendance', 'fragmentation'].includes((c as Card).kind))
  } catch (e) {
    console.error('pulse-insights: failed to parse model JSON', e, content)
    return []
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'missing authorization' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openaiKey = Deno.env.get('OPENAI_API_KEY')
  if (!url || !anonKey || !openaiKey) return json({ error: 'server misconfigured' }, 500)

  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)

  const referenceDate = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

  const [{ data: categories, error: catErr }, { data: entries, error: entErr }] = await Promise.all([
    supabase.from('categories').select('id, name').is('deleted_at', null),
    supabase.from('time_entries')
      .select('category_id, start_time, end_time')
      .is('deleted_at', null)
      .not('end_time', 'is', null)
      .gte('start_time', since),
  ])
  if (catErr) return json({ error: catErr.message }, 500)
  if (entErr) return json({ error: entErr.message }, 500)

  const catName = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]))
  const rows: Row[] = (entries ?? [])
    .map((r) => {
      const durMin = Math.round((new Date(r.end_time as string).getTime() - new Date(r.start_time as string).getTime()) / 60_000)
      return { category: catName.get(r.category_id as string) ?? 'Unknown', start: r.start_time as string, durMin }
    })
    .filter((r) => r.durMin > 0 && r.durMin < RUNAWAY_MIN)

  if (!rows.length) return json({ cards: [] })

  const agg = buildAggregates(rows, referenceDate)
  const anyEligible = Object.values(agg.trend).some((t) => (t as { enoughSample: boolean }).enoughSample)
    || Object.values(agg.attendance).some((a) => (a as { wentQuiet?: boolean }).wentQuiet)
  // Fragmentation has no gate (by design -- same reasoning as trend/attendance:
  // no magnitude threshold), so it alone could still justify a call even when
  // no trend/attendance signal is eligible. Skip the OpenAI call only when
  // there's truly nothing running yet (cold-start account).
  if (!anyEligible && Object.keys(agg.fragmentation).length === 0) return json({ cards: [] })

  const cards = await callOpenAI(agg, openaiKey)
  return json({ cards })
})
