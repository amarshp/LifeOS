import { File } from 'expo-file-system'
import { supabase } from '../lib/supabase'
import { resolveLocalRange } from '../lib/time-range'
import { todayStr } from '../lib/date'
import * as calendarBlocksService from './calendar-blocks'
import { fallbackCategoryId } from './todos'
import {
  getPlansForDate,
  getPlanItems,
  deletePlan,
  updatePlan,
  deletePlanItem,
  createPlan,
  addPlanItem,
  materializePlan,
} from './daily-plans'

/**
 * Plan chat service — client side of the conversational day planner.
 *
 * Talks to two edge functions:
 *  - `plan-chat`       conversational turn → { reply, plan }
 *  - `plan-transcribe` voice clip → { text }
 *
 * The model returns plan times as "HH:MM" local clock; we convert them to ISO
 * with `resolveLocalRange` (matching how the rest of the app builds blocks, incl.
 * cross-midnight handling) only at apply time.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A plan item as proposed by the model (clock-time, not yet ISO). */
export interface ProposedItem {
  title: string
  start_time: string // "HH:MM"
  end_time: string // "HH:MM"
  category_id: string | null
  todo_id: string | null
  flexibility?: 'fixed' | 'flexible' | 'protected'
  notes: string | null
}

export interface ProposedPlan {
  title: string
  items: ProposedItem[]
}

export interface ChatTurn {
  reply: string
  plan: ProposedPlan | null
  /** Human-readable log of real data changes the agent made this turn. */
  actions: string[]
  model: string
}

function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Send the conversation so far + target date; get the assistant's next turn. */
export async function sendMessage(
  date: string,
  messages: ChatMessage[],
  expectedSleepHours?: number,
): Promise<ChatTurn> {
  const { data, error } = await supabase.functions.invoke('plan-chat', {
    body: { date, messages, timezone: deviceTimezone(), expected_sleep_hours: expectedSleepHours },
  })
  if (error) throw new Error(error.message || 'plan-chat failed')
  if (data?.error) throw new Error(data.error)
  return {
    reply: data.reply ?? '',
    plan: data.plan ?? null,
    actions: Array.isArray(data.actions) ? data.actions : [],
    model: data.model ?? 'unknown',
  }
}

const AUDIO_MIME: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  caf: 'audio/x-caf',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  '3gp': 'audio/3gpp',
}

/** Transcribe a recorded clip (file uri) to text via the Whisper relay. */
export async function transcribe(uri: string): Promise<string> {
  const ext = (uri.split('.').pop() || 'm4a').toLowerCase().split('?')[0]
  const mime = AUDIO_MIME[ext] ?? 'audio/m4a'
  const filename = `speech.${ext}`
  const base64 = await new File(uri).base64()

  // One automatic retry: the upload dies on transient link drops ("Failed to
  // send a request to the Edge Function"), and a straight resend usually lands.
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.functions.invoke('plan-transcribe', {
      body: { audio_base64: base64, mime, filename },
    })
    if (!error && !data?.error) return (data.text ?? '').trim()
    lastErr = new Error(error?.message || data?.error || 'plan-transcribe failed')
  }
  throw lastErr ?? new Error('plan-transcribe failed')
}

function hhmm(value: string): { h: number; m: number } {
  const [h, m] = value.split(':').map((n) => parseInt(n, 10))
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

/**
 * Apply a proposed plan to `date` with REPLACE semantics: any prior AI plan for
 * that day (and the calendar blocks it materialized) is removed first, so the
 * Day view shows exactly one clean plan after every Apply. Returns the number of
 * calendar blocks created.
 *
 * Replan-from-now: when `date` is TODAY, only prior AI items that start at/after
 * now are torn down — the morning that already happened stays on the timeline.
 * (For future dates nothing has happened yet, so everything is replaced.)
 */
export interface ApplyUndo {
  /** New AI plan created by this apply (delete it + its blocks to undo). */
  newPlanId: string
  /** Blocks that were soft-deleted by the teardown (restore them to undo). */
  deletedBlockIds: string[]
}

export interface ApplyResult {
  created: number
  undo: ApplyUndo
}

export async function applyChatPlan(
  date: string,
  plan: ProposedPlan,
  model: string,
  prompt: string,
): Promise<ApplyResult> {
  // 1. Tear down prior AI plans for this date + their materialized blocks.
  const cutoffIso = date === todayStr() ? new Date().toISOString() : null
  const existing = (await getPlansForDate(date)).filter((p) => p.source === 'ai')
  const deletedBlockIds: string[] = []
  for (const old of existing) {
    const items = await getPlanItems(old.id)
    let kept = 0
    for (const it of items) {
      if (cutoffIso && it.start_time < cutoffIso) {
        kept++
        continue
      }
      if (it.calendar_block_id) {
        await calendarBlocksService.deleteBlock(it.calendar_block_id)
        deletedBlockIds.push(it.calendar_block_id)
      }
      await deletePlanItem(it.id)
    }
    if (kept === 0) await deletePlan(old.id)
    else await updatePlan(old.id, { status: 'archived' })
  }

  // 1b. ONE ACTIVE PLAN: future flexible/protected blocks of any source are
  // also replaced — otherwise a new plan stacks in parallel with manual blocks
  // and the day shows two overlapping schedules. FIXED blocks (appointments)
  // survive; the model was told not to move them without asking. Everything
  // removed here is captured for Undo.
  const dayBlocks = await calendarBlocksService.getBlocksForDate(date)
  for (const b of dayBlocks) {
    if (b.flexibility === 'fixed') continue
    // Recurring blocks are standing routines, not a stacked plan — deleting the
    // row would kill every future occurrence. Leave them; the model sees them
    // in its preflight and plans around them.
    if (b.recurrence !== 'none') continue
    if (cutoffIso && b.start_time < cutoffIso) continue
    if (deletedBlockIds.includes(b.id)) continue
    await calendarBlocksService.deleteBlock(b.id)
    deletedBlockIds.push(b.id)
  }

  // 2. Create the fresh plan.
  const created = await createPlan({
    date,
    source: 'ai',
    status: 'active',
    title: plan.title ?? null,
    prompt,
    model,
    generated_at: new Date().toISOString(),
  })

  // 3. Add items, converting "HH:MM" → ISO in local time (cross-midnight safe).
  let sortOrder = 0
  for (const item of plan.items) {
    const s = hhmm(item.start_time)
    const e = hhmm(item.end_time)
    const { start, end } = resolveLocalRange(date, s.h, s.m, e.h, e.m)
    await addPlanItem({
      plan_id: created.id,
      category_id: item.category_id ?? null,
      title: item.title,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      tags: [],
      notes: item.notes ?? null,
      todo_id: item.todo_id ?? null,
      flexibility: item.flexibility ?? 'flexible',
      sort_order: sortOrder++,
    })
  }

  // 4. Materialize into calendar_blocks (what Day/Week/Home render). Items the
  // model couldn't categorize land in the fallback category instead of being
  // silently dropped.
  const created2 = await materializePlan(created.id, date, await fallbackCategoryId())
  return { created: created2, undo: { newPlanId: created.id, deletedBlockIds } }
}

/**
 * Revert the most recent Apply: remove the plan (and blocks) it created and
 * restore the blocks its teardown soft-deleted.
 */
export async function undoApply(undo: ApplyUndo): Promise<void> {
  const items = await getPlanItems(undo.newPlanId)
  for (const it of items) {
    if (it.calendar_block_id) await calendarBlocksService.deleteBlock(it.calendar_block_id)
    await deletePlanItem(it.id)
  }
  await deletePlan(undo.newPlanId)
  for (const id of undo.deletedBlockIds) {
    await calendarBlocksService.restoreBlock(id)
  }
}
