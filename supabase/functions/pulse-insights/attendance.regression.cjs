// Regression check for the Codex-caught bug: attendance's activeDates used to
// filter `r.start < referenceDate`, so a category logged again TODAY still
// read as "gone quiet" because the code was blind to the very entry that
// ended the silence. No test framework exists in this repo (checked:
// no jest/vitest, no .test.* files) -- this mirrors the project's existing
// convention of small standalone Node verification scripts (see
// scratchpad/insight-eval/). Run: node attendance.regression.cjs
const REFERENCE_DATE = '2026-08-18'

function dateOf(iso) { return iso.slice(0, 10) }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000) }
function median(vals) {
  if (!vals.length) return null
  const s = [...vals].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// Same logic as index.ts's attendance loop, both the buggy and fixed forms,
// so this asserts the fix actually changes behavior (not a vacuous pass).
function computeAttendance(rows, cat, referenceDate, { excludeToday }) {
  const activeDates = [...new Set(
    rows.filter((r) => r.category === cat && (!excludeToday || r.start < referenceDate)).map((r) => dateOf(r.start))
  )].sort()
  if (activeDates.length < 3) return { enoughHistory: false }
  const gaps = []
  for (let i = 1; i < activeDates.length; i++) gaps.push(daysBetween(activeDates[i - 1], activeDates[i]))
  const medianGap = median(gaps)
  const lastActive = activeDates[activeDates.length - 1]
  const daysSinceLast = daysBetween(lastActive, referenceDate)
  const quietThreshold = Math.max(3 * medianGap, 7)
  return { lastActive, daysSinceLast, wentQuiet: daysSinceLast > quietThreshold }
}

// Gym: routine Mon/Wed/Fri for 3 weeks, quiet for ~9 days, then a session
// TODAY (2026-08-18) -- the user just went back to the gym.
const rows = [
  { category: 'Gym', start: '2026-07-20T13:30:00Z' },
  { category: 'Gym', start: '2026-07-22T13:30:00Z' },
  { category: 'Gym', start: '2026-07-24T13:30:00Z' },
  { category: 'Gym', start: '2026-07-27T13:30:00Z' },
  { category: 'Gym', start: '2026-07-29T13:30:00Z' },
  { category: 'Gym', start: '2026-07-31T13:30:00Z' },
  { category: 'Gym', start: '2026-08-03T13:30:00Z' },
  { category: 'Gym', start: '2026-08-05T13:30:00Z' },
  { category: 'Gym', start: '2026-08-07T13:30:00Z' },
  { category: 'Gym', start: '2026-08-18T13:30:00Z' }, // logged again today
]

const buggy = computeAttendance(rows, 'Gym', REFERENCE_DATE, { excludeToday: true })
const fixed = computeAttendance(rows, 'Gym', REFERENCE_DATE, { excludeToday: false })

console.log('buggy (excludes today):', buggy)
console.log('fixed (includes today):', fixed)

let failed = false
if (buggy.wentQuiet !== true) { console.error('FAIL: expected the buggy form to reproduce the false positive (wentQuiet=true)'); failed = true }
if (fixed.wentQuiet !== false) { console.error('FAIL: fixed form should NOT flag a category logged again today as quiet'); failed = true }
if (fixed.daysSinceLast !== 0) { console.error('FAIL: fixed form should show 0 days since last active (today)'); failed = true }

if (failed) { console.error('\nREGRESSION FAILED'); process.exit(1) }
console.log('\nREGRESSION PASSED — same-day re-engagement no longer misreads as "gone quiet"')
