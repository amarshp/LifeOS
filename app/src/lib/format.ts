// Pure display formatters shared across the Today / home redesigns.

/** "5:06 am", "6 pm" — 12-hour clock, drops ":00". */
export function formatClock12(time: string): string {
  const d = new Date(time)
  const h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return m > 0 ? `${hour}:${String(m).padStart(2, '0')} ${ampm}` : `${hour} ${ampm}`
}

/** "now", "in 12m", "in 1h 5m" relative to `now`. */
export function relativeTime(time: string, now: Date): string {
  const diff = new Date(time).getTime() - now.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`
}

/** Milliseconds → "1.1" (hours, one decimal). */
export function formatHours(ms: number): string {
  return (ms / 3_600_000).toFixed(1)
}

/** Splits an elapsed string ("1:03:32") into the leading part and trailing seconds. */
export function splitSeconds(elapsed: string): { lead: string; secs: string } {
  const parts = elapsed.split(':')
  return { lead: parts.slice(0, -1).join(':'), secs: parts[parts.length - 1] }
}
