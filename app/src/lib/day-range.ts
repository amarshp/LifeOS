/**
 * Local-day filtering helpers.
 *
 * Supabase stores `start_time` as `timestamptz`. Filtering with a naive
 * same-day string window (`${date}T00:00:00` … `T23:59:59`) compares the naive
 * literal in the DB session timezone (UTC), which is offset from the user's
 * real local day. In IST (UTC+5:30) that drops entries near the day's edges —
 * the root cause of Day-view "missing tasks" (BUG #2).
 *
 * Strategy: query a window padded by one day on each side, then filter
 * client-side by the entry's LOCAL calendar day. This is timezone-agnostic and
 * mirrors what the (accurate) Week view already does via `toLocalDateStr`.
 */

/** Local `YYYY-MM-DD` for a Date. Mirrors `date.ts#toLocalDateStr` — kept inline
 *  so this module is dependency-free and unit-testable under `node --test`. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Shift a `YYYY-MM-DD` string by whole days, honoring month/year rollover. */
export function shiftDate(date: string, deltaDays: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDateStr(new Date(y, m - 1, d + deltaDays))
}

/** Naive timestamp window padded ±1 day around `date` for the SQL query. */
export function paddedDateRange(date: string): { gte: string; lte: string } {
  return {
    gte: `${shiftDate(date, -1)}T00:00:00`,
    lte: `${shiftDate(date, 1)}T23:59:59`,
  }
}

/** True when an ISO instant falls on local-calendar `date`. */
export function isOnLocalDay(startTimeIso: string, date: string): boolean {
  return localDateStr(new Date(startTimeIso)) === date
}

/**
 * True when an item's [start, end] span overlaps local-calendar `date` at
 * all — not just when its start falls on that day. A still-open span (no
 * end_time) is treated as ending "now".
 *
 * Filtering on start-time-only membership (the old `isOnLocalDay`-per-item
 * check) silently dropped the today-side portion of any entry that started
 * the previous local day and ran past local midnight (e.g. a late-night
 * session ending 3:30am) — the entry never entered "today"'s result set at
 * all, so callers that already clamp start/end to the day's boundaries
 * (Home's tracked-hours total, the 24h bar) had nothing to clamp: today's
 * early-morning hours rendered as empty/untracked even though they were
 * covered by that entry's tail end.
 */
export function overlapsLocalDay(startTimeIso: string, endTimeIso: string | null | undefined, date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  const dayStartMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const dayEndMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  const startMs = new Date(startTimeIso).getTime()
  const endMs = endTimeIso ? new Date(endTimeIso).getTime() : Date.now()
  // endMs > dayStartMs (strict): a span that ENDS exactly at local midnight
  // touches the next day at a single instant but contributes zero duration
  // to it — >= would report that as "overlapping" the next day (Codex
  // catch). Current callers already clamp to positive duration before using
  // this, so it was inert in practice, but the primitive itself should be
  // correct independent of who calls it.
  return startMs <= dayEndMs && endMs > dayStartMs
}

/** Keep only items whose [start, end] span overlaps local-calendar `date`. */
export function filterByLocalDay<T extends { start_time: string; end_time?: string | null }>(
  items: T[],
  date: string,
): T[] {
  return items.filter(item => overlapsLocalDay(item.start_time, item.end_time, date))
}
