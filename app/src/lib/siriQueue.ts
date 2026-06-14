import { File, Paths } from 'expo-file-system'
import type { Category, TimeEntry } from '../types/database'
import * as timeEntries from '../services/time-entries'

// Bridge for the native Siri "track" intents (LifeOSTrackIntent.swift).
// - syncQuickTasks: write the task options the AppEntity offers to Siri.
// - drainTrackQueue: apply commands the intents captured while locked, backdated
//   to when they were spoken, each tagged `review`.

const TASKS_FILE = 'lifeos_quick_tasks.json'
const QUEUE_FILE = 'lifeos_track_queue.json'
const REVIEW_TAG = 'review'

interface QuickTask {
  id: string
  title: string
  categoryId: string
}

interface TrackCommand {
  action: string // always "track" now; real action parsed from the title
  categoryId: string
  title: string
  at: string // ISO8601
}

// Native captures the whole spoken tail as the title. Derive the action from a
// leading keyword here (JS = tunable without a native rebuild).
const STOP_PREFIXES = ['stop ', 'end ', 'finish ']
const PARALLEL_PREFIXES = ['parallel ', 'also ', 'and ']

function parseTrack(rawTitle: string): { action: 'start' | 'parallel' | 'stop'; title: string } {
  const t = rawTitle.trim()
  const lower = t.toLowerCase()
  for (const p of STOP_PREFIXES) {
    if (lower.startsWith(p)) return { action: 'stop', title: t.slice(p.length).trim() }
  }
  for (const p of PARALLEL_PREFIXES) {
    if (lower.startsWith(p)) return { action: 'parallel', title: t.slice(p.length).trim() }
  }
  return { action: 'start', title: t }
}

// Categories + recent distinct titles → the names Siri can match. Also a
// default category for free-text Siri entries (e.g. "track dinner").
export function syncQuickTasks(categories: Category[], recent: TimeEntry[]): void {
  if (categories.length === 0) return
  const tasks: QuickTask[] = categories.map((c) => ({ id: c.id, title: c.name, categoryId: c.id }))
  const seen = new Set(categories.map((c) => c.name.toLowerCase()))
  for (const e of recent) {
    const key = e.title.toLowerCase()
    if (e.title && !seen.has(key)) {
      seen.add(key)
      tasks.push({ id: `t:${e.id}`, title: e.title, categoryId: e.category_id })
    }
  }
  const defaultCategoryId =
    categories.find((c) => ['misc', 'inbox', 'other'].includes(c.name.toLowerCase()))?.id ?? categories[0].id
  try {
    const f = new File(Paths.document, TASKS_FILE)
    if (f.exists) f.delete()
    f.create()
    f.write(JSON.stringify({ defaultCategoryId, tasks }))
  } catch {
    // best-effort
  }
}

function readQueue(): TrackCommand[] {
  try {
    const f = new File(Paths.document, QUEUE_FILE)
    if (!f.exists) return []
    const raw = f.textSync()
    f.delete()
    const arr = JSON.parse(raw) as TrackCommand[]
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function applyCommand(cmd: TrackCommand, running: TimeEntry[]): Promise<void> {
  const at = new Date(cmd.at).toISOString()
  const { action, title } = parseTrack(cmd.title)

  if (action === 'stop') {
    const match =
      running.find((r) => r.title.toLowerCase() === title.toLowerCase()) ??
      running.find((r) => r.category_id === cmd.categoryId) ??
      (title.length === 0 ? running[0] : undefined) // bare "stop" → stop current
    if (match) await timeEntries.updateEntry(match.id, { is_running: false, end_time: at })
    return
  }

  if (action === 'start') {
    // stop everything currently running, backdated to the spoken time
    for (const r of running) {
      await timeEntries.updateEntry(r.id, { is_running: false, end_time: at })
    }
  }

  // start + parallel both insert a new running entry (DB trigger caps at 2)
  await timeEntries.startTimer({
    category_id: cmd.categoryId,
    title,
    start_time: at,
    tags: [REVIEW_TAG],
    notes: null,
  })
}

// Returns how many commands were applied (0 = nothing to do).
export async function drainTrackQueue(): Promise<number> {
  const queue = readQueue()
  if (queue.length === 0) return 0

  // chronological, so sequential start/stop ordering is correct
  queue.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  for (const cmd of queue) {
    try {
      const running = await timeEntries.getRunningTimers()
      await applyCommand(cmd, running)
    } catch {
      // skip a bad command (e.g. max-2-parallel trigger); keep going
    }
  }
  return queue.length
}
