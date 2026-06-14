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
  action: 'start' | 'parallel' | 'stop'
  categoryId: string
  title: string
  at: string // ISO8601
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
  if (cmd.action === 'stop') {
    const match =
      running.find((r) => r.category_id === cmd.categoryId) ??
      running.find((r) => r.title.toLowerCase() === cmd.title.toLowerCase())
    if (match) await timeEntries.updateEntry(match.id, { is_running: false, end_time: at })
    return
  }

  if (cmd.action === 'start') {
    // stop everything currently running, backdated to the spoken time
    for (const r of running) {
      await timeEntries.updateEntry(r.id, { is_running: false, end_time: at })
    }
  }

  // start + parallel both insert a new running entry (DB trigger caps at 2)
  await timeEntries.startTimer({
    category_id: cmd.categoryId,
    title: cmd.title,
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
