// APNs ActivityKit push-to-start sender (Deno / Web Crypto).
// Starts a Live Activity on the device while the app is closed, using the
// device's push-to-start token. Best-effort: callers should not fail the DB
// write if this errors. Secrets come from Edge Function env:
//   APNS_KEY_P8   - the .p8 private key contents (PEM)
//   APNS_KEY_ID   - 10-char key id
//   APNS_TEAM_ID  - Apple team id
//   APNS_TOPIC    - <bundle>.push-type.liveactivity
//   APNS_HOST     - https://api.push.apple.com (prod) | https://api.sandbox.push.apple.com

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str))
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const der = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i)
  return der
}

let cachedKey: CryptoKey | null = null
async function signingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey
  const p8 = Deno.env.get('APNS_KEY_P8')
  if (!p8) throw new Error('APNS_KEY_P8 not set')
  cachedKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(p8),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  return cachedKey
}

async function makeJwt(): Promise<string> {
  const keyId = Deno.env.get('APNS_KEY_ID')
  const teamId = Deno.env.get('APNS_TEAM_ID')
  if (!keyId || !teamId) throw new Error('APNS_KEY_ID/APNS_TEAM_ID not set')
  const header = b64urlStr(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const payload = b64urlStr(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }))
  const data = `${header}.${payload}`
  const key = await signingKey()
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(data))
  return `${data}.${b64url(new Uint8Array(sig))}`
}

export interface StartPush {
  token: string
  title: string
  entryId: string
  startMs: number
}

// Fire a push-to-start. Returns the APNs HTTP status (200 = accepted) or throws.
export async function sendPushToStart(p: StartPush): Promise<number> {
  const host = Deno.env.get('APNS_HOST') ?? 'https://api.push.apple.com'
  const topic = Deno.env.get('APNS_TOPIC')
  if (!topic) throw new Error('APNS_TOPIC not set')
  const jwt = await makeJwt()
  const payload = {
    aps: {
      event: 'start',
      'content-state': {
        title: p.title,
        elapsedTimerStartDateInMilliseconds: p.startMs,
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
        deepLinkUrl: `lifeos://stop-start?entry=${p.entryId}`,
        timerType: 'digital',
      },
      alert: { title: 'LifeOS', body: `Tracking ${p.title}`, sound: 'default' },
    },
  }
  const res = await fetch(`${host}/3/device/${p.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (res.status !== 200) {
    const text = await res.text()
    throw new Error(`APNs ${res.status}: ${text}`)
  }
  return res.status
}
