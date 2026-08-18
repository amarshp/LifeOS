import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shiftDate, paddedDateRange, isOnLocalDay, filterByLocalDay, overlapsLocalDay } from '../day-range.ts'

// Run under a specific zone:  TZ=Asia/Kolkata node --test
//                             TZ=America/New_York node --test
const TZ = process.env.TZ ?? 'unknown'

test('shiftDate handles day/month/year rollover', () => {
  assert.equal(shiftDate('2026-05-27', -1), '2026-05-26')
  assert.equal(shiftDate('2026-05-27', 1), '2026-05-28')
  assert.equal(shiftDate('2026-05-01', -1), '2026-04-30')
  assert.equal(shiftDate('2026-05-31', 1), '2026-06-01')
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01')
  assert.equal(shiftDate('2026-01-01', -1), '2025-12-31')
})

test('paddedDateRange pads one day each side (timezone-independent)', () => {
  assert.deepEqual(paddedDateRange('2026-05-27'), {
    gte: '2026-05-26T00:00:00',
    lte: '2026-05-28T23:59:59',
  })
})

// Timezone-sensitive: an instant at 19:30 UTC is the *next* local day in IST
// (01:00) but the *same* local day in US-Eastern (15:30). The naive same-day
// UTC window would mis-bucket this; local-day filtering must not.
test(`isOnLocalDay buckets by local calendar day [TZ=${TZ}]`, () => {
  const lateUtc = '2026-05-27T19:30:00Z' // 2026-05-28 01:00 IST / 2026-05-27 15:30 EDT
  if (TZ === 'Asia/Kolkata') {
    assert.equal(isOnLocalDay(lateUtc, '2026-05-28'), true)
    assert.equal(isOnLocalDay(lateUtc, '2026-05-27'), false)
  } else if (TZ === 'America/New_York') {
    assert.equal(isOnLocalDay(lateUtc, '2026-05-27'), true)
    assert.equal(isOnLocalDay(lateUtc, '2026-05-28'), false)
  }

  // Early-morning IST instant (the "missing from Day view" case): 00:30 IST is
  // 19:00 UTC the previous day, which a naive UTC same-day window drops.
  const earlyIst = '2026-05-26T19:00:00Z' // 2026-05-27 00:30 IST
  if (TZ === 'Asia/Kolkata') {
    assert.equal(isOnLocalDay(earlyIst, '2026-05-27'), true)
  }
})

test('filterByLocalDay keeps only matching local-day items', () => {
  const date = '2026-05-27'
  const items = [
    { start_time: '2026-05-27T06:00:00Z', end_time: '2026-05-27T07:00:00Z' },
    { start_time: '2026-05-25T06:00:00Z', end_time: '2026-05-25T07:00:00Z' },
  ]
  const kept = filterByLocalDay(items, date)
  // At minimum the far-off day (2 days earlier) is always excluded in any TZ.
  assert.ok(!kept.some(i => i.start_time === '2026-05-25T06:00:00Z'))
})

// Regression: an entry that starts the previous local day and runs past
// local midnight must still overlap TODAY, not just yesterday — the bug
// reported as "Home shows too few hours tracked / bar empty at the start of
// the day" even though a late-night session covered those early hours.
test(`overlapsLocalDay includes an entry that starts the day before and ends after local midnight [TZ=${TZ}]`, () => {
  // Gate on the actual device offset (IST = UTC+5:30), not process.env.TZ —
  // the TZ env var doesn't reliably propagate into node's process.env on
  // every platform this runs on, even when the OS-level zone is IST.
  if (new Date().getTimezoneOffset() !== -330) return
  // 2026-05-26 23:30 IST -> 2026-05-27 03:30 IST
  const start = '2026-05-26T18:00:00Z'
  const end = '2026-05-26T22:00:00Z'
  assert.equal(overlapsLocalDay(start, end, '2026-05-27'), true)
  assert.equal(overlapsLocalDay(start, end, '2026-05-26'), true)
  assert.equal(overlapsLocalDay(start, end, '2026-05-28'), false)
})
