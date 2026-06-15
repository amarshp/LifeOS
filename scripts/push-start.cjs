// Send an ActivityKit push-to-start to begin a Live Activity while the LifeOS
// app is closed. Dev build => aps-environment=development => sandbox APNs host.
//
// Usage:
//   node scripts/push-start.cjs --p8 path/to/AuthKey_XXXX.p8 --kid XXXXXXXXXX [--title "Gym"] [--token <hex>]
//
// Defaults: team C2LT7KT438, topic com.pedapatiamarsh.lifeos.push-type.liveactivity,
// host api.sandbox.push.apple.com. If --token is omitted, the most recently
// updated push_to_start_token in voice_credentials is fetched from Supabase.

const fs = require('fs')
const http2 = require('node:http2')
const crypto = require('node:crypto')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'))
  return (m ? m[1].trim() : '').replace(/^"|"$/g, '')
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}

const TEAM_ID = arg('team', 'C2LT7KT438')
const TOPIC = arg('topic', 'com.pedapatiamarsh.lifeos.push-type.liveactivity')
const HOST = arg('host', 'https://api.sandbox.push.apple.com')
const TITLE = arg('title', 'Push start test')
const P8_PATH = arg('p8')
const KEY_ID = arg('kid')

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

function makeJwt(p8, keyId, teamId) {
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const payload = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))
  const signingInput = `${header}.${payload}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: p8, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${b64url(sig)}`
}

async function fetchToken() {
  const ref = getEnv('SUPABASE_API_URL').match(/https:\/\/([a-z0-9]+)\.supabase\.co/)[1]
  const pat = getEnv('SUPABASE_API_KEY')
  const q =
    'select push_to_start_token from voice_credentials where push_to_start_token is not null order by updated_at desc limit 1;'
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  })
  const rows = await r.json()
  if (!Array.isArray(rows) || !rows[0]) throw new Error('no push_to_start_token in DB')
  return rows[0].push_to_start_token
}

function buildPayload() {
  return {
    aps: {
      event: 'start',
      'content-state': {
        title: TITLE,
        elapsedTimerStartDateInMilliseconds: Date.now(),
      },
      timestamp: Math.floor(Date.now() / 1000),
      'attributes-type': 'LiveActivityAttributes',
      attributes: {
        name: 'ExpoLiveActivity',
        backgroundColor: '#0A0A0A',
        titleColor: '#FFFFFF',
        subtitleColor: '#9CA3AF',
        progressViewTint: '#C8102E',
        progressViewLabelColor: '#FFFFFF',
        deepLinkUrl: 'lifeos://stop-start?entry=pushtest',
        timerType: 'digital',
      },
      alert: { title: 'LifeOS', body: `Tracking ${TITLE}`, sound: 'default' },
    },
  }
}

async function main() {
  if (!P8_PATH || !KEY_ID) {
    console.error('Required: --p8 <AuthKey_*.p8> --kid <10-char Key ID>')
    process.exit(1)
  }
  const p8 = fs.readFileSync(P8_PATH, 'utf8')
  const token = arg('token') || (await fetchToken())
  const jwt = makeJwt(p8, KEY_ID, TEAM_ID)
  const body = JSON.stringify(buildPayload())

  const client = http2.connect(HOST)
  client.on('error', (e) => {
    console.error('connection error:', e.message)
    process.exit(1)
  })
  const req = client.request({
    ':method': 'POST',
    ':path': `/3/device/${token}`,
    authorization: `bearer ${jwt}`,
    'apns-topic': TOPIC,
    'apns-push-type': 'liveactivity',
    'apns-priority': '10',
    'content-type': 'application/json',
  })
  let status = 0
  let data = ''
  req.on('response', (h) => {
    status = h[':status']
  })
  req.setEncoding('utf8')
  req.on('data', (d) => (data += d))
  req.on('end', () => {
    console.log('APNs status:', status)
    console.log('apns-id:', '(see headers)')
    console.log('body:', data || '(empty = success)')
    client.close()
    process.exit(status === 200 ? 0 : 2)
  })
  req.write(body)
  req.end()
}

main().catch((e) => {
  console.error('error:', e.message)
  process.exit(1)
})
