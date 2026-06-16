import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { TimeEntry } from '../types/database'

// Runaway-timer guard: schedules a local notification at start_time + threshold
// for each running timer so a forgotten timer nudges the user even when the app
// is closed. Cancels the notification once the timer stops. Local only — no
// push server. Reconcile is called from the tab root with the running set.

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

const STORAGE_KEY = 'runaway.scheduled.v1'
const RUNAWAY_HOURS = 6
const ID_PREFIX = 'runaway:'

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

async function loadScheduled(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

async function saveScheduled(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // best-effort
  }
}

/**
 * Ensure each running timer has a runaway notification scheduled, and cancel
 * notifications for timers that have stopped. Safe to call repeatedly.
 */
export async function reconcileRunawayNotifications(running: TimeEntry[]): Promise<void> {
  const n = getModule()
  if (!n) return

  const scheduled = await loadScheduled()
  const runningIds = running.map((e) => e.id)

  // Cancel notifications for timers no longer running.
  const stillScheduled: string[] = []
  for (const id of scheduled) {
    if (runningIds.includes(id)) {
      stillScheduled.push(id)
    } else {
      try {
        await n.cancelScheduledNotificationAsync(ID_PREFIX + id)
      } catch {
        // ignore — may already be delivered/cancelled
      }
    }
  }

  // Nothing running → done after cancellations.
  const toSchedule = running.filter((e) => !stillScheduled.includes(e.id))
  if (toSchedule.length === 0) {
    await saveScheduled(stillScheduled)
    return
  }

  if (!(await ensurePermission(n))) {
    await saveScheduled(stillScheduled)
    return
  }

  if (!handlerSet) {
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    })
    handlerSet = true
  }

  const nowMs = Date.now()
  for (const entry of toSchedule) {
    const fireMs = new Date(entry.start_time).getTime() + RUNAWAY_HOURS * 3_600_000
    const date = new Date(Math.max(fireMs, nowMs + 5_000))
    try {
      await n.scheduleNotificationAsync({
        identifier: ID_PREFIX + entry.id,
        content: {
          title: 'Still tracking',
          body: `"${entry.title}" has been running ${RUNAWAY_HOURS}h. Tap to stop or review it.`,
        },
        trigger: { type: n.SchedulableTriggerInputTypes.DATE, date },
      })
      stillScheduled.push(entry.id)
    } catch {
      // best-effort
    }
  }

  await saveScheduled(stillScheduled)
}
