// Edge Function: voice-track
// The native App Intent (Siri / Lock Screen Shortcut) calls this WITHOUT a
// Supabase JWT — it authenticates with a per-device secret (API-key style over
// HTTPS). We hash the presented secret and compare to the stored hash to resolve
// the user, then run the idempotent voice_track_admin RPC with the service role.
//
// Deploy: supabase functions deploy voice-track --no-verify-jwt
// (verify_jwt is also disabled in supabase/config.toml.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface Body {
  device_id?: string
  command_id?: string
  title?: string
  at?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Constant-time-ish string compare to avoid leaking via timing.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const secret = req.headers.get('x-device-secret') ?? ''
  if (!secret) return json({ error: 'missing device secret' }, 401)

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid json' }, 400)
  }
  const { device_id, command_id, title } = body
  if (!device_id || !command_id || !title) {
    return json({ error: 'missing device_id/command_id/title' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'server misconfigured' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: cred, error: credErr } = await admin
    .from('voice_credentials')
    .select('user_id, secret_hash, revoked')
    .eq('device_id', device_id)
    .maybeSingle()
  if (credErr) return json({ error: 'lookup failed' }, 500)
  if (!cred || cred.revoked) return json({ error: 'unknown device' }, 401)

  const presentedHash = await sha256Hex(secret)
  if (!safeEqual(presentedHash, cred.secret_hash)) {
    return json({ error: 'bad secret' }, 401)
  }

  const { data, error } = await admin.rpc('voice_track_admin', {
    p_user_id: cred.user_id,
    p_command_id: command_id,
    p_title: title,
    p_at: body.at ?? new Date().toISOString(),
  })
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true, result: data })
})
