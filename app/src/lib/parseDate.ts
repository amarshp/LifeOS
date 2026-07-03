import * as chrono from 'chrono-node'
import { toLocalDateStr } from './date'

/**
 * Extract a planning-target date from free text ("tomorrow I want to gym…",
 * "let's plan Friday", "July 10"). Only fires when the text explicitly names
 * a day (weekday/relative-day/month-day/ISO) — a bare time like "at 7" is
 * NOT enough (chrono would otherwise silently default it to today). Returns
 * null when no explicit day is mentioned.
 */
export function extractPlanDate(text: string, refDate: Date = new Date()): string | null {
  const results = chrono.parse(text, refDate, { forwardDate: true })
  if (results.length === 0) return null
  const start = results[0].start
  if (!start.isCertain('day') && !start.isCertain('weekday')) return null
  return toLocalDateStr(start.date())
}
