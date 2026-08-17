// One-time backfill: import historical Hevy gym sessions into time_entries.
// Part of the planning-mode redesign (see PLANNING_MODE_SPEC.md §6c). Not run
// on a schedule, not part of the shipped app — run once, done.
//
// Source: ../LIFE Data/Hevy Data.csv (one row per logged set; grouped here into
// one time_entries row per session, using the same (title, start_time, end_time)
// key as the export). Session titles that name a type (Push/Pull/Legs/Upper/
// Lower/FBD/Boxing) get mapped to a canonical tag; generic time-of-day titles
// ("Evening workout") and one-off ambiguous titles are imported untagged —
// still useful for gap/frequency stats, just not rotation-type stats.
//
// Usage: node scripts/backfill-hevy.cjs [--dry-run]

const fs = require('fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'))
  return (m ? m[1].trim() : '').replace(/^"|"$/g, '')
}

const SUPABASE_URL = getEnv('SUPABASE_API_URL') // already includes /rest/v1/
const SERVICE_KEY = getEnv('SUPABASE_SECRET_KEY')
const USER_ID = 'c65511fc-667f-4f6e-a787-b79fbc3d6a3f' // amarsh.pedapati@gmail.com, verified via admin/users
const ACTIVITY_CATEGORY_ID = 'd0382a43-4f21-4cba-b583-776cdadcacb6' // "Activity" — Gym is a title under this, not its own category

const CSV_PATH = path.join(ROOT, '..', 'LIFE Data', 'Hevy Data.csv')
const DRY_RUN = process.argv.includes('--dry-run')

// Title -> canonical workout-type tag (see PLANNING_MODE_SPEC.md §5 vocabulary).
// Unmapped titles import untagged rather than guessed.
const TYPE_MAP = {
  'push': 'push',
  'pull': 'pull',
  'pull calisthenics day': 'pull',
  'legs': 'legs',
  'leg': 'legs',
  'upper': 'upper',
  'upper - strength': 'upper',
  'upper - hypertrophy': 'upper',
  'lower (hypertrophy)': 'lower',
  'fbd': 'full-body',
  'fbd a': 'full-body',
  'fbd b [every set till failure]': 'full-body',
  'boxing': 'boxing',
}

function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// Hevy export format: "27 Jun 2026, 19:33" — treated as IST local time (device
// timezone at export), converted to a UTC ISO string for timestamptz storage.
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
function parseHevyDate(s) {
  const m = s.match(/^(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})$/)
  if (!m) return null
  const [, d, mon, y, h, min] = m
  // IST is UTC+5:30 — build the UTC instant directly.
  const utcMs = Date.UTC(+y, MONTHS[mon], +d, +h - 5, +min - 30)
  return new Date(utcMs).toISOString()
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const table = parseCsv(raw)
  const header = table[0]
  const col = (name) => header.indexOf(name)
  const iTitle = col('title'), iStart = col('start_time'), iEnd = col('end_time')

  const sessions = new Map() // key -> {title, start, end}
  for (let r = 1; r < table.length; r++) {
    const row = table[r]
    if (!row || row.length < 3) continue
    const title = row[iTitle], start = row[iStart], end = row[iEnd]
    if (!title || !start || !end) continue
    const key = `${title}|${start}|${end}`
    if (!sessions.has(key)) sessions.set(key, { title, start, end })
  }

  const toInsert = []
  let untaggedCount = 0
  for (const { title, start, end } of sessions.values()) {
    const startIso = parseHevyDate(start)
    const endIso = parseHevyDate(end)
    if (!startIso || !endIso) {
      console.warn('skip: unparseable date', title, start, end)
      continue
    }
    const type = TYPE_MAP[title.trim().toLowerCase()]
    if (!type) untaggedCount++
    toInsert.push({
      user_id: USER_ID,
      category_id: ACTIVITY_CATEGORY_ID,
      title: 'Gym',
      tags: type ? [type] : [],
      start_time: startIso,
      end_time: endIso,
      is_running: false,
      notes: `Imported from Hevy (original title: ${title})`,
    })
  }

  console.log(`Parsed ${sessions.size} unique sessions from CSV.`)
  console.log(`${toInsert.length - untaggedCount} tagged, ${untaggedCount} untagged (generic/ambiguous title).`)

  // Dedupe against Gym entries already in time_entries (safe to re-run). Scoped
  // to title=Gym specifically — matching on start_time alone would wrongly skip
  // a real Hevy session if some unrelated entry (e.g. Sleep) happened to start
  // at the exact same instant.
  const existingResp = await fetch(
    `${SUPABASE_URL}time_entries?user_id=eq.${USER_ID}&title=eq.Gym&select=start_time&order=start_time.asc&limit=5000`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  )
  const existing = await existingResp.json()
  if (!Array.isArray(existing)) throw new Error('failed to fetch existing entries: ' + JSON.stringify(existing))
  const existingStarts = new Set(existing.map((e) => e.start_time))
  const fresh = toInsert.filter((e) => !existingStarts.has(e.start_time))
  console.log(`${toInsert.length - fresh.length} already present (skipped), ${fresh.length} new to insert.`)

  if (DRY_RUN) {
    console.log('--dry-run: not writing. Sample of first 5 new rows:')
    console.log(JSON.stringify(fresh.slice(0, 5), null, 2))
    return
  }

  const CHUNK = 100
  let inserted = 0
  for (let i = 0; i < fresh.length; i += CHUNK) {
    const chunk = fresh.slice(i, i + CHUNK)
    const resp = await fetch(`${SUPABASE_URL}time_entries`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(chunk),
    })
    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`insert failed at offset ${i}: ${resp.status} ${text}`)
    }
    inserted += chunk.length
    console.log(`inserted ${inserted}/${fresh.length}`)
  }
  console.log('Done.')
}

main().catch((e) => { console.error(e); process.exit(1) })
