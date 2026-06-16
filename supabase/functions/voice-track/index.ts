// Edge Function: voice-track
// The native App Intent (Siri / Lock Screen Shortcut) calls this WITHOUT a
// Supabase JWT — it authenticates with a per-device secret (API-key style over
// HTTPS). We hash the presented secret and compare to the stored hash to resolve
// the user, then run the idempotent voice_track_admin RPC with the service role.
//
// Deploy: supabase functions deploy voice-track --no-verify-jwt
// (verify_jwt is also disabled in supabase/config.toml.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendPushToStart } from './apns.ts'

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
    .select('user_id, secret_hash, revoked, push_to_start_token')
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

  // Best-effort: start a Live Activity via APNs push-to-start so the Dynamic
  // Island / Lock Screen fires instantly while the app is closed. The DB write
  // already succeeded above — never fail the request if the push fails.
  let push: { sent: boolean; error?: string } = { sent: false }
  try {
    const r = (data ?? {}) as {
      action?: string
      entry_id?: string
      title?: string
      start_time?: string
      is_running?: boolean
    }
    const startable = (r.action === 'start' || r.action === 'parallel') && r.is_running !== false
    if (startable && cred.push_to_start_token && r.entry_id) {
      const startMs = r.start_time ? Date.parse(r.start_time) : Date.now()
      // Stamp BEFORE sending so the client knows a push-started card exists (skip
      // it on reconcile) — a null stamp means start a local fallback card. Stamp
      // first: if the push then fails there's no card AND the stamp is set, so the
      // client skips it (same as the previously-shipped always-skip behavior, no
      // duplicate). Stamping after the push would risk card-exists + stamp-null
      // (push ok, update throws) → a duplicate local card.
      await admin
        .from('time_entries')
        .update({ push_started_at: new Date().toISOString() })
        .eq('id', r.entry_id)
      await sendPushToStart({
        token: cred.push_to_start_token,
        title: r.title ?? title,
        entryId: r.entry_id,
        startMs: Number.isFinite(startMs) ? startMs : Date.now(),
      })
      push = { sent: true }
    }
  } catch (e) {
    push = { sent: false, error: e instanceof Error ? e.message : String(e) }
  }

  return json({ ok: true, result: data, push })
})
