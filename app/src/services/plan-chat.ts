import { File } from 'expo-file-system'
import { supabase } from '../lib/supabase'
import { resolveLocalRange } from '../lib/time-range'
import * as calendarBlocksService from './calendar-blocks'
import {
  getPlansForDate,
  getPlanItems,
  deletePlan,
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
  notes: string | null
}

export interface ProposedPlan {
  title: string
  items: ProposedItem[]
}

export interface ChatTurn {
  reply: string
  plan: ProposedPlan | null
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
export async function sendMessage(date: string, messages: ChatMessage[]): Promise<ChatTurn> {
  const { data, error } = await supabase.functions.invoke('plan-chat', {
    body: { date, messages, timezone: deviceTimezone() },
  })
  if (error) throw new Error(error.message || 'plan-chat failed')
  if (data?.error) throw new Error(data.error)
  return { reply: data.reply ?? '', plan: data.plan ?? null, model: data.model ?? 'unknown' }
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
  const { data, error } = await supabase.functions.invoke('plan-transcribe', {
    body: { audio_base64: base64, mime, filename },
  })
  if (error) throw new Error(error.message || 'plan-transcribe failed')
  if (data?.error) throw new Error(data.error)
  return (data.text ?? '').trim()
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
 */
export async function applyChatPlan(
  date: string,
  plan: ProposedPlan,
  model: string,
  prompt: string,
): Promise<number> {
  // 1. Tear down prior AI plans for this date + their materialized blocks.
  const existing = (await getPlansForDate(date)).filter((p) => p.source === 'ai')
  for (const old of existing) {
    const items = await getPlanItems(old.id)
    for (const it of items) {
      if (it.calendar_block_id) {
        await calendarBlocksService.deleteBlock(it.calendar_block_id)
      }
    }
    await deletePlan(old.id)
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
      sort_order: sortOrder++,
    })
  }

  // 4. Materialize into calendar_blocks (what Day/Week/Home render).
  return materializePlan(created.id, date)
}
