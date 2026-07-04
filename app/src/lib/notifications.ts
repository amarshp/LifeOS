import { Platform } from 'react-native'
import * as calendarBlocksService from '../services/calendar-blocks'
import * as todosService from '../services/todos'
import * as remindersService from '../services/reminders'
import { getUserSettings, type UserSettings } from '../services/user-settings'
import { todayStr } from './date'
import { addLocalDays } from './time-range'

// Notifications v1 reconciler (local-only).
// Derived reminders (plan blocks, task deadlines, plan-tomorrow ritual) are
// computed from their sources on every reconcile; direct reminders come from
// the scheduled_notifications table (agent/user created). Everything is
// scheduled as iOS/Android LOCAL notifications for a rolling window — they
// fire with the app killed. Remote delivery is Notifications v2 (Phase 3).

type NotifModule = typeof import('expo-notifications')

let mod: NotifModule | null = null
function getModule(): NotifModule | null {
  if (Platform.OS === 'web') return null
  if (!mod) {
    try {
      mod = require('expo-notifications') as NotifModule
    } catch {
      return null
    }
  }
  return mod
}

const ID_PREFIX = 'lifeq:'
const HORIZON_MS = 48 * 3600_000 // rolling schedule window
const MAX_SCHEDULED = 40 // stay well under the iOS 64 pending cap (runaway uses some)

export interface UpcomingNotification {
  id: string // stable identifier (doubles as the OS notification id)
  kind: 'plan' | 'task' | 'ritual' | 'reminder'
  fireMs: number
  title: string
  body: string | null
  reminderId: string | null // set for direct reminders → cancellable in the table
}

function inQuietHours(fireMs: number, prefs: UserSettings): boolean {
  if (prefs.quiet_hours_start === null || prefs.quiet_hours_end === null) return false
  const h = new Date(fireMs).getHours()
  const { quiet_hours_start: qs, quiet_hours_end: qe } = prefs
  if (qs === qe) return false
  return qs < qe ? h >= qs && h < qe : h >= qs || h < qe // wraps midnight
}

function parseHHMM(hhmm: string, dayOffset: number): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0)
  return d.getTime()
}

/**
 * Everything that will ring, sorted by fire time: derived (plan/task/ritual)
 * within the horizon + all pending direct reminders. Also feeds the
 * Notification Center list.
 */
export async function computeUpcoming(): Promise<UpcomingNotification[]> {
  const prefs = await getUserSettings()
  const nowMs = Date.now()
  const horizonEnd = nowMs + HORIZON_MS
  const out: UpcomingNotification[] = []

  // Plan-block reminders — today's and tomorrow's blocks, offsets before start.
  if (prefs.notif_plan_enabled && prefs.notif_plan_offsets_min.length > 0) {
    const dates = [todayStr(), addLocalDays(todayStr(), 1)]
    const blockDays = await Promise.all(
      dates.map(d => calendarBlocksService.getEffectiveBlocksForDate(d).catch(() => [])),
    )
    for (const block of blockDays.flat()) {
      const startMs = new Date(block.start_time).getTime()
      if (!Number.isFinite(startMs) || startMs <= nowMs || startMs > horizonEnd + 60 * 60_000) continue
      for (const offset of prefs.notif_plan_offsets_min) {
        const fireMs = startMs - offset * 60_000
        if (fireMs <= nowMs || fireMs > horizonEnd) continue
        if (inQuietHours(fireMs, prefs)) continue
        out.push({
          id: `${ID_PREFIX}plan:${block.id}:${offset}`,
          kind: 'plan',
          fireMs,
          title: block.title,
          body: `Starts in ${offset} min`,
          reminderId: null,
        })
      }
    }
  }

  // Task reminders — open todos with an explicit deadline, offsets before it.
  if (prefs.notif_task_enabled && prefs.notif_task_offsets_min.length > 0) {
    const todos = await todosService.getOpenTodos().catch(() => [])
    for (const todo of todos) {
      if (!todo.deadline) continue
      const dueMs = new Date(todo.deadline).getTime()
      if (!Number.isFinite(dueMs) || dueMs <= nowMs) continue
      for (const offset of prefs.notif_task_offsets_min) {
        const fireMs = dueMs - offset * 60_000
        if (fireMs <= nowMs || fireMs > horizonEnd) continue
        if (inQuietHours(fireMs, prefs)) continue
        out.push({
          id: `${ID_PREFIX}task:${todo.id}:${offset}`,
          kind: 'task',
          fireMs,
          title: todo.title,
          body: offset >= 60 ? `Due in ${Math.round(offset / 60)}h` : `Due in ${offset} min`,
          reminderId: null,
        })
      }
    }
  }

  // Plan-tomorrow ritual — a set local time each evening.
  if (prefs.notif_plan_tomorrow_hhmm) {
    for (const dayOffset of [0, 1]) {
      const fireMs = parseHHMM(prefs.notif_plan_tomorrow_hhmm, dayOffset)
      if (fireMs === null || fireMs <= nowMs || fireMs > horizonEnd) continue
      out.push({
        id: `${ID_PREFIX}ritual:plan:${new Date(fireMs).toDateString()}`,
        kind: 'ritual',
        fireMs,
        title: 'Plan tomorrow?',
        body: 'Two minutes with the Agent sets up the day.',
        reminderId: null,
      })
    }
  }

  // Direct reminders (agent/user) — quiet hours do not apply: they were asked for.
  const reminders = await remindersService.getUpcomingReminders().catch(() => [])
  for (const r of reminders) {
    const fireMs = new Date(r.fire_at).getTime()
    if (!Number.isFinite(fireMs) || fireMs <= nowMs) continue
    out.push({
      id: `${ID_PREFIX}rem:${r.id}`,
      kind: 'reminder',
      fireMs,
      title: r.title,
      body: r.body,
      reminderId: r.id,
    })
  }

  return out.sort((a, b) => a.fireMs - b.fireMs)
}

let handlerSet = false
let permissionAsked = false

async function ensurePermission(n: NotifModule): Promise<boolean> {
  const current = await n.getPermissionsAsync()
  if (current.granted) return true
  if (current.canAskAgain === false) return false
  if (permissionAsked) return false
  permissionAsked = true
  const req = await n.requestPermissionsAsync()
  return req.granted
}

/**
 * Make the OS schedule match computeUpcoming() for the rolling window.
 * Idempotent; call on foreground, after plan/task changes, after prefs edits.
 */
export async function reconcileNotifications(): Promise<void> {
  const n = getModule()
  if (!n) return

  await remindersService.sweepFiredReminders().catch(() => {})

  const upcoming = (await computeUpcoming()).filter(u => u.fireMs <= Date.now() + HORIZON_MS)
  const desired = new Map(upcoming.slice(0, MAX_SCHEDULED).map(u => [u.id, u]))

  if (desired.size > 0 && !(await ensurePermission(n))) return

  if (!handlerSet) {
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    })
    handlerSet = true
  }

  const existing = await n.getAllScheduledNotificationsAsync()
  const existingOurs = new Set(
    existing.map(e => e.identifier).filter(id => id.startsWith(ID_PREFIX)),
  )

  // Cancel stale (block moved, task done, reminder cancelled, prefs changed).
  for (const id of existingOurs) {
    if (!desired.has(id)) {
      try { await n.cancelScheduledNotificationAsync(id) } catch { /* delivered already */ }
    }
  }

  // Schedule new.
  for (const [id, u] of desired) {
    if (existingOurs.has(id)) continue
    try {
      await n.scheduleNotificationAsync({
        identifier: id,
        content: { title: u.title, body: u.body ?? undefined, sound: true },
        trigger: { type: n.SchedulableTriggerInputTypes.DATE, date: new Date(u.fireMs) },
      })
    } catch {
      // best-effort — a single bad row must not break the rest
    }
  }
}
