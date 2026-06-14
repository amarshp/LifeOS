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

/** Keep only items whose `start_time` lands on local-calendar `date`. */
export function filterByLocalDay<T extends { start_time: string }>(
  items: T[],
  date: string,
): T[] {
  return items.filter(item => isOnLocalDay(item.start_time, date))
}
