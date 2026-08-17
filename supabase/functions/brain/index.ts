// Edge Function: brain
// The autonomous loop: observe → assess → decide → act → follow up → record.
// Deterministic v1 — rule-based sensors over real data; no LLM in the loop.
// The durable unit is an open CONCERN; pushes are rate-limited by a daily
// attention budget, per-concern cooldowns, and quiet hours.
//
// Triggers:
//  - pg_cron every 30 min (header x-cron-key, set via `supabase secrets set
//    BRAIN_CRON_KEY=…` and stored in Vault by setup_brain_cron) → all users
//    that have a push token.
//  - The app on foreground (user JWT) → that user only.
//
// Deploy: npx supabase functions deploy brain --no-verify-jwt

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendActivityUpdate } from '../_shared/apns.ts'
import { computeSleepEvidence, computeWorkoutEvidence, isNapWindow } from '../_shared/wellness-evidence.ts'

// CORS: the Expo WEB build calls this from a browser (app-open tick).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
} as const

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ─── Local-time helpers ───────────────────────────────────────────────────────

function todayLocal(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(new Date())
}

function localHour(timeZone: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  ) % 24
}

function localClock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ─── Concern detection ────────────────────────────────────────────────────────

interface DetectedConcern {
  key: string
  kind: 'gap' | 'drift' | 'commitment' | 'morning' | 'evening' | 'gym-gap' | 'sleep-debt' | 'post-activity-nap'
  title: string
  detail: string
  evidence: string
  importance: number
}

const COOLDOWN_MIN: Record<DetectedConcern['kind'], number> = {
  gap: 120,
  drift: 180,
  commitment: 240,
  morning: 24 * 60,
  evening: 24 * 60,
  'gym-gap': 24 * 60,
  'sleep-debt': 24 * 60,
  'post-activity-nap': 4 * 60,
}

interface Prefs {
  timezone: string
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  notif_daily_budget: number
}

function inQuietHours(hour: number, p: Prefs): boolean {
  const { quiet_hours_start: qs, quiet_hours_end: qe } = p
  if (qs === null || qe === null || qs === qe) return false
  return qs < qe ? hour >= qs && hour < qe : hour >= qs || hour < qe
}

async function detectConcerns(
  db: SupabaseClient,
  userId: string,
  prefs: Prefs,
): Promise<DetectedConcern[]> {
  const tz = prefs.timezone
  const today = todayLocal(tz)
  const hour = localHour(tz)
  const nowMs = Date.now()
  const out: DetectedConcern[] = []

  // One day of context (entries can start yesterday and spill over midnight).
  const sinceIso = new Date(nowMs - 36 * 3600_000).toISOString()
  const [{ data: entries }, { data: blocks }, { data: todos }, { data: journal }, { data: categories }] = await Promise.all([
    db.from('time_entries')
      .select('id, title, category_id, start_time, end_time, is_running, todo_id')
      .eq('user_id', userId).is('deleted_at', null).gte('start_time', sinceIso).order('start_time'),
    db.from('calendar_blocks')
      .select('id, title, start_time, end_time, todo_id')
      .eq('user_id', userId).eq('date', today).is('deleted_at', null),
    db.from('todos')
      .select('id, title, kind, deadline, next_due, recurrence')
      .eq('user_id', userId).eq('status', 'open').is('deleted_at', null),
    db.from('journal_entries').select('id').eq('user_id', userId).eq('date', today).maybeSingle(),
    db.from('categories').select('id, name').eq('user_id', userId).is('deleted_at', null),
  ])
  // catName must be built AFTER categories resolves — computeSleepEvidence calls
  // it during its own internal query, which runs concurrently with nothing else
  // here, so `categories` needs to already be a settled value, not a promise
  // still in flight (a same-Promise.all attempt at this deadlocks/TDZ-errors).
  const catName = (id: string | null) => (categories ?? []).find((c) => c.id === id)?.name ?? null
  const [sleepEv, workoutEv] = await Promise.all([
    computeSleepEvidence(db, userId, tz, catName),
    computeWorkoutEvidence(db, userId),
  ])

  const running = (entries ?? []).filter((e) => e.is_running)
  const completed = (entries ?? []).filter((e) => !e.is_running && e.end_time)

  // GAP — awake hours, nothing tracking, last entry ended a while ago.
  if (hour >= 8 && hour < 23 && running.length === 0 && completed.length > 0) {
    const lastEndMs = Math.max(...completed.map((e) => new Date(e.end_time as string).getTime()))
    const gapMin = Math.floor((nowMs - lastEndMs) / 60_000)
    if (gapMin >= 45 && gapMin < 12 * 60) {
      out.push({
        key: `gap:${today}`,
        kind: 'gap',
        title: 'Untracked time',
        detail: `What happened since ${localClock(new Date(lastEndMs).toISOString(), tz)}? Tell the Agent or fill it in.`,
        evidence: `${gapMin} min untracked since the last entry ended`,
        importance: 2,
      })
    }
  }

  // DRIFT — planned time that should already have happened vs tracked today.
  const dayBlocks = blocks ?? []
  if (dayBlocks.length > 0) {
    let plannedSoFarMs = 0
    for (const b of dayBlocks) {
      const bs = new Date(b.start_time as string).getTime()
      const be = new Date(b.end_time as string).getTime()
      if (Number.isFinite(bs) && Number.isFinite(be)) plannedSoFarMs += Math.max(0, Math.min(be, nowMs) - bs)
    }
    let trackedTodayMs = 0
    for (const e of entries ?? []) {
      const es = new Date(e.start_time as string).getTime()
      const ee = e.end_time ? new Date(e.end_time as string).getTime() : nowMs
      // count only today's portion, approximated by the local date of the end
      if (new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date(Math.min(ee, nowMs))) === today) {
        trackedTodayMs += Math.max(0, Math.min(ee, nowMs) - es)
      }
    }
    const driftMin = Math.floor((plannedSoFarMs - trackedTodayMs) / 60_000)
    if (driftMin >= 60) {
      out.push({
        key: `drift:${today}`,
        kind: 'drift',
        title: 'Plan is slipping',
        detail: 'Replan the rest of today with the Agent?',
        evidence: `~${driftMin} min behind: ${Math.round(plannedSoFarMs / 60_000)} min planned so far vs ${Math.round(trackedTodayMs / 60_000)} min tracked`,
        importance: 2,
      })
    }
  }

  // COMMITMENTS — due today/overdue with no disposition (no block today, no schedule).
  const blockTodoIds = new Set(dayBlocks.map((b) => b.todo_id).filter(Boolean))
  for (const t of todos ?? []) {
    if (t.kind !== 'commitment') continue
    const due = t.recurrence !== 'none' ? t.next_due : t.deadline ? String(t.deadline).slice(0, 10) : null
    if (!due || due > today) continue
    if (blockTodoIds.has(t.id)) continue
    out.push({
      key: `commitment:${t.id}`,
      kind: 'commitment',
      title: `Commitment needs a slot: ${t.title}`,
      detail: 'Due and unscheduled — give it a time, defer it, or tell the Agent.',
      evidence: `kind=commitment, due ${due}, no block today`,
      importance: 3,
    })
  }

  // MORNING — no plan for today at all.
  if (hour >= 7 && hour < 11 && dayBlocks.length === 0) {
    out.push({
      key: `morning:${today}`,
      kind: 'morning',
      title: 'No plan for today yet',
      detail: 'Two minutes with the Agent sets up the day.',
      evidence: `0 planned blocks at ${hour}:00 local`,
      importance: 1,
    })
  }

  // EVENING — reviewable day, no journal yet.
  if (hour >= 21 && hour < 23 && !journal) {
    let trackedMs = 0
    for (const e of completed) {
      trackedMs += new Date(e.end_time as string).getTime() - new Date(e.start_time as string).getTime()
    }
    if (trackedMs > 2 * 3600_000) {
      out.push({
        key: `evening:${today}`,
        kind: 'evening',
        title: 'Two-minute review?',
        detail: 'The Agent will summarize today and ask a couple of questions.',
        evidence: `${Math.round(trackedMs / 3600_000)}h tracked today, no journal entry yet`,
        importance: 1,
      })
    }
  }

  // GYM-GAP — a real gap in gym sessions is worth a daily nudge until resolved.
  // Undated key: this is a continuous concern (like COMMITMENT), not a
  // daily-reset one — it stays open and just gets its detail/evidence
  // refreshed each run until the user actually goes and it clears itself.
  if (workoutEv.daysSinceAny !== null && workoutEv.daysSinceAny >= 3) {
    const overdue = workoutEv.mostOverdueEligible
    out.push({
      key: 'gym-gap',
      kind: 'gym-gap',
      title: 'Gym gap is growing',
      detail: `${workoutEv.daysSinceAny} days since your last gym session${overdue ? ` — ${overdue.type} is the most overdue` : ''}. Worth getting back today.`,
      evidence: `daysSinceAny=${workoutEv.daysSinceAny}`,
      importance: workoutEv.daysSinceAny >= 7 ? 3 : 2,
    })
  }

  // SLEEP-DEBT — elevated multi-day debt, nudged in the evening when an
  // earlier night is still actionable (mirrors EVENING's hour gate/dated key).
  if (hour >= 19 && hour < 23 && sleepEv.debtH !== null && sleepEv.debtH > 3) {
    out.push({
      key: `sleep-debt:${today}`,
      kind: 'sleep-debt',
      title: 'Sleep debt building',
      detail: `Running ~${sleepEv.debtH.toFixed(1)}h short of target over the last week. Worth an earlier night — aim for lights out around ${sleepEv.recBedClock}.`,
      evidence: `debtH=${sleepEv.debtH.toFixed(1)}, avgH=${sleepEv.avgH?.toFixed(1)}, targetH=${sleepEv.targetH?.toFixed(1)}`,
      importance: sleepEv.debtH > 6 ? 3 : 2,
    })
  }

  // POST-ACTIVITY NAP — just wrapped up a Commute/Office block, nap window is
  // open, and there's real debt behind it. This is the "as soon as I get
  // home" trigger — it rides the existing 30-min cron / app-foreground tick,
  // not a new real-time pipeline (see PLANNING_MODE_SPEC.md §6b).
  if (isNapWindow(tz) && sleepEv.debtH !== null && sleepEv.debtH > 1 && completed.length > 0) {
    const lastCompleted = completed.reduce((a, b) =>
      new Date(a.end_time as string).getTime() > new Date(b.end_time as string).getTime() ? a : b,
    )
    const endedMinAgo = Math.round((nowMs - new Date(lastCompleted.end_time as string).getTime()) / 60_000)
    const justEndedName = (catName(lastCompleted.category_id as string | null) ?? '').toLowerCase()
    if (endedMinAgo <= 20 && (justEndedName === 'commute' || justEndedName === 'office')) {
      out.push({
        key: `post-activity-nap:${today}`,
        kind: 'post-activity-nap',
        title: 'Just got in — worth a nap?',
        detail: `You just finished "${lastCompleted.title}" and sleep debt is running ~${sleepEv.debtH.toFixed(1)}h — a short nap (~20min) or a full cycle (~90min) could help before you go on. Your call.`,
        evidence: `justEnded="${lastCompleted.title}" (${justEndedName}) ${endedMinAgo}min ago, debtH=${sleepEv.debtH.toFixed(1)}, napWindow=true`,
        importance: 1,
      })
    }
  }

  return out
}

// ─── Push delivery (Expo push service) ───────────────────────────────────────

async function sendPush(tokens: string[], title: string, body: string): Promise<boolean> {
  if (tokens.length === 0) return false
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
    })
    return res.ok
  } catch {
    return false
  }
}

// ─── The loop for one user ────────────────────────────────────────────────────

async function runForUser(db: SupabaseClient, userId: string, trigger: string): Promise<string> {
  const { data: settings } = await db
    .from('user_settings')
    .select('timezone, quiet_hours_start, quiet_hours_end, notif_daily_budget')
    .eq('user_id', userId)
    .maybeSingle()
  const prefs: Prefs = {
    timezone: settings?.timezone ?? 'Asia/Kolkata',
    quiet_hours_start: settings?.quiet_hours_start ?? null,
    quiet_hours_end: settings?.quiet_hours_end ?? null,
    notif_daily_budget: settings?.notif_daily_budget ?? 5,
  }
  const hour = localHour(prefs.timezone)
  const lines: string[] = []

  const detected = await detectConcerns(db, userId, prefs)
  const detectedKeys = new Set(detected.map((d) => d.key))

  // Follow-up: resolve open concerns whose condition cleared.
  const { data: openConcerns } = await db
    .from('concerns')
    .select('id, key, kind, cooldown_until, notified_count')
    .eq('user_id', userId)
    .eq('status', 'open')
  for (const c of openConcerns ?? []) {
    if (!detectedKeys.has(c.key)) {
      await db.from('concerns').update({ status: 'resolved', resolution: 'condition cleared' }).eq('id', c.id)
      lines.push(`resolved ${c.key} (condition cleared)`)
    }
  }
  const openByKey = new Map((openConcerns ?? []).map((c) => [c.key, c]))

  // Budget: system notifications already sent today (local midnight boundary approximated by 24h window).
  const { count: sentToday } = await db
    .from('scheduled_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'system')
    .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
  let budgetLeft = Math.max(0, prefs.notif_daily_budget - (sentToday ?? 0))

  const { data: tokenRows } = await db.from('push_tokens').select('token').eq('user_id', userId)
  const tokens = (tokenRows ?? []).map((r) => r.token as string)

  for (const d of detected) {
    const existing = openByKey.get(d.key)
    let concernId: string
    if (existing) {
      concernId = existing.id as string
      await db.from('concerns').update({ detail: d.detail, evidence: d.evidence }).eq('id', concernId)
    } else {
      const { data: created, error } = await db
        .from('concerns')
        .insert({ user_id: userId, key: d.key, kind: d.kind, title: d.title, detail: d.detail, evidence: d.evidence, importance: d.importance })
        .select('id')
        .single()
      if (error) { lines.push(`ERROR creating ${d.key}: ${error.message}`); continue }
      concernId = created.id as string
      lines.push(`opened ${d.key}`)
    }

    // Decide whether to speak.
    if (existing?.cooldown_until && (existing.cooldown_until as string) > new Date().toISOString()) {
      lines.push(`silent ${d.key} (cooldown)`)
      continue
    }
    if (inQuietHours(hour, prefs)) {
      lines.push(`silent ${d.key} (quiet hours)`)
      continue
    }
    if (budgetLeft <= 0) {
      lines.push(`silent ${d.key} (attention budget spent)`)
      continue
    }

    const pushed = await sendPush(tokens, d.title, d.detail)
    // Record even when no device token yet — the queue/watching views show it.
    await db.from('scheduled_notifications').insert({
      user_id: userId,
      source: 'system',
      fire_at: new Date().toISOString(),
      title: d.title,
      body: d.detail,
      status: 'fired',
    })
    await db.from('concerns').update({
      last_action: pushed ? 'push sent' : 'recorded (no device token)',
      last_action_at: new Date().toISOString(),
      cooldown_until: new Date(Date.now() + COOLDOWN_MIN[d.kind] * 60_000).toISOString(),
      notified_count: (existing?.notified_count as number ?? 0) + 1,
    }).eq('id', concernId)
    budgetLeft--
    lines.push(`${pushed ? 'pushed' : 'recorded'} ${d.key}`)
  }

  // Keep Live Activity subtitles honest while the app is closed: refresh the
  // "Next: …" line on every tick for running entries that registered a
  // per-activity push token.
  try {
    const { data: liveEntries } = await db
      .from('time_entries')
      .select('id, title, start_time, activity_push_token')
      .eq('user_id', userId)
      .eq('is_running', true)
      .is('deleted_at', null)
      .not('activity_push_token', 'is', null)
    if (liveEntries && liveEntries.length > 0) {
      const today = todayLocal(prefs.timezone)
      const { data: blocks } = await db
        .from('calendar_blocks')
        .select('title, start_time')
        .eq('user_id', userId)
        .eq('date', today)
        .is('deleted_at', null)
        .gt('start_time', new Date().toISOString())
        .order('start_time')
        .limit(1)
      const next = blocks?.[0]
      const subtitle = next
        ? `Next: ${next.title} · ${localClock(next.start_time as string, prefs.timezone)}`
        : ''
      for (const e of liveEntries) {
        try {
          await sendActivityUpdate({
            token: e.activity_push_token as string,
            title: e.title as string,
            subtitle,
            startMs: new Date(e.start_time as string).getTime(),
          })
          lines.push(`LA subtitle refreshed (${subtitle || 'no next'})`)
        } catch (err) {
          lines.push(`LA update failed: ${err instanceof Error ? err.message.slice(0, 60) : 'error'}`)
        }
      }
    }
  } catch {
    // Live Activity refresh is cosmetic — never fail the run over it.
  }

  if (lines.length === 0) lines.push('all quiet — nothing to do')
  await db.from('brain_runs').insert({ user_id: userId, trigger, summary: lines.join('; ') })
  return lines.join('; ')
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const cronKey = Deno.env.get('BRAIN_CRON_KEY')
  if (!url || !serviceKey || !anonKey) return json({ error: 'server misconfigured' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  let userIds: string[] = []
  let trigger = 'app_open'

  const presentedCronKey = req.headers.get('x-cron-key')
  if (presentedCronKey) {
    if (!cronKey || presentedCronKey !== cronKey) return json({ error: 'bad cron key' }, 401)
    trigger = 'cron'
    // Cron serves users the brain can actually reach while the app is closed.
    const { data } = await admin.from('push_tokens').select('user_id')
    userIds = [...new Set((data ?? []).map((r) => r.user_id as string))]
  } else {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'missing authorization' }, 401)
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401)
    userIds = [userData.user.id]
  }

  const results: Record<string, string> = {}
  for (const uid of userIds) {
    try {
      results[uid] = await runForUser(admin, uid, trigger)
    } catch (e) {
      results[uid] = `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  return json({ ok: true, trigger, results })
})
