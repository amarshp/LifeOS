import { toLocalDateStr } from './date'

/**
 * Build local start/end `Date`s for a block or entry that starts on `dateStr`
 * (a `YYYY-MM-DD` local calendar day). When the end clock time is at or before
 * the start, the end rolls into the next day — this is how a 11:35 PM → 3:00 AM
 * range becomes a single cross-midnight block ending the following morning.
 *
 * Hours are 24-hour. The returned `end` is always strictly after `start`, so the
 * DB `end_time > start_time` constraint is always satisfied.
 */
export function resolveLocalRange(
  dateStr: string,
  startHour24: number,
  startMin: number,
  endHour24: number,
  endMin: number,
): { start: Date; end: Date } {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const start = new Date(y, mo - 1, d, startHour24, startMin, 0, 0)
  const end = new Date(y, mo - 1, d, endHour24, endMin, 0, 0)
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1)
  }
  return { start, end }
}

/**
 * The portion of the interval `[startIso, endIso]` that falls within the local
 * calendar day `dateStr`, expressed as pixel offsets on a single-day rail of
 * `pxPerHour`. Returns `null` when the interval does not intersect that day.
 *
 * Used by per-day-column views (Week) to render a cross-midnight block as a
 * head segment (start → midnight) in its own column and a tail segment
 * (midnight → end) in the next day's column. The continuous Day timeline does
 * not need this — it positions each timestamp by its own date directly.
 */
export function daySegmentPx(
  startIso: string,
  endIso: string,
  dateStr: string,
  pxPerHour: number,
): { top: number; height: number } | null {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dayStart = new Date(y, mo - 1, d).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const s = Math.max(new Date(startIso).getTime(), dayStart)
  const e = Math.min(new Date(endIso).getTime(), dayEnd)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
  return {
    top: ((s - dayStart) / 3_600_000) * pxPerHour,
    height: ((e - s) / 3_600_000) * pxPerHour,
  }
}

/** Add `delta` days to a `YYYY-MM-DD` local date string. */
export function addLocalDays(dateStr: string, delta: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const next = new Date(y, mo - 1, d)
  next.setDate(next.getDate() + delta)
  return toLocalDateStr(next)
}

/**
 * Number of local calendar days an interval spans: 0 when start and end fall on
 * the same local day, 1 when the end is the next day (a cross-midnight range).
 */
export function localDaySpan(startIso: string, endIso: string): number {
  const s = new Date(startIso)
  const e = new Date(endIso)
  const sMid = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime()
  const eMid = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime()
  return Math.round((eMid - sMid) / (24 * 60 * 60 * 1000))
}

/**
 * Re-anchor an ISO timestamp to the local calendar day `targetDateStr`, keeping
 * its local time-of-day. Used to expand a recurring block onto another date in
 * local time (the stored timestamps are UTC, so a naive UTC-date swap would
 * mis-handle times whose UTC and local dates differ — e.g. IST late nights).
 */
export function shiftToLocalDate(iso: string, targetDateStr: string): string {
  const d = new Date(iso)
  const [y, mo, day] = targetDateStr.split('-').map(Number)
  return new Date(y, mo - 1, day, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).toISOString()
}
