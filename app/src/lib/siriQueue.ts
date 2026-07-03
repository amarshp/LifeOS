import { File, Paths } from 'expo-file-system'
import type { Category, TimeEntry, Tag } from '../types/database'
import * as timeEntries from '../services/time-entries'
import * as categoriesService from '../services/categories'
import * as tagsService from '../services/tags'
import * as userSettingsService from '../services/user-settings'
import { supabase } from './supabase'

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
  command_id?: string // new path: idempotent server RPC handles everything
  action?: string // legacy path
  categoryId?: string // legacy path
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

// Whole-word match of `needle` inside `hay` (avoids "office" matching "officer").
function tokenMatch(hay: string, needle: string): boolean {
  if (!needle.trim()) return false
  return ` ${hay.toLowerCase()} `.includes(` ${needle.toLowerCase()} `)
}

// Infer category + a tag from the spoken title:
// tag name in title → that tag's category + the tag; else category name in title
// → that category. Returns nulls when nothing matches.
function inferFromTitle(
  title: string,
  categories: Category[],
  tags: Tag[],
): { categoryId: string | null; tagName: string | null } {
  const tag = tags.find((t) => tokenMatch(title, t.name))
  if (tag) return { categoryId: tag.category_id, tagName: tag.name }
  const cat = categories.find((c) => tokenMatch(title, c.name))
  if (cat) return { categoryId: cat.id, tagName: null }
  return { categoryId: null, tagName: null }
}

async function applyCommand(
  cmd: TrackCommand,
  running: TimeEntry[],
  categories: Category[],
  tags: Tag[],
  fallbackCatId: string | undefined,
  allowParallel: boolean,
): Promise<void> {
  const at = new Date(cmd.at).toISOString()
  const parsed = parseTrack(cmd.title)
  // Parallel timers disabled → "parallel X" is just a switch to X.
  const action = parsed.action === 'parallel' && !allowParallel ? 'start' : parsed.action
  const title = parsed.title
  const inferred = inferFromTitle(title, categories, tags)

  if (action === 'stop') {
    const match =
      running.find((r) => r.title.toLowerCase() === title.toLowerCase()) ??
      (inferred.categoryId ? running.find((r) => r.category_id === inferred.categoryId) : undefined) ??
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

  // Category precedence: title keyword/tag match → native value (if valid) → fallback.
  const categoryId =
    inferred.categoryId ??
    (categories.some((c) => c.id === cmd.categoryId) ? cmd.categoryId : undefined) ??
    fallbackCatId
  if (!categoryId) throw new Error('no category available')

  // Always tag voice entries `review` (may be mis-heard); add the matched tag too.
  const tagList = inferred.tagName ? [REVIEW_TAG, inferred.tagName] : [REVIEW_TAG]

  // start + parallel both insert a new running entry (DB trigger caps at 2)
  await timeEntries.startTimer({
    category_id: categoryId,
    title,
    start_time: at,
    tags: tagList,
    notes: null,
  })
}

export interface DrainResult {
  found: number
  applied: number
  errors: string[]
}

// Apply queued Siri commands. Resolves a valid category in JS (the native side
// may write an empty/stale id), and reports errors instead of swallowing them.
export async function drainTrackQueue(): Promise<DrainResult> {
  const queue = readQueue()
  if (queue.length === 0) return { found: 0, applied: 0, errors: [] }

  // chronological, so sequential start/stop ordering is correct
  queue.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Legacy commands (no command_id) need category/tag data for in-JS matching.
  const needLegacy = queue.some((c) => !c.command_id)
  const [categories, tags] = needLegacy
    ? await Promise.all([
        categoriesService.getCategories().catch(() => [] as Category[]),
        tagsService.getAllTags().catch(() => [] as Tag[]),
      ])
    : [[] as Category[], [] as Tag[]]
  const allowParallel = needLegacy
    ? await userSettingsService.getUserSettings().then((s) => s.allow_parallel_timers).catch(() => false)
    : false
  const fallbackCatId = (
    categories.find((c) => ['misc', 'inbox', 'other'].includes(c.name.toLowerCase())) ?? categories[0]
  )?.id

  let applied = 0
  const errors: string[] = []
  for (const cmd of queue) {
    try {
      if (cmd.command_id) {
        // New path: idempotent server RPC does parse + category/tag + write.
        const { error } = await supabase.rpc('track_from_voice', {
          p_command_id: cmd.command_id,
          p_title: cmd.title,
          p_at: cmd.at,
        })
        if (error) throw error
      } else {
        // Legacy path (older native build): parse + match + write in JS.
        const running = await timeEntries.getRunningTimers()
        await applyCommand(cmd, running, categories, tags, fallbackCatId, allowParallel)
      }
      applied += 1
    } catch (e) {
      errors.push(`"${cmd.title}": ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { found: queue.length, applied, errors }
}
